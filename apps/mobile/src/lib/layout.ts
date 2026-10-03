/**
 * The one horizontal measurement every screen shares, and the arithmetic that
 * turns it into grid columns.
 *
 * The web sizes a grid with `grid-cols-3` and lets the browser divide the row.
 * React Native's flexbox has no grid and no `calc()`, so a wrapping row of
 * percentage-width cells has a bug that only shows on the last row: a cell with
 * `flexGrow` stretches to fill the space its missing neighbours left, so a list
 * of four games renders three normal cards and one double-width one. Dropping
 * `flexGrow` instead leaves a ragged right edge on every row.
 *
 * Both are avoided by giving cells a *pixel* width worked out from the screen,
 * which is the only width these grids are ever laid out in: full bleed between
 * the screen's two gutters.
 */
import { useWindowDimensions } from "react-native";

/** The horizontal padding `Screen` puts on its content, each side. */
export const SCREEN_GUTTER = 20;

/**
 * The width of one cell in an evenly-divided row.
 *
 * Floored rather than rounded: three cells that each round up overflow the row
 * by a pixel and wrap the third onto a line of its own, which is a whole column
 * lost to a rounding error.
 */
export function useColumnWidth(columns: number, gap: number): number {
  const { width } = useWindowDimensions();
  return Math.floor((width - SCREEN_GUTTER * 2 - gap * (columns - 1)) / columns);
}
