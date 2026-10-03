/**
 * Editorial Noir, as data.
 *
 * The web reads this through `emitCss` at build time; the native client imports
 * the objects directly. See `palette.ts` for the colour system's reasoning and
 * `shape.ts` for everything that is not a colour.
 */
export {
  bloomLayer,
  dark,
  fixed,
  light,
  overMedia,
  palettes,
  scrimLayer,
  type Palette,
  type ThemeName,
} from "./palette";

export {
  elevation,
  grain,
  leading,
  motion,
  radius,
  tracking,
  type,
  type Elevation,
} from "./shape";

export { nativeFamilies, webStacks, type NativeFamily } from "./fonts";

export {
  BLADE,
  ICON_PADDING,
  MARK_INK,
  STROKES,
  VIEW_BOX,
  VIEW_BOX_ATTR,
  WORDMARK_GLYPH_RATIO,
  markElements,
  markSvg,
} from "./brand";

export { emitCss } from "./css";
