/**
 * The mono micro-label.
 *
 * Section headings on Discover, field legends, the "PLAYED 62H" beside a
 * rating — anything that labels rather than states. `rule` extends a hairline
 * from the end of the text to the edge of its container, which is the editorial
 * device that makes a section feel typeset instead of stacked.
 *
 * Defaults to a `<p>`; pass `as="h2"` where it is genuinely the heading for a
 * region, so the document outline still means something.
 */
import type { ElementType, HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

interface EyebrowProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Run a hairline from the label to the right edge. */
  rule?: boolean;
}

export function Eyebrow({ as, rule = false, className, children, ...props }: EyebrowProps) {
  const Tag = as ?? "p";
  return (
    <Tag className={cn("type-eyebrow flex items-center gap-3 text-fg-faint", className)} {...props}>
      <span>{children}</span>
      {rule ? <span aria-hidden className="h-px flex-1 bg-line" /> : null}
    </Tag>
  );
}
