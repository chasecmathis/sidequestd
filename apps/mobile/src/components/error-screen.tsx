/**
 * What a reader sees when a screen throws while rendering.
 *
 * The other half of `app/+not-found.tsx`: those are the two places Expo Router
 * has a built-in screen of its own, and both of them drop out of this app's
 * design system at the exact moment the reader most needs to recognise where
 * they are. In development the built-in is a red box of stack frames, and in a
 * release build it is a blank white screen — which is indistinguishable from a
 * crash, and is the version an actual reader would meet.
 *
 * **It cannot assume any provider.** That is the constraint that shapes the rest
 * of the file. Expo Router mounts an `ErrorBoundary` around the layout that
 * exported it, so this can be asked to render because `AppThemeProvider`,
 * `AuthProvider` or `SafeAreaProvider` was the thing that threw. So:
 *
 *   - No `<Screen>` and no `useSafeAreaInsets`. It pays a flat inset instead,
 *     generous enough to clear a notch on the phones that have one.
 *   - No `useTheme`, which is the one hook in this app that genuinely requires
 *     its provider. `useStyles` does not — `theme/index.tsx` defaults the token
 *     context to dark precisely so a boundary above the provider still paints in
 *     the brand's own mode, and names this case while doing it.
 *
 * The error's own message is on screen and selectable, for the reason
 * `ui/alert.tsx` gives about error strings: this is the one piece of text a
 * reader has a reason to lift off the screen and into a bug report, and on a
 * phone long-press-to-select is the only way to. It is shown in release builds
 * too. A JavaScript render error says something like "undefined is not an
 * object" — it names nothing private, and "Something went wrong" tells the one
 * person who could act on it nothing at all.
 */
import { RotateCw, TriangleAlert } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { rounded, text, useStyles, useTokens, type Tokens } from "@/theme";

import { Button } from "./ui/button";
import { Text } from "./ui/text";

export function ErrorScreen({ error, retry }: { error: Error; retry: () => void }) {
  const styles = useStyles(make);
  const tokens = useTokens();

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        <TriangleAlert size={28} strokeWidth={1.25} color={tokens.color.fgFaint} />

        <Text variant="display" size={text.size.section} accessibilityRole="header">
          This screen stopped
        </Text>

        <Text size={text.size.body} tone="dim" relaxed style={styles.explain}>
          Something in the app went wrong while drawing this. Nothing you wrote has been lost —
          reviews, comments and lists are all on the server, not in here.
        </Text>

        {/* Mono, because it is data rather than a sentence — the same rule the
            rest of the app applies to counts, timestamps and playtimes. */}
        <View style={styles.detail}>
          <Text variant="mono" size={text.size.fine} tone="faint" selectable>
            {error.message || String(error)}
          </Text>
        </View>

        <Button icon={RotateCw} variant="primary" onPress={retry} style={styles.retry}>
          Try again
        </Button>
      </View>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.color.canvas,
      justifyContent: "center",
      // A flat inset rather than a measured one: there may be no
      // `SafeAreaProvider` above this, and 64 clears every notch this app runs
      // under. It is only ever wrong by being slightly too generous, on a
      // screen with one paragraph and one button on it.
      paddingHorizontal: 24,
      paddingVertical: 64,
    },
    body: { alignItems: "center", gap: 16 },
    explain: { textAlign: "center", maxWidth: 340 },

    detail: {
      alignSelf: "stretch",
      ...rounded(t.radius.md),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },

    retry: { marginTop: 8 },
  });
