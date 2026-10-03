"use client";

/**
 * A recommended review in Home (SPEC §6.4).
 *
 * The card underneath is the ordinary `ReviewCard` — the API sends the identical
 * review, and a recommendation the reader cannot like or comment on would be a
 * worse row than the ones around it. What this adds is the one thing SPEC §6.4
 * insists on: that it is "clearly distinguishable from pure follow feed".
 *
 * The label sits *above* the card rather than inside it, so the distinction is
 * legible before the reader has started reading a stranger's opinion, and so the
 * card stays one component with one set of rules. A follow row and a recommended
 * row differ in exactly this line.
 */
import { Sparkles } from "lucide-react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { recommendationLabel } from "@sidequestd/core";
import type { FeedRecommendedItem } from "@sidequestd/api-types";

import { ReviewCard } from "./review-card";

export function RecommendedRow({ item }: { item: FeedRecommendedItem }) {
  return (
    <section aria-label="Recommended for you">
      <Eyebrow className="mb-2.5 px-1">
        <span className="flex items-center gap-2">
          <Sparkles aria-hidden strokeWidth={1.75} className="size-3.5 text-accent" />
          Recommended · {recommendationLabel(item.reason)}
        </span>
      </Eyebrow>
      <ReviewCard review={item.review} />
    </section>
  );
}
