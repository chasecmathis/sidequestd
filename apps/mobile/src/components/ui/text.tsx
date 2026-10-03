/**
 * Type, as a component.
 *
 * The web has no equivalent of this file and does not need one: there, a heading
 * is `<h1 className="type-display text-4xl text-fg">` and the cascade supplies
 * the family. React Native has no cascade and no default face — every string
 * needs its own `<Text>` carrying a family, a size and a colour, or it silently
 * renders in the system font at 14px black.
 *
 * So this is the `type-display` / `type-eyebrow` utilities and the `text-fg-dim`
 * colour utilities, in the one form native can express them. Three decisions it
 * makes for every caller:
 *
 *   - a *family*, never a `fontWeight` (see the tokens package on why),
 *   - a line height derived from the size rather than left to the platform,
 *   - a colour from the palette, so nothing paints in the OS default.
 */
import { Text as RNText, type TextProps as RNTextProps } from "react-native";

import { text, useTokens, type Tokens } from "@/theme";

type Variant = "body" | "display" | "mono";
type Weight = "regular" | "medium" | "semibold";

/**
 * The palette roles type is allowed to take.
 *
 * Not every colour: `accent` is here because a rare control does letter itself
 * in it, but the palette rule stands — the accent is a fill or a border, and
 * accent-coloured body text is the thing the system exists to avoid.
 */
type Tone = "fg" | "dim" | "faint" | "accent" | "ink" | "danger" | "success" | "star" | "onScrim";

function toneColor(tokens: Tokens, tone: Tone): string {
  switch (tone) {
    case "fg":
      return tokens.color.fg;
    case "dim":
      return tokens.color.fgDim;
    case "faint":
      return tokens.color.fgFaint;
    case "accent":
      return tokens.color.accent;
    case "ink":
      return tokens.color.accentInk;
    case "danger":
      return tokens.color.danger;
    case "success":
      return tokens.color.success;
    case "star":
      return tokens.color.star;
    case "onScrim":
      return tokens.color.onScrim;
  }
}

export interface TextProps extends RNTextProps {
  variant?: Variant;
  /** Defaults to `text.size.body` (15). Use the named scale, not a magic number. */
  size?: number;
  weight?: Weight;
  tone?: Tone;
  /** Prose leading (1.65) instead of the label default. For anything over one line. */
  relaxed?: boolean;
  /** Display only — the second half of the wordmark, and pull quotes. */
  italic?: boolean;
}

export function Text({
  variant = "body",
  size = text.size.body,
  weight = "regular",
  tone = "fg",
  relaxed = false,
  italic = false,
  style,
  ...props
}: TextProps) {
  const tokens = useTokens();

  const typeStyle =
    variant === "display"
      ? italic
        ? text.displayItalic(size)
        : text.display(size)
      : variant === "mono"
        ? text.mono(size, { medium: weight !== "regular" })
        : text.body(size, { weight, relaxed });

  return <RNText {...props} style={[typeStyle, { color: toneColor(tokens, tone) }, style]} />;
}

/**
 * The mono micro-label, on its own because it is a fixed size — 11px is not a
 * parameter, it is what the token says an eyebrow is.
 *
 * `Eyebrow` in `eyebrow.tsx` is the *component* with the editorial rule beside
 * it; this is the bare label, for the inside of a badge or a tab.
 */
export function EyebrowText({ tone = "faint", style, ...props }: Omit<TextProps, "variant">) {
  const tokens = useTokens();
  return <RNText {...props} style={[text.eyebrow, { color: toneColor(tokens, tone) }, style]} />;
}

/** Shared by the primitives that need a colour without rendering a `<Text>`. */
export { toneColor, type Tone };
