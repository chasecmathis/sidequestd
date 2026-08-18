"use client";

/**
 * A linked platform on a profile.
 *
 * The counterpart to `FavoriteGames`, and deliberately its opposite in what it
 * claims: favourites are curated — six slots, ranked, chosen — and this is
 * measured. Nobody arranged it. So it gets no numerals, no edit controls and no
 * empty slots; the hours are the ordering and the hours are the point.
 *
 * That difference is why the playtime is set in the display serif here rather
 * than as another mono chip. On this block the number *is* the content, the same
 * way a `Stat` tile's figure is, and setting it as metadata would bury the one
 * thing the section exists to say.
 *
 * Renders nothing at all when there is no visible link — a profile should not
 * grow an empty heading because somebody once considered connecting Steam.
 */
import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";

import { Eyebrow } from "@/components/ui/eyebrow";
import {
  formatGameCount,
  formatLibraryPlaytime,
  formatTotalPlaytime,
  providerLabel,
} from "@/lib/connections";
import type { PlatformShowcase as Showcase } from "@sidequestd/api-types";

export function PlatformShowcase({ showcases }: { showcases: Showcase[] }) {
  // Guarded rather than trusted. This is one auxiliary block on a screen whose
  // stated rule is that a failed side-request beats replacing the whole profile
  // with an error — and a showcase that throws would do exactly that, taking the
  // header, the reviews and the backlog down with it.
  const visible = Array.isArray(showcases)
    ? showcases.filter((showcase) => showcase.most_played?.length > 0)
    : [];
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((showcase) => (
        <section key={showcase.provider} className="mt-14">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
            <Eyebrow as="h2">Most played on {providerLabel(showcase.provider)}</Eyebrow>

            {/* The library totals, set as one mono line so they read as a
                caption to the heading rather than as a second heading. */}
            <p className="type-eyebrow flex items-center gap-2.5 tabular-nums text-fg-faint">
              <span>{formatGameCount(showcase.total_games)}</span>
              <span aria-hidden className="h-3 w-px bg-line" />
              <span>{formatTotalPlaytime(showcase.total_playtime_minutes)}</span>
            </p>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {showcase.most_played.map((entry) => (
              <li key={entry.game.id}>
                <Link
                  href={`/games/${entry.game.id}`}
                  className="group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-200 hover:border-line-strong"
                >
                  <div className="relative aspect-3/4 w-full overflow-hidden bg-surface-2">
                    {entry.game.cover_url ? (
                      <Image
                        src={entry.game.cover_url}
                        alt={`${entry.game.title} cover art`}
                        fill
                        sizes="(max-width: 640px) 45vw, 180px"
                        className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <span className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
                        <ImageOff aria-hidden strokeWidth={1.25} className="size-5 text-fg-faint" />
                        <span className="type-eyebrow text-fg-faint">No cover art</span>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col gap-1 p-3">
                    <p className="type-display text-xl leading-none tabular-nums text-fg">
                      {formatLibraryPlaytime(entry.playtime_minutes)}
                    </p>
                    <p className="line-clamp-2 text-xs leading-snug text-fg-dim">
                      {entry.game.title}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
