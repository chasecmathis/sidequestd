/**
 * The frame around every signed-out screen — the native `AuthShell`.
 *
 * The web's version is two columns above `lg`: the pitch on the left, the card
 * on the right. It already drops the pitch below `lg`, and for a reason that
 * holds even harder here — someone who has the app installed and open is past
 * being told what it is. So this is the web's single-column layout, exactly:
 * mark, card, one line under it.
 *
 * What carries over is everything that makes those screens feel like the app
 * rather than like a form: the bloom, the panel shadow, the serif title, and the
 * theme control in the corner. Two of them are rebuilt rather than ported.
 *
 * **The bloom is a gradient, not a blur.** On the web it is a circle with
 * `blur-[120px]` over it. React Native has no filter, and the naive translation
 * — a `bloom`-coloured circle with a border radius — has a hard edge that reads
 * as a bug on a phone screen. So it is drawn as a radial gradient whose stops
 * fade the same token to nothing, which is what the blur was approximating.
 *
 * **The keyboard is a layout participant.** No web equivalent exists. Half the
 * screen disappears the moment a field is focused, and a login button under it
 * is a login button nobody can reach — hence the avoiding view and the scroll,
 * which stays a scroll even on the short screens where nothing overflows.
 */
import { Link } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import type { ReactNode } from "react";

import { rounded, text, useStyles, useTokens, type Tokens } from "@/theme";

import { ThemeToggle } from "./theme-toggle";
import { Text } from "./ui/text";
import { Wordmark } from "./ui/wordmark";

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const styles = useStyles(make);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <Bloom />

      {/* Pinned to the corner rather than placed in a bar, the same call the web
          makes: these screens have no app bar, and without this they would be
          the two places in the app where the theme cannot be changed. */}
      <View style={[styles.toggle, { top: insets.top + 4 }]}>
        <ThemeToggle />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        // Android resizes the window itself; adding padding on top of that
        // double-counts the keyboard and pushes the card off the screen.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + 64, paddingBottom: insets.bottom + 32 },
          ]}
          keyboardShouldPersistTaps="handled"
          // Dragging the form dismisses the keyboard, which is how every native
          // form behaves and the only gesture that reveals a submit button the
          // keyboard is covering.
          keyboardDismissMode="on-drag"
        >
          <Wordmark size="md" style={styles.mark} />

          <View style={styles.card}>
            <Text variant="display" size={text.size.page} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? (
              <Text size={14} tone="dim" relaxed style={styles.subtitle}>
                {subtitle}
              </Text>
            ) : null}
            <View style={styles.body}>{children}</View>
          </View>

          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/**
 * The one place in the app the accent is used as light rather than as ink.
 *
 * It is what keeps a near-black screen from reading as an error state, and on
 * the light theme it does the opposite job — stopping a pale screen from reading
 * as blank. The two need different alphas to land in the same place, which is
 * why `bloom` is its own token and not `accent` at an opacity.
 *
 * Sized and placed off the top-left corner in screen widths, so it is the same
 * gesture on a small phone and a tablet instead of a fixed circle that swamps
 * one and disappears on the other.
 */
function Bloom() {
  const tokens = useTokens();
  const { width } = useWindowDimensions();
  const size = width * 1.7;

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: -size * 0.45,
        top: -size * 0.2,
        width: size,
        height: size,
      }}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="auth-bloom" cx="50%" cy="50%" r="50%">
            {/* `t.bloom` and not `t.color.bloom`: a stop's colour is stripped of
                its alpha and takes its opacity from `stopOpacity` alone, so the
                rgba token would paint a solid orchid disk. Same value, split —
                see `bloomLayer` in the tokens package. */}
            <Stop offset="0" stopColor={tokens.bloom.color} stopOpacity={tokens.bloom.opacity} />
            {/* The same colour at zero, so the edge is the fade rather than a
                boundary — which is what the web's blur is approximating. */}
            <Stop offset="1" stopColor={tokens.bloom.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#auth-bloom)" />
      </Svg>
    </View>
  );
}

/**
 * The line under the card: a sentence and the one place it goes.
 *
 * A row rather than a `<Text>` with an inline link, which is what the web has.
 * Native can nest a pressable in running text, but the hit area it gets is the
 * glyphs themselves — around 14pt tall, well under the 44pt floor. Splitting the
 * sentence lets the link carry a real target and `hitSlop` on top of it.
 */
export function AuthFooter({
  prompt,
  label,
  href,
  quiet = false,
}: {
  prompt?: string;
  label: string;
  /** Always within `(auth)`, and always `replace`: see below. */
  href: string;
  /**
   * The web's two link weights, kept: the alternative *route* under the card is
   * `text-fg`, while a secondary way out from inside the form — "Forgot your
   * password?" — is `text-fg-dim`. Same component, since they differ by one
   * colour and a weight and nothing else.
   */
  quiet?: boolean;
}) {
  const styles = useStyles(make);

  return (
    <View style={styles.footerRow}>
      {prompt ? (
        <Text size={14} tone="dim">
          {prompt}
        </Text>
      ) : null}

      {/* `replace`, so sign-in ⇄ register ⇄ forgot does not build a stack of
          auth screens that the back gesture then walks the reader through. */}
      <Link href={href} replace asChild>
        <Pressable hitSlop={12} accessibilityRole="link">
          {({ pressed }) => {
            // Press moves each link one step towards the other — the quiet one
            // brightens, the loud one dims — which is the web's hover in both
            // directions. Either way something changes under the thumb.
            const resting = quiet ? "dim" : "fg";
            const held = quiet ? "fg" : "dim";

            return (
              <Text
                size={14}
                weight={quiet ? "regular" : "medium"}
                tone={pressed ? held : resting}
                style={styles.link}
              >
                {label}
              </Text>
            );
          }}
        </Pressable>
      </Link>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.canvas },
    flex: { flex: 1 },

    toggle: { position: "absolute", right: 8, zIndex: 1 },

    content: {
      flexGrow: 1,
      justifyContent: "center",
      paddingHorizontal: 20,
    },

    mark: { alignSelf: "center", marginBottom: 36 },

    card: {
      ...rounded(t.radius.xl),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      padding: 24,
      // The one card in the app that gets a shadow: it is the only thing on the
      // screen, it sits over the bloom rather than over the canvas, and `panel`
      // is the token that exists for exactly this surface.
      ...t.elevation.panel,
    },

    subtitle: { marginTop: 10 },
    body: { marginTop: 28, gap: 16 },

    footer: { marginTop: 24 },
    footerRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
    },
    link: { textDecorationLine: "underline" },
  });
