/**
 * One number and what it counts (SPEC §6.8).
 *
 * The number is set in the display serif, large. That is the whole idea of the
 * profile stats block: six figures set like pull-quotes rather than six rows of
 * a table, so a profile has something with weight on it above the fold.
 *
 * Renders as `<dt>`/`<dd>` because the tiles genuinely are a description list —
 * the caller supplies the surrounding `<dl>`.
 */
import { cn } from "@/lib/cn";

export function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors duration-200 hover:border-line-strong",
        className,
      )}
    >
      <dt className="type-eyebrow text-fg-faint">{label}</dt>
      <dd className="type-display mt-2 text-3xl tabular-nums text-fg">{value}</dd>
    </div>
  );
}
