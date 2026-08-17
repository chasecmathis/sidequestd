/**
 * The wordmark.
 *
 * An orchid square, then the name split across the display serif's two styles.
 * The accent is a *filled shape* rather than coloured letters, which is the
 * palette rule the rest of the app follows — and the roman/italic pairing gives
 * the mark its character without needing a second colour to find the seam.
 *
 * Purely presentational, and deliberately not a link: it points at `/` in the
 * app shell and on the auth screens, at nothing in the footer where the page it
 * would link to is the one you are on. Wrapping it at the call site keeps that
 * decision where the context is.
 */
import { cn } from "@/lib/cn";

/** `sm` is the header and footer mark; `md` is the auth screen's larger one. */
type Size = "sm" | "md";

const SIZES: Record<Size, string> = {
  sm: "text-xl",
  md: "text-2xl",
};

export function Wordmark({ size = "sm", className }: { size?: Size; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <span aria-hidden className="size-2 shrink-0 rounded-[1px] bg-accent" />
      <span className={cn("type-display", SIZES[size])}>
        Side<span className="italic text-fg-dim">questd</span>
      </span>
    </span>
  );
}
