/**
 * The wordmark.
 *
 * The logomark in orchid, then the name split across the display serif's two
 * styles. The accent is a *shape* rather than coloured letters, which is the
 * palette rule the rest of the app follows — and the roman/italic pairing gives
 * the mark its character without needing a second colour to find the seam.
 *
 * The glyph replaces the orchid square that stood here while there was no logo
 * to put in its place. It is drawn from the same geometry as the app icons (see
 * `Logomark`), so the thing in the header is literally the thing on the home
 * screen.
 *
 * Purely presentational, and deliberately not a link: it points at `/` in the
 * app shell and on the auth screens, at nothing in the footer where the page it
 * would link to is the one you are on. Wrapping it at the call site keeps that
 * decision where the context is.
 */
import { WORDMARK_GLYPH_RATIO } from "@sidequestd/design-tokens";

import { Logomark } from "@/components/ui/logomark";
import { cn } from "@/lib/cn";

/** `sm` is the header and footer mark; `md` is the auth screen's larger one. */
type Size = "sm" | "md";

const SIZES: Record<Size, string> = {
  sm: "text-xl",
  md: "text-2xl",
};

/**
 * The glyph's height, in `em`, so one value serves both sizes: the auth
 * screen's larger lockup is the header's scaled rather than redrawn, and adding
 * a third size means a line in `SIZES` and nothing else. It resolves against
 * the font size on the wrapper, which is why the size class sits there rather
 * than on the word.
 *
 * A `style` rather than `h-[1.12em]` because the ratio is shared with the
 * native client (see `WORDMARK_GLYPH_RATIO` — the two disagree about the type
 * size, so the ratio is the only thing holding the lockups together) and
 * Tailwind reads arbitrary values out of the source text at build time, where
 * an imported constant is not yet a number.
 */
const GLYPH = { height: `${WORDMARK_GLYPH_RATIO}em` };

export function Wordmark({ size = "sm", className }: { size?: Size; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", SIZES[size], className)}>
      <Logomark style={GLYPH} className="w-auto shrink-0 text-accent" />
      <span className="type-display">
        Side<span className="italic text-fg-dim">questd</span>
      </span>
    </span>
  );
}
