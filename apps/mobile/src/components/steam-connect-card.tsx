/**
 * The Steam link, and everything that can be true about it.
 *
 * Six states, and the design is mostly about not letting them collapse into two:
 *
 *   unavailable  — this deployment has no Steam key. No button at all, because
 *                  one that always fails is worse than none.
 *   unlinked     — the connect action. The one primary on this screen, so it is
 *                  the one accent fill.
 *   syncing      — linked, never synced. The library is on its way.
 *   healthy      — linked and read.
 *   private      — linked, but Steam is withholding the library. *Not* an error
 *                  to apologise for: it is four steps the member can take, and
 *                  they are spelled out. This is the state the whole component
 *                  is shaped around; it is by far the most common way the
 *                  feature stops working, and the only one with a cure.
 *   failed       — Steam was unreachable. Nothing to do but try later.
 *
 * The visual idea survives the port intact: the card is a ledger entry, not a
 * settings row. The persona name is display serif, the figures are mono and
 * tabular, and the connected state is carried by a hairline and a single filled
 * dot rather than by colour — the accent stays reserved for the action.
 *
 * Three things are laid out differently at 390pt, and all three are the width:
 *
 * - **The action drops below the identity** instead of sitting beside it. A
 *   display-serif persona name and a button cannot share a line on a phone
 *   without one of them being cut to nothing, and the name is the half that
 *   makes this a ledger entry rather than a row.
 * - **The figures strip wraps to two columns.** "Library" and "Total playtime"
 *   are short enough to read across; "Catalog" is a sentence and takes the full
 *   width beneath them.
 * - **Unlinking asks in the platform's own alert**, where the web reveals an
 *   inline confirm block with a Keep-it escape. Same decision, one tap instead
 *   of a second widget, and it is what the rest of this app already does for a
 *   comment, a review and a follower.
 *
 * The one behavioural difference is `connect`, and it is the point of the whole
 * phase: the web assigns `window.location` and never comes back, where this
 * opens a browser it owns and is handed the outcome as a return value. See
 * `@/lib/steam-link`.
 */
import { Link2Off, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { Alert as NativeAlert, Pressable, StyleSheet, Switch, View } from "react-native";

import {
  canSyncNow,
  cooldownLabel,
  formatGameCount,
  formatSyncedAt,
  formatTotalPlaytime,
  matchedLabel,
  providerLabel,
  syncNotice,
  useAuth,
} from "@sidequestd/core";
import type { ConnectionStart, LinkedAccount } from "@sidequestd/api-types";

import { commitTap } from "@/lib/haptics";
import { linkSteam } from "@/lib/steam-link";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

import { SyncNotice } from "./sync-notice";
import { Alert } from "./ui/alert";
import { Button } from "./ui/button";
import { Eyebrow } from "./ui/eyebrow";
import { StoreMark } from "./ui/store-mark";
import { EyebrowText, Text } from "./ui/text";

/** The status dot. Six points, a capsule, so a plain `borderRadius`. */
const DOT = 6;

export function SteamConnectCard({
  account,
  available,
  onChange,
  onLinkResult,
}: {
  account: LinkedAccount | null;
  available: boolean;
  onChange: (next: LinkedAccount | null) => void;
  /**
   * The callback's verdict, once the browser has handed it back.
   *
   * Reported upward rather than shown here because the banner belongs to the
   * screen — a link attempt is a thing that happened to the *page*, and on a
   * success the card it would have been drawn in has been replaced by a
   * different card. Null when the reader backed out of the browser.
   */
  onLinkResult: (code: string | null) => void;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const { authedRequest } = useAuth();

  const [pending, setPending] = useState<"connect" | "sync" | "unlink" | "visibility" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notice = account ? syncNotice(account.last_sync_status) : null;
  const awaitingFirstSync = account !== null && account.last_synced_at === null;

  async function connect() {
    setPending("connect");
    setError(null);
    try {
      // `client=native` is what makes the callback redirect to `sidequestd://`
      // instead of to the web app. The API reads it once, at the start, and
      // seals it into the signed state — see `app/api/v1/connections.py`.
      const start = await authedRequest<ConnectionStart>(
        "/connections/steam/start?client=native",
      );
      const code = await linkSteam(start.authorize_url);
      if (code === "connected") commitTap();
      onLinkResult(code);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reach Steam.");
    } finally {
      setPending(null);
    }
  }

  async function sync() {
    setPending("sync");
    setError(null);
    try {
      onChange(await authedRequest<LinkedAccount>("/connections/steam/sync", { method: "POST" }));
      commitTap();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start a sync.");
    } finally {
      setPending(null);
    }
  }

  async function unlink() {
    setPending("unlink");
    setError(null);
    try {
      await authedRequest("/connections/steam", { method: "DELETE" });
      commitTap();
      onChange(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlink that account.");
    } finally {
      setPending(null);
    }
  }

  function confirmUnlink() {
    NativeAlert.alert(
      "Unlink Steam?",
      // The web says this in a bordered strip beside the button. Here it is the
      // alert's body, which is the only place a phone has for it — and it has to
      // be said either way: what goes is not just the link but every verified
      // hour standing on it.
      "Your synced library goes with it, and so does the verified playtime on your reviews.",
      [
        { text: "Keep it", style: "cancel" },
        { text: "Unlink", style: "destructive", onPress: () => void unlink() },
      ],
    );
  }

  async function setVisible(isVisible: boolean) {
    setPending("visibility");
    setError(null);
    try {
      onChange(
        await authedRequest<LinkedAccount>("/connections/steam/visibility", {
          method: "PATCH",
          body: { is_visible: isVisible },
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change that setting.");
    } finally {
      setPending(null);
    }
  }

  if (!available) {
    return (
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.identity}>
            <StoreMark source="steam" size={18} color={tokens.color.fgFaint} />
            <Text size={15} weight="medium">
              Steam
            </Text>
          </View>
          <Text size={14} tone="dim" relaxed>
            Steam linking isn&rsquo;t available on this deployment.
          </Text>
        </View>
      </View>
    );
  }

  if (!account) {
    return (
      <View style={styles.card}>
        <View style={styles.head}>
          <View style={styles.identity}>
            <StoreMark source="steam" size={22} color={tokens.color.fg} />
            <Text variant="display" size={26}>
              Steam
            </Text>
          </View>

          <Text size={14} tone="dim" relaxed>
            Link your account to fill in playtime when you review a game, and show your most-played
            games on your profile.
          </Text>

          {/* The one primary on this screen, and the one control here worth the
              full width — it is the whole reason somebody opened this page. */}
          <Button
            variant="primary"
            size="lg"
            disabled={pending !== null}
            onPress={() => void connect()}
          >
            {pending === "connect" ? "Opening Steam…" : "Connect Steam"}
          </Button>
        </View>

        <View style={styles.foot}>
          <Alert inline>{error}</Alert>
          <Eyebrow>Sidequestd never sees your Steam password</Eyebrow>
          <Text size={14} tone="dim" relaxed>
            You sign in on Steam&rsquo;s own site and it tells us only your account ID. We read your
            games and playtime — nothing else — and you can unlink at any time.
          </Text>
        </View>
      </View>
    );
  }

  const syncable = canSyncNow(account);
  const matched = matchedLabel(account);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={styles.identity}>
          <StoreMark source="steam" size={22} color={tokens.color.fg} />
          {/* One line, clipped. A Steam persona can be forty characters of
              anything, and a display serif wrapping to three lines would push
              the figures off a 390pt screen. */}
          <Text variant="display" size={26} numberOfLines={1} style={styles.persona}>
            {account.provider_username ?? providerLabel(account.provider)}
          </Text>
        </View>

        {/* The connected signal: a filled dot and a line of mono, rather than a
            green pill. Status here is a fact about a ledger entry, not an
            alert. The dot is decoration to a screen reader — the sentence
            beside it already carries the state. */}
        <View style={styles.status}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              styles.dot,
              {
                backgroundColor: notice
                  ? tokens.color.danger
                  : awaitingFirstSync
                    ? tokens.color.fgFaint
                    : tokens.color.success,
              },
            ]}
          />
          <EyebrowText tone="faint">{formatSyncedAt(account.last_synced_at)}</EyebrowText>
        </View>

        <Button
          size="sm"
          icon={RefreshCw}
          disabled={pending !== null || !syncable}
          // The visible label says whether it can be pressed; the accessible one
          // says when it can be pressed again, which is the web's `title`.
          accessibilityLabel={cooldownLabel(account)}
          onPress={() => void sync()}
          style={styles.sync}
        >
          {pending === "sync" ? "Syncing…" : syncable ? "Sync now" : "Synced recently"}
        </Button>
      </View>

      {/* The figures. Recessed onto surface-2 like a card footer, because they
          are read as a strip rather than as sentences. */}
      <View style={styles.figures}>
        <View style={styles.figure}>
          <Eyebrow>Library</Eyebrow>
          <Text size={14} style={styles.tabular}>
            {awaitingFirstSync && account.total_games === 0
              ? "Syncing…"
              : formatGameCount(account.total_games)}
          </Text>
        </View>

        <View style={styles.figure}>
          <Eyebrow>Total playtime</Eyebrow>
          <Text size={14} style={styles.tabular}>
            {formatTotalPlaytime(account.total_playtime_minutes)}
          </Text>
        </View>

        {matched ? (
          <View style={styles.figureWide}>
            <Eyebrow>Catalog</Eyebrow>
            <Text size={14} tone="dim" relaxed>
              {matched}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={styles.foot}>
        <SyncNotice notice={notice} />

        {/* Not itself pressable, for the same reason the privacy toggle in the
            profile form is not: a `Switch` owns its own gesture including the
            drag, and a second target around it double-toggles on Android. */}
        <View style={styles.toggle}>
          <View style={styles.toggleText}>
            <Text size={15} weight="medium">
              Show Steam on my profile
            </Text>
            <Text size={13} tone="dim" relaxed style={styles.toggleHint}>
              Turning this off also removes the verified playtime shown on your reviews.
            </Text>
          </View>

          <Switch
            value={account.is_visible}
            disabled={pending !== null}
            onValueChange={(next) => void setVisible(next)}
            accessibilityLabel="Show Steam on my profile"
            trackColor={{ false: tokens.color.lineStrong, true: tokens.color.accent }}
            thumbColor={process.env.EXPO_OS === "android" ? tokens.color.surface : undefined}
          />
        </View>

        <Alert inline>{error}</Alert>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Unlink your Steam account"
          disabled={pending !== null}
          onPress={confirmUnlink}
          style={({ pressed }) => [styles.unlink, pressed && styles.unlinkPressed]}
        >
          <Link2Off size={14} strokeWidth={1.75} color={tokens.color.fgFaint} />
          <EyebrowText tone="faint">
            {pending === "unlink" ? "Unlinking…" : "Unlink Steam"}
          </EyebrowText>
        </Pressable>
      </View>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    card: {
      overflow: "hidden",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
    },

    head: { gap: 14, paddingHorizontal: 18, paddingVertical: 18 },
    identity: { flexDirection: "row", alignItems: "center", gap: 10 },
    // The serif overhangs its box on both sides at 26pt; without this the
    // descender of a "g" in a persona name is clipped by `numberOfLines`.
    persona: { flex: 1, minWidth: 0, paddingBottom: 2 },
    status: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: -4 },
    dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
    sync: { alignSelf: "flex-start" },

    figures: {
      flexDirection: "row",
      flexWrap: "wrap",
      rowGap: 16,
      borderTopWidth: 1,
      borderTopColor: t.color.line,
      backgroundColor: t.color.surface2,
      paddingHorizontal: 18,
      paddingVertical: 16,
    },
    // Halves rather than a `gap` and `flex: 1`: the third figure wraps to its
    // own line, and a flex row would stretch whichever two shared a line with
    // it into thirds one moment and halves the next. The gutter is padding
    // inside the half rather than a `columnGap`, which a wrapped 50% would
    // overflow the row with.
    figure: { width: "50%", gap: 8, paddingRight: 16 },
    figureWide: { width: "100%", gap: 8 },
    tabular: { fontVariant: ["tabular-nums"] },

    foot: {
      gap: 16,
      borderTopWidth: 1,
      borderTopColor: t.color.line,
      paddingHorizontal: 18,
      paddingVertical: 16,
    },

    toggle: { flexDirection: "row", alignItems: "center", gap: 16 },
    toggleText: { flex: 1, minWidth: 0 },
    toggleHint: { marginTop: 6 },

    // A destructive action set as an eyebrow, which is how the web spells it
    // too — quiet, at the bottom, and nothing like the accent button above it.
    // The 44pt target comes from the padding rather than from a height, so the
    // row stays visually the size of its letters.
    unlink: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      gap: 8,
      ...rounded(t.radius.sm),
      marginHorizontal: -8,
      marginVertical: -6,
      paddingHorizontal: 8,
      paddingVertical: 14,
    },
    unlinkPressed: { backgroundColor: t.color.surface2 },
  });
