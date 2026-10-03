/**
 * Shape, elevation, motion and type — everything in the system that is not a
 * colour.
 */
import type { ThemeName } from "./palette";

/**
 * Corner radii, in px.
 *
 * Tighter than a blanket 16px: an editorial card wants a corner you can see is
 * deliberate, not a pill. On the web these override Tailwind's defaults, so
 * `rounded-lg` means `lg` here everywhere.
 */
export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  "2xl": 24,
} as const;

/**
 * Motion.
 *
 * One deceleration curve for the whole app. On the web this overrides
 * Tailwind's default easing, so every `transition` decelerates the same way
 * without being told to.
 */
export const motion = {
  /** The curve, as its four control points — the one portable spelling. */
  easeOut: [0.16, 1, 0.3, 1] as const,
  easeOutCss: "cubic-bezier(0.16, 1, 0.3, 1)",
  duration: {
    /** Press feedback, colour changes on a control. */
    fast: 150,
    /** Surfaces: a card border, a panel opening. */
    base: 200,
    /** Media: a cover image easing under a press. */
    slow: 500,
  },
} as const;

/**
 * Elevation.
 *
 * A shadow is the one thing here that cannot survive an inversion as an alpha:
 * `black/70` is atmosphere on near-black and a bruise on paper. So each mode
 * supplies the whole shadow.
 *
 * `pop` is for things that appear *over* the page — menus, dialogs, sheets.
 * `panel` is for things that are part of the page but lifted off it — the auth
 * card, a game's cover art.
 *
 * Two shapes, because the platforms disagree about what a shadow is. The CSS
 * form has a spread radius; React Native has none, so the native form folds the
 * spread into a smaller offset and blur, and Android gets an `elevation` step
 * because it has no concept of a shadow colour at all.
 */
export interface Elevation {
  css: string;
  native: {
    shadowColor: string;
    shadowOffset: { width: number; height: number };
    shadowOpacity: number;
    shadowRadius: number;
    elevation: number;
  };
}

/** Violet-tinted shade on light, never pure black: a neutral shadow on
    violet-cast paper reads as dirt. Alpha is around a third of the dark
    theme's — a shadow on light is doing separation, not atmosphere. */
const LIGHT_SHADOW_RGB = "42, 36, 56";

export const elevation: Record<ThemeName, { pop: Elevation; panel: Elevation }> = {
  dark: {
    pop: {
      css: "0 24px 48px -12px rgba(0, 0, 0, 0.7)",
      native: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.7,
        shadowRadius: 20,
        elevation: 12,
      },
    },
    panel: {
      css: "0 20px 40px -16px rgba(0, 0, 0, 0.55)",
      native: {
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.55,
        shadowRadius: 16,
        elevation: 6,
      },
    },
  },
  light: {
    pop: {
      css: `0 24px 48px -12px rgba(${LIGHT_SHADOW_RGB}, 0.18)`,
      native: {
        shadowColor: "#2a2438",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 20,
        elevation: 12,
      },
    },
    panel: {
      css: `0 20px 40px -16px rgba(${LIGHT_SHADOW_RGB}, 0.12)`,
      native: {
        shadowColor: "#2a2438",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 6,
      },
    },
  },
};

/**
 * Grain opacity, per mode.
 *
 * The cheapest thing that stops a flat canvas from reading as "unstyled": one
 * fixed layer of turbulence over everything, clickable through. Noise is far
 * more visible on paper than on near-black, so the same 3.5% that reads as
 * texture there reads as a dirty screen here — hence two values rather than one.
 */
export const grain: Record<ThemeName, number> = {
  dark: 0.035,
  light: 0.022,
};

/**
 * The three faces, by role.
 *
 * Each platform binds its own family names — the web through `next/font`
 * variables, native through `expo-font` — but the *roles* and their metrics are
 * fixed here so a heading lands at the same proportions on both.
 */
export const type = {
  /**
   * Headlines. Instrument Serif is a high-contrast face: set loose it looks
   * accidental, and below about 28px the thin strokes start to disappear. The
   * one exception the system tolerates is a card title at 16px, where the
   * surrounding type is small enough that the contrast still reads.
   */
  display: {
    /** Negative tracking, as a ratio of font size. RN wants px, CSS wants em. */
    letterSpacingRatio: -0.02,
    lineHeightRatio: 1.02,
  },
  /**
   * The signature micro-label. Small mono caps are what make metadata read as
   * typeset data rather than as small grey text — a rating, a playtime, a
   * section eyebrow, a timestamp.
   */
  eyebrow: {
    fontSize: 11,
    letterSpacingRatio: 0.12,
    lineHeightRatio: 1,
    textTransform: "uppercase" as const,
  },
  /** Review prose: a measure, so a long review does not run the full width of
      a desktop card and become unreadable. Native is always narrower than the
      measure, so this only bites on the web. */
  prose: {
    maxWidthCh: 66,
    lineHeightRatio: 1.65,
  },
} as const;

/** Tracking in px, for a native `letterSpacing` at a given size. */
export function tracking(ratio: number, fontSize: number): number {
  return ratio * fontSize;
}

/** Line height in px, for a native `lineHeight` at a given size. */
export function leading(ratio: number, fontSize: number): number {
  return Math.round(ratio * fontSize);
}
