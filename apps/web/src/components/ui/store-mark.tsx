/**
 * A store's mark, drawn rather than fetched.
 *
 * Inline paths cost no request and no CSP exception, and — being `currentColor`
 * — they follow the theme instead of being white PNGs that disappear on paper.
 *
 * Shared rather than inlined at each call site because two places now draw
 * Steam: the connect card on the settings screen, and the store link in a game's
 * metadata line. Two hand-copied path strings is how those two surfaces start
 * quietly disagreeing about what Steam looks like.
 *
 * An unrecognised source renders nothing at all instead of a placeholder glyph.
 * The label beside it already names the store, and a generic box would read as a
 * broken image rather than as "we have no mark for this one".
 */
const MARKS: Record<string, string> = {
  steam:
    "M11.98 2a10 10 0 0 0-9.96 9.19l5.34 2.2a2.82 2.82 0 0 1 1.6-.49h.14l2.38-3.44v-.05a3.77 3.77 0 1 1 3.77 3.77h-.09l-3.39 2.42v.12a2.83 2.83 0 0 1-5.61.5l-3.82-1.58A10 10 0 1 0 11.98 2Zm-3.6 15.17a2.18 2.18 0 0 0 2.83-1.18 2.17 2.17 0 0 0-1.18-2.83l-.9-.37a2.5 2.5 0 0 1 1.9 4.62l-1.56-.64a2.2 2.2 0 0 0 .9.4Zm8.87-6.9a2.51 2.51 0 1 0-5.02 0 2.51 2.51 0 0 0 5.02 0Zm-4.39 0a1.89 1.89 0 1 1 1.88 1.87 1.88 1.88 0 0 1-1.88-1.88Z",
};

export function StoreMark({ source, className }: { source: string; className?: string }) {
  const path = MARKS[source];
  if (!path) return null;

  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d={path} />
    </svg>
  );
}
