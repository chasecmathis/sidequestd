/**
 * What a surface says when it has nothing to show.
 *
 * The nine places this replaces were each a dashed-border paragraph, which
 * makes an empty list look like a validation error. This says the same sentence
 * with a shape that reads as "nothing here yet" — a dimmed icon, a real
 * heading, and, where there is one, the action that would fill it.
 *
 * `title` is what the reader sees first, so it states the situation. `description`
 * explains what would change it. Several callers only have the sentence, so the
 * title is optional and the description carries alone.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title?: string;
  description: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? <Icon aria-hidden strokeWidth={1.25} className="mb-4 size-7 text-fg-faint" /> : null}
      {title ? <h3 className="type-display text-xl text-fg">{title}</h3> : null}
      <p className={cn("max-w-sm text-sm leading-relaxed text-fg-dim", title && "mt-2")}>
        {description}
      </p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
