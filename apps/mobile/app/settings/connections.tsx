/**
 * Connections — SPEC §6.13.
 *
 * The web needed this to be a route of its own for a reason that does not apply
 * here: linking left the app entirely and came back on a redirect, so it needed
 * an address to come back *to*. On a phone the outcome arrives as a return value
 * from the browser the app opened — see `@/lib/steam-link` — and the screen never
 * unmounts. It is still a route, because it is still a place in Settings, but the
 * URL is no longer load-bearing.
 *
 * **Except once.** The redirect the API sends is a real `sidequestd://` deep
 * link, and there are two ways it can be delivered: handed back to the waiting
 * session, which is the normal path, or handled by the OS as an ordinary link —
 * which is what happens if the app was killed behind the browser, or if Android
 * routes the intent before the Custom Tab sees it. In that second case the app
 * launches or resumes onto this route with `?connected=steam` on it. So the
 * query string is read here too, exactly as the web reads it, and the two paths
 * end in the same banner. The parameters are cleared once read, so a reader who
 * comes back to this screen later is not congratulated again on a link made ten
 * minutes ago.
 *
 * The load is the same shape as every other authenticated screen's: fetch on the
 * session, keep the failure in `loadError` rather than replacing the screen, and
 * let the card own its own pending states.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { callbackMessage, useAuth, type SyncNotice as Notice } from "@sidequestd/core";
import type { ConnectionStatus, LinkedAccount } from "@sidequestd/api-types";

import { Screen } from "@/components/screen";
import { SteamConnectCard } from "@/components/steam-connect-card";
import { SyncNotice } from "@/components/sync-notice";
import { Alert } from "@/components/ui/alert";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { ProfileSkeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useRequireAuth } from "@/lib/require-auth";
import { rounded, useStyles, type Tokens } from "@/theme";

export default function ConnectionsScreen() {
  const styles = useStyles(make);
  const user = useRequireAuth();
  const { authedRequest } = useAuth();

  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Notice | null>(null);

  const params = useLocalSearchParams<{ connected?: string; error?: string }>();

  const load = useCallback(async () => {
    try {
      setStatus(await authedRequest<ConnectionStatus>("/me/connections"));
      setLoadError(null);
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : "Could not load your connections.");
    }
  }, [authedRequest]);

  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);

  // The deep-link path. Only fires when the OS delivered the callback rather
  // than the browser session handing it back, which is the cold-start case.
  useEffect(() => {
    const message = callbackMessage(params.connected ?? params.error ?? null);
    if (!message) return;
    setOutcome(message);
    // Out of the route, so returning to this screen does not re-announce it.
    router.setParams({ connected: undefined, error: undefined });
    // A link made through this path happened without the card knowing, so the
    // status on screen is one request out of date.
    void load();
  }, [params.connected, params.error, load]);

  /** The browser-session path: the card was handed the code directly. */
  function handleLinkResult(code: string | null) {
    setOutcome(callbackMessage(code));
    if (code === "connected") void load();
  }

  function handleChange(next: LinkedAccount | null) {
    setStatus((current) => (current ? { ...current, accounts: next ? [next] : [] } : current));
    // A fresh link or a sync has been queued; the outcome banner is stale the
    // moment the member does anything else.
    setOutcome(null);
  }

  if (!user) {
    return (
      <Screen back>
        <ProfileSkeleton />
      </Screen>
    );
  }

  const steam = status?.accounts.find((entry) => entry.provider === "STEAM") ?? null;

  return (
    <Screen back>
      <PageHeader
        eyebrow="Account"
        title="Connections"
        description="Link the platform you actually play on. Sidequestd fills in your playtime when you write a review, and shows it as verified so nobody has to take your word for it."
      />

      <SyncNotice notice={outcome} />
      <Alert>{loadError}</Alert>

      <View style={styles.section}>
        <Eyebrow heading rule>
          Platforms
        </Eyebrow>

        {status === null ? (
          <View style={styles.placeholder} />
        ) : (
          <SteamConnectCard
            account={steam}
            available={status.steam_available}
            onChange={handleChange}
            onLinkResult={handleLinkResult}
          />
        )}

        {/* Said once, plainly, rather than left for people to wonder about.
            Steam is the only platform with a sanctioned way in — the other three
            publish no consumer API at all — and a reader who owns a PS5 deserves
            an answer better than its absence from the list. */}
        <Text size={12} tone="faint" relaxed>
          PlayStation, Xbox and Nintendo don&rsquo;t offer a public way for apps like this one to
          read your library, so they aren&rsquo;t here yet. If that changes, they&rsquo;ll show up on
          this screen.
        </Text>
      </View>
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    section: { gap: 16 },
    // The card's own height, held while it loads, so the footnote below does not
    // jump up the screen and back down again.
    placeholder: {
      height: 220,
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
    },
  });
