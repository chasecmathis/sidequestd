/**
 * Playtime the platform published, next to a review.
 *
 * The design problem here is separation without a new colour. This sits in the
 * same mono strip as the rating and the release year, and it has to read as a
 * stronger claim than the "Played 15.5h" it replaces — but the palette rule says
 * the accent is a fill, a border or a focus ring and almost never text, and the
 * amber stars are already the one warm chromatic voice on a card. A third
 * coloured thing would turn a quiet strip into a row of stickers, twenty times
 * over in a feed.
 *
 * So the distinction is typographic and spatial rather than chromatic: the
 * author's own figure is bare text, and this one is *boxed*. A hairline and a
 * tick, in the same greys as everything around it. The accent appears only on
 * hover, on the border — the same gesture `link-quiet` uses — which keeps a
 * scrolling feed monochrome and still rewards a reader who goes looking.
 *
 * `title` carries the full sentence because the chip itself is four characters
 * of evidence and the reason it can be trusted does not fit beside them.
 */
import { BadgeCheck } from "lucide-react";

import { cn } from "@/lib/cn";
import { formatLibraryPlaytime, providerLabel } from "@/lib/connections";
import type { VerifiedPlaytime as Verified } from "@sidequestd/api-types";

export function VerifiedPlaytimeChip({
  verified,
  className,
}: {
  verified: Verified;
  className?: string;
}) {
  const platform = providerLabel(verified.provider);
  const hours = formatLibraryPlaytime(verified.playtime_minutes);

  return (
    <span
      title={`${platform} reports ${hours} played. This figure comes from ${platform}, not from the reviewer.`}
      className={cn(
        "type-eyebrow inline-flex items-center gap-1.5 rounded-sm border border-line",
        "px-1.5 py-1 tabular-nums text-fg-dim transition-colors duration-150",
        "hover:border-accent",
        className,
      )}
    >
      <BadgeCheck aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0" />
      {/* The platform name is what makes this evidence rather than a boast, so
          it is never dropped — even though it costs width on a narrow card. */}
      <span>
        {hours} on {platform}
      </span>
    </span>
  );
}
