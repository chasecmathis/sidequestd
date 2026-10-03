/**
 * The logomark, as geometry.
 *
 * A sword passing through a quest card: a rounded-rect outline broken at the
 * top and bottom centre, where the blade enters and leaves. Drawn once, here,
 * as path data — not shipped as an exported PNG.
 *
 * That is the whole point of this module. There are eleven places the mark has
 * to appear (two app icons, an Android adaptive foreground, two splash screens,
 * a notification silhouette, a favicon, an Apple touch icon, an Open Graph
 * card, and the wordmark inside each client) and only one of them can be an
 * image the other ten are cropped from. So both clients render *these strings*
 * — the web as an inline `<svg>`, native through `react-native-svg` — and
 * `cli/emit-brand.ts` builds every raster from them too. A change to the mark
 * is a change to one file, and nothing downstream can disagree about the shape.
 *
 * Same argument as `palette.ts` and `emitCss`, and the same `--check` in lint
 * to enforce it.
 *
 * ---
 *
 * The coordinates were traced off the original 500×500 artwork and are exact to
 * within antialiasing: rendering this at 500×500 over `dark.accent` and
 * differencing against that file leaves 13 pixels of 250,000, all of them on
 * the curves. They are kept as literals rather than derived from radii and
 * ratios because a logo is a drawing, not a formula — the numbers mean nothing
 * except "this is the shape", and inventing a parametric model for them would
 * only add a way to be wrong.
 */

/**
 * The mark's own coordinate space — its bounding box, nothing around it.
 *
 * Portrait, 130×174 (a ratio of ~0.747). Consumers that need breathing room add
 * their own padding, which is what `ICON_PADDING` below is for; a viewBox with
 * the padding baked in would make the in-app glyph impossible to align with
 * text.
 */
export const VIEW_BOX = { width: 130, height: 174 } as const;

/** `"0 0 130 174"` — the string form, for an `svg` element's attribute. */
export const VIEW_BOX_ATTR = `0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`;

/**
 * The stroked parts of the mark, and the one width they all share.
 *
 * Three separate strokes rather than one path because they differ in width and
 * cap: the card is 6 and butt-capped, the grip 9 and butt, the guard 7 and
 * round. A single path could not express that, and merging them into outlines
 * would turn four legible numbers into a wall of bezier control points.
 */
export const STROKES = [
  {
    /**
     * The card, as two open arcs rather than a closed rect.
     *
     * Each runs from a top-edge break, around its side, to a bottom-edge break.
     * The breaks are what makes the mark read as a sword *through* a card
     * instead of one sitting on top of it — the top one (x 46.5→83.5) is where
     * the grip enters, the bottom one (51.5→78.5) is where the blade would
     * leave. The bottom gap is narrower because the blade has tapered by then.
     *
     * Butt caps, deliberately: round caps would bulge the gap edges inward and
     * close the break by a pixel at every size the mark is actually used at.
     */
    d:
      "M46.5 3 H15 A12 12 0 0 0 3 15 V159 A12 12 0 0 0 15 171 H51.5 " +
      "M83.5 3 H115 A12 12 0 0 1 127 15 V159 A12 12 0 0 1 115 171 H78.5",
    width: 6,
    cap: "butt",
  },
  {
    /**
     * The grip.
     *
     * Stops at y=29, two units short of the guard's crown at 31. The gap is in
     * the original and it is not a slip: the card outline is broken and the
     * blade is hollow, so a hilt drawn as one welded piece would be the only
     * unbroken thing in the mark.
     */
    d: "M65 6 V29",
    width: 9,
    cap: "butt",
  },
  {
    /**
     * The crossguard — a shallow quadratic bowing up, ends turning down.
     *
     * The only round-capped stroke here. Butt caps would cut the tips square
     * across the curve's tangent, which at this angle reads as broken rather
     * than as finished.
     */
    d: "M39 40 Q65 29 91 40",
    width: 7,
    cap: "round",
  },
] as const;

/**
 * The blade: a filled compound path, not a stroke.
 *
 * Two subpaths under `evenodd` — the silhouette, then the fuller down its
 * middle as a real hole. A hole rather than a purple line painted over it,
 * because the Android adaptive foreground and the notification silhouette are
 * both transparent assets: anything "knocked out" with a background colour
 * would show up there as an opaque bar.
 *
 * The silhouette runs straight to y=144 and then converges on the point at
 * (65, 165). The fuller closes at 146, just past where the taper begins — which
 * is where the two walls meet in the original, and falls out of the geometry
 * rather than being chosen.
 */
export const BLADE = {
  d:
    "M57.5 31 V144 L65 165 L72.5 144 V31 Z " +
    "M63.5 38 V143 L65 146 L66.5 143 V38 Z",
  fillRule: "evenodd",
} as const;

/**
 * The ivory the mark is drawn in on a coloured tile.
 *
 * Not `#ffffff`, and not any token in `palette.ts`. Pure white on this purple
 * vibrates; this is the original artwork's value, a white carrying the faintest
 * amount of the accent's own blue. It belongs to the mark rather than to a
 * theme, which is why it lives here and not in the palette — an app icon has no
 * light and dark variant to follow.
 *
 * In-app the mark ignores this entirely and takes `currentColor`, so it is the
 * accent in whichever theme is on.
 */
export const MARK_INK = "#f8f7ff";

/**
 * Glyph height in the wordmark, as a multiple of the type size beside it.
 *
 * Matched to the word's *visible* extent — the S's cap through the q's
 * descender — rather than to the cap height alone. Set to the caps the mark
 * reads as a bracket somebody left in front of the name; given the whole em box
 * it becomes the loudest thing in a 64px bar. This is where it stops looking
 * like a bullet and starts looking like a mark.
 *
 * Shared because the two clients do *not* agree on the type size — the web's
 * larger lockup is 24px and native's is 26 — so the only thing that can keep
 * the two looking like one logo is the ratio between the glyph and the word.
 * Hard-coding it twice would leave them drifting by a pixel and nobody able to
 * say which one was right.
 */
export const WORDMARK_GLYPH_RATIO = 1.12;

/**
 * How much of a square asset's *height* the mark occupies.
 *
 * The mark is the entire content of these files, so this fraction is the whole
 * design decision for each of them — and it genuinely differs per target,
 * because each one is cropped, masked or shrunk by something else before a
 * person sees it. One shared number would be wrong five ways.
 */
export const ICON_PADDING = {
  /**
   * The store icon, matching the original artwork exactly: the mark is 174 of
   * its 500 units tall. Small-looking as a number, correct on a home screen —
   * iOS and Android both round the corners hard, and this is the proportion the
   * mark was drawn at.
   */
  app: 174 / 500,
  /**
   * Android adaptive icons are masked to a launcher-chosen shape and then
   * scaled up: the outer 25% of each edge can be cropped and only the inner 66%
   * is guaranteed to survive. At 0.4 the mark's bounding box has a diagonal of
   * ~0.5 — comfortably inside that circle. Undersized here is a speck; over is
   * a sword with its point cropped off on somebody's launcher.
   */
  adaptive: 0.4,
  /**
   * The favicon, deliberately tighter than `app`. It is displayed at 16px in a
   * tab, where the artwork's own generous margin would leave a mark six pixels
   * tall — a purple smudge. Consistency with the store icon loses to being
   * recognisable at the size it is actually rendered.
   */
  favicon: 0.56,
  /** The splash mark. Nothing else is on the screen; it can breathe. */
  splash: 0.62,
  /**
   * The Android notification icon. Android discards the colour and keeps only
   * the alpha, drawing the result inside a small fixed circle, so this wants to
   * be nearly as tight as the favicon.
   */
  notification: 0.62,
} as const;

/**
 * The mark's `<path>` elements, in its own 130×174 coordinate space.
 *
 * Markup rather than a component, so it can be dropped into any SVG document —
 * the icon generator's, or the social card's, where the mark is one element in
 * a larger composition. The clients do *not* use this: they map `STROKES` and
 * `BLADE` onto their own elements, so the mark takes part in their styling
 * (`currentColor`, a native colour prop) instead of arriving as a blob of
 * pre-coloured markup.
 */
export function markElements(ink: string): string {
  const strokes = STROKES.map(
    (s) =>
      `<path d="${s.d}" fill="none" stroke="${ink}" stroke-width="${s.width}" ` +
      `stroke-linecap="${s.cap}" stroke-linejoin="round"/>`,
  ).join("");

  return `${strokes}<path d="${BLADE.d}" fill="${ink}" fill-rule="${BLADE.fillRule}"/>`;
}

/**
 * Compose the mark into a standalone square SVG document.
 *
 * @param ink        Colour for every stroke and fill.
 * @param background A tile colour behind the mark, or `null` for transparent.
 * @param padding    Fraction of the output *height* the mark should occupy.
 * @param size       Output square edge, in px.
 */
export function markSvg({
  ink = MARK_INK,
  background = null,
  padding = ICON_PADDING.app,
  size = 1024,
}: {
  ink?: string;
  background?: string | null;
  padding?: number;
  size?: number;
} = {}): string {
  const height = size * padding;
  const width = (height * VIEW_BOX.width) / VIEW_BOX.height;
  const scale = height / VIEW_BOX.height;

  const tile = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}">${tile}` +
    `<g transform="translate(${(size - width) / 2} ${(size - height) / 2}) scale(${scale})">` +
    `${markElements(ink)}</g></svg>`
  );
}
