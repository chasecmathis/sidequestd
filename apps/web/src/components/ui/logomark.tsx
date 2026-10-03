/**
 * The logomark: a sword through a quest card.
 *
 * The same drawing as the app icons, the favicon and the social card — not a
 * copy of it. The geometry lives in `@sidequestd/design-tokens`, which is also
 * what the raster generator reads, so the mark in the header cannot drift from
 * the one on somebody's home screen. Same arrangement as `StoreMark` and
 * `STAR_PATH`: shared path data, and the `<svg>` element — the half with no
 * native equivalent — left to each client.
 *
 * `currentColor` throughout, so it inherits from whatever it is placed in. In
 * the `Wordmark` that means the accent, in both themes, with no prop passed.
 *
 * Sized by the caller — a height utility, or a `style` when the height is a
 * shared constant Tailwind cannot see at build time — and the viewBox's aspect
 * ratio supplies the width. `aria-hidden` because every place this
 * appears it sits beside the name it is a picture of, and a reader does not
 * want to hear "Sidequestd" twice.
 */
import type { CSSProperties } from "react";

import { BLADE, STROKES, VIEW_BOX_ATTR } from "@sidequestd/design-tokens";

import { cn } from "@/lib/cn";

export function Logomark({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox={VIEW_BOX_ATTR}
      aria-hidden
      // `block` by default: an inline SVG sits on the text baseline and inherits
      // the line box's descender gap, which reads as the mark hanging a couple
      // of pixels below the word it is set against.
      className={cn("block", className)}
      style={style}
    >
      {STROKES.map((stroke) => (
        <path
          key={stroke.d}
          d={stroke.d}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke.width}
          strokeLinecap={stroke.cap}
          strokeLinejoin="round"
        />
      ))}
      <path d={BLADE.d} fill="currentColor" fillRule={BLADE.fillRule} />
    </svg>
  );
}
