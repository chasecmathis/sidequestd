/**
 * The top of every screen: an eyebrow, a serif title, a line of explanation and
 * somewhere to put the screen's one action.
 *
 * All thirteen routes were repeating an `<h1>` and a `<p>` with slightly
 * different sizes and margins. Centralising it is what makes the display face
 * land at the same size on Home and on Notifications — a serif this
 * high-contrast is unforgiving about being set at two sizes on adjacent pages.
 *
 * The `<h1>` text must stay exactly what each page passed before: the existing
 * tests find their screens with `getByRole("heading", { name: … })`.
 */
import type { ReactNode } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/cn";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /** The screen's primary action, right-aligned and dropping below on mobile. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-3">{eyebrow}</Eyebrow> : null}
        <h1 className="type-display text-4xl text-fg sm:text-5xl">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-prose text-sm leading-relaxed text-fg-dim">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
