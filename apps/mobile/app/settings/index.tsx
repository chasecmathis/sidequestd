/**
 * Settings — where the web's account popover ends up once there is no popover.
 *
 * `UserMenu` on the web is a dropdown from the header holding four things: a
 * link to your profile, "Edit profile", the theme control, and sign out. A
 * popover anchored to a header button is a pattern that has no good native form
 * — the header is 56pt tall on a 390pt screen, and a menu hanging off it either
 * covers the screen or is too small to hit — so it becomes a stack reached from
 * the gear in the Profile tab's app bar, which is the one place a phone's reader
 * already looks for exactly these four things.
 *
 * Connections is the fourth destination and the one that is not in that
 * popover at all — the web reaches it from the profile settings page. It belongs
 * here for the same reason everything else does: it is a thing about the account
 * rather than about anything on screen.
 *
 * **The policy documents are a second group rather than three more rows.** The
 * web reaches About, Privacy and Terms from a footer that is on every page,
 * which is a slot a phone does not have — a persistent footer under a tab bar is
 * two bars, and neither one is navigation the reader asked for. So they come
 * here, and they are separated from the four above because they are the only
 * destinations in this stack that are not about *your* account. The eyebrow says
 * so; the gap is what a reader actually reads.
 *
 * **Appearance is on this screen rather than behind another row.** It is one
 * control with three states, it applies the instant it is pressed, and the whole
 * screen changing colour is a more convincing confirmation than any toast — the
 * same reasoning the web's profile settings page gives for keeping it outside
 * the form. A row that navigated to a screen holding one segmented control would
 * be a tap spent on ceremony.
 */
import {
  ChevronRight,
  FileText,
  Info,
  Link2,
  LogOut,
  Palette,
  Shield,
  User,
  UserPen,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { CONNECTIONS_PATH, profilePath, useAuth } from "@sidequestd/core";

import { Screen } from "@/components/screen";
import { ThemeSegments } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { EyebrowText, Text } from "@/components/ui/text";
import { open, openReplacing } from "@/lib/navigate";
import { forgetDevice } from "@/lib/push";
import { useRequireAuth } from "@/lib/require-auth";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

/**
 * One navigation row.
 *
 * A chevron and a full-width target, which is what a settings list is on both
 * platforms — and the one place in this app a row is a link rather than a card,
 * because a stack of bordered cards would make four equal-weight destinations
 * look like four decisions.
 */
function Row({
  icon: Icon,
  label,
  hint,
  onPress,
  last = false,
}: {
  icon: LucideIcon;
  label: string;
  hint?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.rowPressed]}
    >
      <Icon size={18} strokeWidth={1.75} color={tokens.color.fgDim} />

      <View style={styles.rowText}>
        <Text size={15}>{label}</Text>
        {hint ? (
          <Text size={12} tone="faint" style={styles.hint}>
            {hint}
          </Text>
        ) : null}
      </View>

      <ChevronRight size={18} strokeWidth={1.75} color={tokens.color.fgFaint} />
    </Pressable>
  );
}

export default function SettingsScreen() {
  const styles = useStyles(make);
  const user = useRequireAuth();
  const { authedRequest, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    // Before `logout`, and that ordering is the whole of it: taking this phone
    // off the push list is an authenticated call, and `logout` destroys the
    // token it needs. Get it the other way round and the device stays
    // registered to an account nobody is signed into on it — which is this
    // account's notifications on a lock screen somebody else is holding.
    // `forgetDevice` never throws, so it cannot strand a reader on this screen.
    await forgetDevice(authedRequest);
    // `logout` resolves whether or not the server could be told, so this line
    // always runs — and it replaces rather than pushes, so the back gesture
    // cannot return to a signed-in screen with no session behind it.
    await logout();
    openReplacing("/login");
  }

  if (!user) return <Screen back>{null}</Screen>;

  return (
    <Screen back>
      <PageHeader eyebrow="Account" title="Settings" description={`Signed in as @${user.username}`} />

      <View style={styles.group}>
        <Row
          icon={UserPen}
          label="Edit profile"
          hint="Name, bio, picture, privacy"
          onPress={() => open("/settings/profile")}
        />
        <Row
          icon={Link2}
          label="Connections"
          hint="Steam library and verified playtime"
          onPress={() => open(CONNECTIONS_PATH)}
        />
        <Row
          icon={User}
          label="View profile"
          hint={`@${user.username}`}
          onPress={() => open(profilePath(user.username))}
          last={!__DEV__}
        />
        {/* The specimen screen. It was the app bar's action on Home until "Write
            a review" claimed that slot, and this is where a development-only
            surface belongs anyway. */}
        {__DEV__ ? (
          <Row
            icon={Palette}
            label="Design system"
            hint="Every primitive, both themes"
            onPress={() => open("/design-system")}
            last
          />
        ) : null}
      </View>

      <View style={styles.section}>
        <Eyebrow heading rule>
          Appearance
        </Eyebrow>
        <Text size={14} tone="dim" relaxed>
          System follows whatever your device is set to, and changes with it.
        </Text>
        <ThemeSegments />
      </View>

      <View style={styles.section}>
        <Eyebrow heading rule>
          About Sidequestd
        </Eyebrow>

        <View style={styles.group}>
          <Row
            icon={Info}
            label="About"
            hint="What this is, and where the game data comes from"
            onPress={() => open("/about")}
          />
          <Row
            icon={Shield}
            label="Privacy policy"
            hint="What is collected, and what is not"
            onPress={() => open("/privacy")}
          />
          <Row
            icon={FileText}
            label="Terms of service"
            hint="The agreement, and what stays yours"
            onPress={() => open("/terms")}
            last
          />
        </View>
      </View>

      <View style={styles.section}>
        <Eyebrow heading rule>
          Session
        </Eyebrow>
        <Button
          icon={LogOut}
          disabled={signingOut}
          onPress={() => void signOut()}
          style={styles.signOut}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </Button>
        <EyebrowText tone="faint">
          This device forgets the session. Your reviews stay where they are.
        </EyebrowText>
      </View>
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    // One bordered container with hairlines between the rows, rather than a
    // border per row: a list of destinations is one object.
    group: {
      overflow: "hidden",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      borderBottomWidth: 1,
      borderBottomColor: t.color.line,
      paddingHorizontal: 16,
      paddingVertical: 16,
    },
    rowLast: { borderBottomWidth: 0 },
    rowPressed: { backgroundColor: t.color.surface2 },
    rowText: { flex: 1, minWidth: 0 },
    hint: { marginTop: 4 },

    section: { gap: 14 },
    signOut: { alignSelf: "flex-start" },
  });
