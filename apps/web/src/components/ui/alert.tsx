/**
 * Something went wrong, or something worked.
 *
 * The eighteen red paragraphs this replaces were inconsistent about
 * the part that actually matters: whether a screen reader ever hears them. The
 * tone picks the role — an error interrupts (`alert`), a confirmation does not
 * (`status`) — so getting the colour right and getting the announcement right
 * are now the same decision.
 *
 * `inline` is for the several places where the message belongs under a single
 * control rather than above a form: same colour, same role, no box.
 */
import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type Tone = "error" | "success";

export function Alert({
  tone = "error",
  inline = false,
  children,
  className,
}: {
  tone?: Tone;
  inline?: boolean;
  children: ReactNode;
  className?: string;
}) {
  // Callers pass a possibly-null message straight through, so an empty alert
  // renders nothing rather than an empty coloured box.
  if (children === null || children === undefined || children === false) return null;

  const role = tone === "error" ? "alert" : "status";
  const colour = tone === "error" ? "text-danger" : "text-success";
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;

  if (inline) {
    return (
      <p role={role} className={cn("text-xs", colour, className)}>
        {children}
      </p>
    );
  }

  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-sm",
        tone === "error" ? "border-danger/30 bg-danger/10" : "border-success/30 bg-success/10",
        colour,
        className,
      )}
    >
      <Icon aria-hidden strokeWidth={1.75} className="mt-px size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
