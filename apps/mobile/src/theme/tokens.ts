/**
 * Editorial Noir, in the shape React Native wants it.
 *
 * Nothing is *decided* here — every value comes from `@sidequestd/design-tokens`,
 * which the web reads through its generated stylesheet. This module only
 * rearranges those values into the four objects a native component actually
 * reaches for, so a style can say `t.color.surface` and `t.elevation.panel`
 * instead of indexing two records by theme name at every call site.
 *
 * The four objects are built once, at module scope, and are therefore stable
 * identities for the lifetime of the app. `useStyles` depends on that: it caches
 * a `StyleSheet` per (factory, tokens) pair, and a token object rebuilt on each
 * render would make that cache a memory leak instead of a cache.
 *
 * ---
 *
 * **The one place a token is copied rather than imported** is `app.json`,
 * because everything in it is read by the OS before any JavaScript exists. Four
 * literals live there now:
 *
 *   - the launch screen's background and the root view colour — `canvas` in
 *     each mode;
 *   - the Android adaptive icon's background layer and the tint Android applies
 *     to the notification silhouette — `accent`, dark.
 *
 * If either token changes, that file is the second edit. The images beside them
 * are generated from the same palette, so they at least cannot drift on their
 * own — see `packages/design-tokens/src/cli/emit-brand.ts`.
 */
import {
  bloomLayer,
  elevation,
  fixed,
  grain,
  motion,
  nativeFamilies,
  overMedia,
  palettes,
  radius,
  scrimLayer,
  type Elevation,
  type Palette,
  type ThemeName,
} from "@sidequestd/design-tokens";

/** The palette plus the two colours that do not invert, in one flat namespace. */
export type Colors = Palette & typeof fixed;

export interface Tokens {
  /** Which palette is on screen. Useful for the status bar and for asserting in tests. */
  name: ThemeName;
  /** True inside an `<OverMedia>` subtree — see `toMedia` below. */
  onMedia: boolean;
  color: Colors;
  radius: typeof radius;
  /** The native halves only; the CSS strings are the web's business. */
  elevation: { pop: Elevation["native"]; panel: Elevation["native"] };
  /** Opacity for the grain layer, per mode. */
  grain: number;
  /**
   * The bloom as a gradient stop wants it: a colour and an alpha, separately.
   *
   * `color.bloom` is the same value as one rgba string, and is correct anywhere
   * React Native does the compositing — a `backgroundColor`, a border. It is
   * *not* correct inside `<Stop>`, which throws the alpha away and leaves the
   * accent at full strength. The tokens package documents that trap at
   * `bloomLayer`; this is the field to reach for when drawing one.
   */
  bloom: (typeof bloomLayer)[ThemeName];
  /**
   * `color.scrim` in the same two halves, for the same reason `bloom` is split.
   *
   * Reach for this when the scrim *fades* — a gradient under a tile's rating —
   * and for `color.scrim` when it is a flat fill. Both are the one value.
   */
  scrim: typeof scrimLayer;
  motion: typeof motion;
  font: typeof nativeFamilies;
}

function build(name: ThemeName): Tokens {
  return {
    name,
    onMedia: false,
    color: { ...palettes[name], ...fixed },
    radius,
    elevation: {
      pop: elevation[name].pop.native,
      panel: elevation[name].panel.native,
    },
    grain: grain[name],
    bloom: bloomLayer[name],
    scrim: scrimLayer,
    motion,
    font: nativeFamilies,
  };
}

/**
 * A subtree sitting on artwork.
 *
 * The web does this with inherited custom properties (`@utility over-media`);
 * the mechanism differs but the decision is identical, and it is documented at
 * `overMedia` in the tokens package. Four roles are pinned to their dark-theme
 * values because what is behind them is a photograph rather than one of our
 * surfaces — most visibly, a light-theme star rating over a black scrim would
 * otherwise paint its *filled* stars darker than its empty ones.
 *
 * Everything else keeps following the theme: a button inside a scrim is still a
 * button, and `accent`/`accentInk` still have to be the pair that reads.
 */
function toMedia(base: Tokens): Tokens {
  return {
    ...base,
    onMedia: true,
    color: { ...base.color, ...overMedia },
  };
}

const BASE: Record<ThemeName, Tokens> = {
  dark: build("dark"),
  light: build("light"),
};

const ON_MEDIA: Record<ThemeName, Tokens> = {
  dark: toMedia(BASE.dark),
  light: toMedia(BASE.light),
};

/** The token set for a resolved theme. One of exactly four objects, always. */
export function tokensFor(name: ThemeName, onMedia = false): Tokens {
  return (onMedia ? ON_MEDIA : BASE)[name];
}

export type { ThemeName };
