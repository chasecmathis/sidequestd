/**
 * A store's mark, drawn rather than fetched.
 *
 * Inline paths cost no request and no CSP exception, and — being `currentColor`
 * — they follow the theme instead of being white PNGs that disappear on paper.
 *
 * The path data itself lives in `@sidequestd/core`, the way `STAR_PATH` does and
 * for the same reason: three surfaces draw Steam now, one of them on a phone,
 * and a hand-copied path string is how two clients quietly start disagreeing
 * about what a logo looks like. What is left here is the `<svg>` element, which
 * is the half that has no native equivalent.
 *
 * An unrecognised source renders nothing at all instead of a placeholder glyph.
 * The label beside it already names the store, and a generic box would read as a
 * broken image rather than as "we have no mark for this one".
 */
import { storeMarkPath } from "@sidequestd/core";

export function StoreMark({ source, className }: { source: string; className?: string }) {
  const path = storeMarkPath(source);
  if (!path) return null;

  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d={path} />
    </svg>
  );
}
