/**
 * The wordmark.
 *
 * The logomark in orchid, then the name split across the display serif's two
 * styles. The accent is a *shape* rather than coloured letters, which is the
 * palette rule the rest of the app follows — and the roman/italic pairing gives
 * the mark its character without needing a second colour to find the seam.
 *
 * The glyph replaces the orchid square that stood here while there was no logo
 * to put in its place. It is drawn from the same geometry as the app icon (see
 * `Logomark`), so the thing in the app bar is literally the thing on the home
 * screen.
 *
 * Purely presentational, and deliberately not a link: it points at Home in the
 * app bar and at nothing on the auth screens. Wrapping it at the call site
 * keeps that decision where the context is.
 *
 * One accessible node, named "Sidequestd" — without that, VoiceOver reads the
 * two `<Text>` runs as "Side" and then "questd", with a picture of the word
 * announced somewhere in between.
 *
 * The other of the app's two capped things (`CHROME_SCALE_CAP`), and the only
 * one where the argument is about what the text *is* rather than about the box
 * it is in. A logotype is a picture of a name: nobody reads it to find out
 * where they are, they recognise it, and recognising a shape does not get
 * easier when the shape is larger than the 56pt bar it is sitting in. Its
 * accessible name is a real string and scales with nothing, which is the path a
 * reader who needs the words actually takes.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { WORDMARK_GLYPH_RATIO } from "@sidequestd/design-tokens";

import { CHROME_SCALE_CAP } from "@/theme";

import { Logomark } from "./logomark";
import { Text } from "./text";

/** `sm` is the app bar's mark; `md` is the auth screens' larger one. */
type Size = "sm" | "md";

const SIZES: Record<Size, number> = { sm: 20, md: 26 };

// A plain stylesheet rather than `useStyles(make)`: the orchid square this
// replaced was the only thing here that needed a token, and the glyph colours
// itself from the theme inside `Logomark`.
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
});

export function Wordmark({ size = "sm", style }: { size?: Size; style?: StyleProp<ViewStyle> }) {
  const fontSize = SIZES[size];

  return (
    <View style={[styles.row, style]} accessible accessibilityLabel="Sidequestd">
      {/* The ratio is shared with the web rather than a number chosen here: the
          two clients disagree about the type size — 24 there, 26 here — so the
          proportion between glyph and word is the only thing that keeps them
          looking like one logo. */}
      <Logomark height={fontSize * WORDMARK_GLYPH_RATIO} />
      <Text variant="display" size={fontSize} maxFontSizeMultiplier={CHROME_SCALE_CAP}>
        Side
        <Text variant="display" size={fontSize} italic tone="dim">
          questd
        </Text>
      </Text>
    </View>
  );
}
