/**
 * The surface every piece of content sits on.
 *
 * Depth here is lightness and a hairline, not a drop shadow. On a near-black
 * canvas a shadow is invisible, and faking one with a dark blur only smears the
 * grain; a card reads as raised because it is two steps lighter than the page
 * and has a 1px edge.
 *
 * `interactive` is for a card that is itself a link or contains one. The edge
 * brightens rather than the fill, so a hovered card does not flash — and it is
 * on `focus-within` too, so reaching it with a keyboard looks the same as
 * reaching it with a mouse.
 */
import type { ElementType, HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

interface CardProps extends HTMLAttributes<HTMLElement> {
  /** `article` for a feed item, `li` inside a list, `div` by default. */
  as?: ElementType;
  interactive?: boolean;
  children?: ReactNode;
}

export function Card({ as, interactive = false, className, children, ...props }: CardProps) {
  const Tag = as ?? "div";
  return (
    <Tag
      className={cn(
        "overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-200",
        interactive && "hover:border-line-strong focus-within:border-line-strong",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** Padded band at the top of a card. Bordered below only when something follows. */
export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-3 px-4 py-3.5", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-4 py-4", className)} {...props} />;
}

/**
 * The action rail. Recessed onto `surface-2` rather than merely ruled off: the
 * things in here — like, comment — are controls, and giving them their own
 * ground says so before anyone reads the labels.
 */
export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 border-t border-line bg-surface-2 px-2 py-1.5",
        className,
      )}
      {...props}
    />
  );
}
