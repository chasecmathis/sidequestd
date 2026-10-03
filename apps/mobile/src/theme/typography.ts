/**
 * The type utilities, as objects.
 *
 * `globals.css` gives the web `type-display`, `type-eyebrow` and the prose
 * measures. None of that is portable — a `@utility` is a CSS construct — so the
 * *metrics* live in `@sidequestd/design-tokens` and this module is the native
 * half that applies them.
 *
 * Two things RN does differently, both of which shape what is below:
 *
 *   **Weights are families.** React Native does not synthesise weights for a
 *   custom face, and on Android asking for one the family does not have silently
 *   falls back to the system font. So a style picks `Figtree_500Medium`; it
 *   never sets `fontWeight`. The one exception is `fontStyle: "italic"`, which
 *   is also a separate file here and so is also a family.
 *
 *   **Line height and tracking are px, not ratios.** Both are derived from the
 *   size through `leading`/`tracking`, so the ratios stay in one place and a
 *   heading at 34 and a heading at 20 are set the same way.
 */
import type { TextStyle } from "react-native";

import { leading, nativeFamilies, tracking, type } from "@sidequestd/design-tokens";

/**
 * Below this, Instrument Serif's thin strokes start to disappear — the tokens
 * package puts the comfortable floor at 28 and tolerates 16 for a card title,
 * where the surrounding type is small enough that the contrast still reads.
 * Anything under 16 is a mistake rather than a choice, and on a phone it is an
 * easy one to make while shrinking a web layout.
 */
const DISPLAY_FLOOR = 16;

/** Headlines. The display serif, with its negative tracking and tight leading. */
export function display(fontSize: number): TextStyle {
  if (__DEV__ && fontSize < DISPLAY_FLOOR) {
    console.warn(
      `display(${fontSize}) is below the ${DISPLAY_FLOOR}px floor — Instrument Serif's ` +
        `hairlines vanish at this size. Use body() for anything this small.`,
    );
  }

  return {
    fontFamily: nativeFamilies.display,
    fontSize,
    letterSpacing: tracking(type.display.letterSpacingRatio, fontSize),
    lineHeight: leading(type.display.lineHeightRatio, fontSize),
  };
}

/** The wordmark's second half, and pull quotes. The italic is its own face. */
export function displayItalic(fontSize: number): TextStyle {
  return { ...display(fontSize), fontFamily: nativeFamilies.displayItalic };
}

/**
 * The signature micro-label: small mono caps.
 *
 * `textTransform` rather than upper-cased strings at the call site, so the
 * accessible name a screen reader announces stays sentence case.
 *
 * The size is fixed at 11 by the token, and it is doing a lot of work at that
 * size — it is the app's smallest type, so it is only ever used on `fgDim` or
 * darker, never on `fgFaint`.
 */
export const eyebrow: TextStyle = {
  fontFamily: nativeFamilies.mono,
  fontSize: type.eyebrow.fontSize,
  letterSpacing: tracking(type.eyebrow.letterSpacingRatio, type.eyebrow.fontSize),
  lineHeight: leading(type.eyebrow.lineHeightRatio, type.eyebrow.fontSize),
  textTransform: type.eyebrow.textTransform,
};

type Weight = "regular" | "medium" | "semibold";

const SANS: Record<Weight, string> = {
  regular: nativeFamilies.sans,
  medium: nativeFamilies.sansMedium,
  semibold: nativeFamilies.sansSemibold,
};

/**
 * Everything that is not a headline and not data.
 *
 * `relaxed` is the ratio the web sets on descriptions and review prose
 * (`leading-relaxed`, 1.625); the default 1.45 is for labels and single lines,
 * where the web's `leading-none`-ish default sits.
 */
export function body(
  fontSize: number,
  { weight = "regular", relaxed = false }: { weight?: Weight; relaxed?: boolean } = {},
): TextStyle {
  return {
    fontFamily: SANS[weight],
    fontSize,
    lineHeight: leading(relaxed ? type.prose.lineHeightRatio : 1.45, fontSize),
  };
}

/**
 * A single-line `TextInput`'s type: `body`, with the line height taken back off.
 *
 * Every other style in this module sets a line height, because leaving one to
 * the platform is how two adjacent labels end up set differently. A single-line
 * input is the exception, and it is a platform bug rather than a design choice:
 * iOS applies a line height to a field's text through a paragraph style, but
 * measures the *caret* from the font's own metrics. Set both and they disagree —
 * the text sits low in the box while the caret stands taller than the letters it
 * is standing in.
 *
 * It shows up in exactly one place per screen, which is what makes it confusing
 * to spot: `secureTextEntry` renders through a different path on iOS and ignores
 * the paragraph style, so a login form has the bug in the email field and not in
 * the password field directly beneath it.
 *
 * Multi-line inputs are fine and keep their leading — prose needs it, and there
 * is no single line for a caret to be centred against.
 */
export function input(fontSize: number): TextStyle {
  const style = body(fontSize);
  delete style.lineHeight;
  return style;
}

/** Anything that is data: counts, timestamps, playtimes, a rating out of five. */
export function mono(fontSize: number, { medium = false }: { medium?: boolean } = {}): TextStyle {
  return {
    fontFamily: medium ? nativeFamilies.monoMedium : nativeFamilies.mono,
    fontSize,
    lineHeight: leading(1.4, fontSize),
  };
}

/**
 * The size scale, named.
 *
 * These are the web's Tailwind steps re-checked on a 390px screen rather than
 * scaled down from a desktop layout — `page` is the one that moved, since the
 * web's 36/48px `<h1>` is set against a 1024px measure and simply does not fit
 * "Notifications" across a phone.
 */
export const size = {
  /** A screen's `<h1>`. */
  page: 34,
  /** A section heading, and an `EmptyState` title. */
  section: 22,
  /** A card title. The floor for the display face. */
  title: 17,
  body: 15,
  small: 13,
  fine: 12,
} as const;

/**
 * Dynamic Type, and the app's one rule about it.
 *
 * React Native scales every `<Text>` by the system's text size and does not cap
 * it, which is right and is why nothing in this app opts out: somebody who set
 * their phone to a larger size did so in order to read, and the sizes above are
 * a *default* rather than a decision about their eyesight. Every paragraph,
 * every review, both policy documents and every heading scale all the way up.
 *
 * Two things cannot. A tab bar's unread badge is an 18pt capsule positioned off
 * the shoulder of a 22pt icon, and the wordmark is a logotype in a 56pt bar —
 * neither is reading material, and neither has anywhere to grow into. Those get
 * `CHROME_SCALE_CAP`, and they are the only two.
 *
 * Everything in between — a button, a chip, a badge, a segmented control — grows
 * its box instead of capping its type. `Button` is the one that had to be taught
 * how; the rest were already built on padding rather than on a height, which is
 * why they needed nothing.
 */
export const CHROME_SCALE_CAP = 1.2;

/**
 * Where a fixed-height control stops being able to hold a one-line label.
 *
 * 1.3 is not arbitrary: iOS's default is 1.0 and its next three steps are 1.12,
 * 1.23 and 1.35, so this sits between "large" and "extra large" — the point at
 * which a 14pt label in a 44pt box with 10pt of padding either wraps or is cut.
 * Below it nothing in the app changes, which is most of the argument for having
 * a threshold at all rather than always growing.
 */
export const LARGE_TEXT_SCALE = 1.3;
