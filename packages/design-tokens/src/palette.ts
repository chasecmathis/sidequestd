/**
 * Editorial Noir — the colour system, and the reasoning behind it.
 *
 * Quiet surfaces, loud typography. Cover art is the only saturated colour on
 * screen; the chrome is one near-neutral, hairline rules and one electric
 * orchid.
 *
 * The governing rule, which everything below is built to hold: **the accent
 * appears as a fill, a border or a focus ring — almost never as body text.**
 * Actions are filled blocks, inline links are ordinary text with an underline
 * that turns orchid on hover, and the amber stars stay the one warm chromatic
 * thing on a card — so they read as data rather than decoration. Purple and
 * amber sit almost opposite each other on the wheel, so the two never muddy;
 * the rule is what keeps the page from acquiring a third coloured voice.
 *
 * ---
 *
 * There are two modes, and they are the same design system. Inverting a theme
 * means inverting the ramp, not the relationship — `surface` is always a card
 * lifted off `canvas`, whichever direction "lifted" happens to point.
 *
 * This module is the single source of truth for both clients. The web consumes
 * it through `emitCss`, which writes the Tailwind `@theme` block; the native
 * client consumes the objects directly. Neither hard-codes a hex, so the two
 * cannot drift.
 *
 * Alpha values are written in the legacy `rgba(r, g, b, a)` form deliberately:
 * it is valid CSS *and* the only form React Native parses, so one string serves
 * both. Tailwind's own alpha modifiers (`bg-canvas/80`) keep working on top of
 * the hex tokens, since those compile to a `color-mix()` over the variable.
 */

/** Every colour role in the system. Both modes must supply all of them. */
export interface Palette {
  /* Canvas & surfaces. Whichever mode is on, surfaces get lighter as they
     rise — canvas is the page, `surface` is a card lifted off it, `surface2`
     is an inset or a hover. */
  canvas: string;
  surface: string;
  surface2: string;
  line: string;
  lineStrong: string;

  /* Foreground. Off-white on dark, near-black on light — never pure white or
     pure black, both of which glare against their own ground. Named `fg`
     rather than `text` so the web utility reads `text-fg` instead of
     `text-text`. */
  fg: string;
  /** Non-essential metadata at >=14px only. Below that `fgFaint` fails AA. */
  fgDim: string;
  fgFaint: string;

  /* The only brand chroma. */
  accent: string;
  accentDim: string;
  /** The text colour that sits *on* an accent fill. Inverts with the accent,
      which is why every component can say "accent background, accentInk text"
      and be correct in both modes. */
  accentInk: string;
  accentWash: string;
  /** The accent used as light rather than as ink: the blurred bloom behind the
      landing headline and the auth card. A complete rgba rather than an alpha
      modifier, because the right opacity is not the same on both grounds — 8%
      of a luminous orchid glows on black, 8% of a deep one smears grey on
      paper. */
  bloom: string;

  /* Semantic. */
  star: string;
  danger: string;
  success: string;
}

/**
 * Dark — the brand's own mode, and the fallback for an unattributed document.
 *
 * The near-black carries the faintest violet cast, so the greys agree with the
 * accent rather than sitting under it — the same reason they would lean warm
 * under a warm accent. Never a blue-black: that is the default dark mode
 * everything else already looks like.
 */
export const dark: Palette = {
  canvas: "#0a090d",
  surface: "#131218",
  surface2: "#1c1b24",
  line: "#282634",
  lineStrong: "#3c3a4d",

  fg: "#f1eff5",
  fgDim: "#a3a0ae",
  fgFaint: "#6c6979",

  /* Light and luminous rather than a mid-tone violet: the accent's whole job is
     to be a bright block on a black page, and that only works if the fill
     carries dark text. A saturated purple would need white text and would read
     muted at the same size. */
  accent: "#c08cff",
  accentDim: "#a96ff5",
  accentInk: "#12091c",
  accentWash: "rgba(192, 140, 255, 0.12)",
  bloom: "rgba(192, 140, 255, 0.08)",

  star: "#f5b942",
  danger: "#ff6b5a",
  success: "#6fd98f",
};

/**
 * Light — the same rules, applied in reverse.
 *
 * Not white. The dark canvas is a near-black with a violet cast so the greys
 * agree with the orchid; the light canvas is a violet-cast paper for the
 * identical reason, and cards go *up* to near-white on top of it. A pure-white
 * page with grey cards would invert the elevation ramp and land on the generic
 * dashboard look this palette exists to avoid.
 *
 * The values are tuned to the dark theme's contrast *ratios*, not merely to the
 * AA threshold: `fgDim` is 7.9:1 here against 7.8:1 there, and `fgFaint` 4.1:1
 * against 3.7:1. Both modes therefore have the same tonal rhythm, rather than
 * one of them being flatter than the other.
 */
export const light: Palette = {
  canvas: "#f7f5fa",
  surface: "#ffffff",
  surface2: "#f1eef6",
  line: "#e1ddea",
  lineStrong: "#c8c3d6",

  fg: "#191622",
  fgDim: "#4e4a5b",
  fgFaint: "#7a7688",

  /* Deep rather than luminous — the mirror of the note on `dark`. The dark
     theme's accent on paper is a pale smudge; this one is a solid block that
     carries white ink, so an accent fill still reads as the one unmissable
     action on the screen. Same hue family, opposite lightness. */
  accent: "#6b3fc4",
  accentDim: "#5a31ab",
  accentInk: "#ffffff",
  accentWash: "rgba(107, 63, 196, 0.1)",
  bloom: "rgba(107, 63, 196, 0.07)",

  /* Amber and green go dark enough to be read as text on paper; the star in
     particular keeps its warmth rather than turning brown. */
  star: "#8a5a05",
  danger: "#c2352a",
  success: "#1c7a46",
};

/**
 * Fixed in both modes, and that is the point.
 *
 * These are for type and chrome laid *over user media* — a cover-art scrim, a
 * badge on a screenshot, the letterboxing behind a video. What sits behind them
 * is an arbitrary photograph, not one of our surfaces, so it does not get
 * lighter when the page does. Named tokens rather than a bare black/70 so the
 * next reader can see this is a decision and not a spot that was missed.
 */
export const fixed = {
  scrim: "rgba(0, 0, 0, 0.72)",
  onScrim: "#ffffff",
} as const;

/**
 * A patch of dark, sitting on artwork.
 *
 * `fixed` above covers a flat fill and the type on it. This covers the harder
 * case: a *subtree* over media, containing components that colour themselves
 * from the palette and have no idea they are on a photograph.
 *
 * The concrete failure it fixes: the rating inside a review tile's scrim.
 * `StarRating` paints filled stars with `star` and empty ones with
 * `lineStrong`, which on paper are a dark amber and a mid grey — and over a
 * black gradient that renders the *filled* stars darker than the empty ones.
 * The rating reads inverted, in the one theme nobody would think to check it in.
 *
 * The values are the dark theme's, repeated deliberately. This is not "the dark
 * theme" but "the palette for type on an arbitrary photograph", which happens
 * to coincide with it and must not follow it if it changes. On the web these
 * are redeclared as inherited custom properties (`@utility over-media`); on
 * native the same job is done by a context provider swapping the token set for
 * its subtree.
 */
export const overMedia = {
  fg: "#f1eff5",
  fgDim: "#a3a0ae",
  star: "#f5b942",
  lineStrong: "#3c3a4d",
} as const;

export type ThemeName = "dark" | "light";

export const palettes: Record<ThemeName, Palette> = { dark, light };

/**
 * The bloom again, split into a colour and an alpha.
 *
 * Not a second decision — the same one, in the second shape a platform needs,
 * exactly as `Elevation` carries both a `css` and a `native` spelling of one
 * shadow. `palette.test.ts` asserts the two agree, so this cannot drift.
 *
 * The reason it exists is narrow and worth naming, because it is invisible until
 * it is on a screen: React Native's SVG **discards the alpha of a gradient
 * stop's colour** and takes the stop's opacity from `stopOpacity` alone, which
 * defaults to 1. `stopColor="rgba(192, 140, 255, 0.08)"` therefore paints a
 * solid orchid disk — no error, no warning, just the accent at twelve times its
 * intended strength across half the screen.
 *
 * Native draws the bloom as a gradient because it has no blur filter (see the
 * mobile `AuthShell`), so it is the platform that has to say the alpha out loud.
 */
export const bloomLayer: Record<ThemeName, { color: string; opacity: number }> = {
  dark: { color: "#c08cff", opacity: 0.08 },
  light: { color: "#6b3fc4", opacity: 0.07 },
};

/**
 * `fixed.scrim`, split the same way and for the same reason as `bloomLayer`.
 *
 * A flat scrim is one colour and `fixed.scrim` says it; a scrim that *fades* —
 * the gradient under a review tile's rating, black at the bottom and nothing at
 * the top — is a gradient, and on native a gradient is SVG stops. Those discard
 * a colour's alpha (see above), so the strength has to travel beside the colour
 * rather than inside it. `palette.test.ts` asserts the two spellings agree.
 *
 * Unlike the bloom this does not vary by theme: what is behind it is a
 * photograph, which is the whole point of `fixed`.
 */
export const scrimLayer = { color: "#000000", opacity: 0.72 } as const;
