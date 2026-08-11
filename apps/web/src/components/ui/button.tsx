/**
 * The one button in the app.
 *
 * `buttonStyles` is exported alongside the component because roughly half the
 * things that look like buttons here are `next/link` anchors — "Write a review",
 * "Create an account", "Back to Discover". Handing them the class string rather
 * than wrapping them in a `Slot` keeps navigation as a real anchor: middle-click
 * and open-in-new-tab keep working, and it costs no dependency.
 *
 * Variants exist for reasons, not for coverage:
 *   primary   — the one action a screen wants. Accent fill, ink text. At most
 *               one per view; two primaries mean neither is primary.
 *   secondary — everything else that is still an action. Hairline, no fill.
 *   ghost     — actions inside dense rows, where a border would be noise.
 *   danger    — destructive, and never the default focus of a screen.
 */
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const BASE =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-md font-medium " +
  "whitespace-nowrap transition duration-150 active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-dim",
  secondary: "border border-line text-fg hover:border-line-strong hover:bg-surface-2",
  ghost: "text-fg-dim hover:bg-surface-2 hover:text-fg",
  danger: "border border-danger/40 text-danger hover:border-danger hover:bg-danger/10",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.8125rem]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[0.9375rem]",
};

export function buttonStyles({
  variant = "secondary",
  size = "md",
  className,
}: {
  variant?: Variant;
  size?: Size;
  className?: string;
} = {}): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], className);
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  // Defaulted to "button": a bare <button> inside a form submits it, which is
  // the wrong thing for every control here that is not a SubmitButton.
  return <button type={type} className={buttonStyles({ variant, size, className })} {...props} />;
}
