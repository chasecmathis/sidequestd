/**
 * A small standing label: "Private", "Recommended", a media count, an unread
 * total.
 *
 * Mono caps rather than sentence-case sans, so a badge is never mistaken for a
 * button — it says something *about* the thing it sits on, and there is nothing
 * to press.
 */
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "outline" | "overlay";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg-dim",
  // The one place a badge earns the accent: a count the reader is meant to act
  // on, filled rather than lettered, per the palette rule.
  accent: "bg-accent text-accent-ink",
  outline: "border border-line text-fg-dim",
  // For sitting on top of artwork, where the surface behind is unknown.
  overlay: "bg-black/70 text-white backdrop-blur-sm",
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "type-eyebrow inline-flex shrink-0 items-center rounded-sm px-1.5 py-1",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
