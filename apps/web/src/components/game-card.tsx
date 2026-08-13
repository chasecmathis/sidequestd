"use client";

/**
 * The result card from SPEC §6.6: cover art, title, release year, how it was
 * rated, platforms.
 *
 * `action` is a slot below the card for a control that belongs to the game but
 * is not "open the game" — the add-to-list picker on Search (SPEC §6.9). It is a
 * *sibling* of the link rather than a child: a select inside an anchor is
 * invalid markup, and every browser resolves it differently.
 *
 * The cover art is the card. Everything under it is set small and quiet so a
 * grid of these reads as a shelf of boxes rather than a table with pictures —
 * which is also why the title sits in the serif: it is the one line anybody
 * scans.
 */
import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";
import type { ReactNode } from "react";

import { StarGlyph } from "@/components/star-rating";
import { formatGameRating, formatIgdbRating, releaseYearLabel } from "@/lib/catalog";
import { cn } from "@/lib/cn";
import type { GameSummary } from "@sidequestd/api-types";

export function GameCard({ game, action }: { game: GameSummary; action?: ReactNode }) {
  const ours = formatGameRating(game.rating_average);
  const igdb = formatIgdbRating(game.igdb_rating);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-line bg-surface transition-colors duration-200 focus-within:border-line-strong hover:border-line-strong">
      <Link href={`/games/${game.id}`} className="group flex flex-1 flex-col">
        <div className="relative aspect-3/4 w-full overflow-hidden bg-surface-2">
          {game.cover_url ? (
            <Image
              src={game.cover_url}
              alt={`${game.title} cover art`}
              fill
              sizes="(max-width: 640px) 45vw, 200px"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <span className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
              <ImageOff aria-hidden strokeWidth={1.25} className="size-5 text-fg-faint" />
              <span className="type-eyebrow text-fg-faint">No cover art</span>
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-3">
          <h3 className="type-display text-base leading-tight text-fg">{game.title}</h3>
          <p className="type-eyebrow text-fg-faint">{releaseYearLabel(game.release_year)}</p>

          {/* Quiet on purpose: a grid of these is a shelf of boxes, and two
              scores set any louder would turn it into a leaderboard. Either half
              can be missing — most of the catalog has no IGDB score until the
              sync reaches it — so the separator and the line itself both come
              and go, and `mt-auto` lands on whichever row ends up last. */}
          {ours || igdb ? (
            <p className="mt-auto flex items-center gap-1.5 pt-1 text-xs tabular-nums text-fg-dim">
              {ours ? (
                <span className="inline-flex items-center gap-1">
                  <StarGlyph size={11} />
                  <span>{ours}</span>
                  <span className="sr-only">out of 5 on sidequestd</span>
                </span>
              ) : null}
              {ours && igdb ? <span aria-hidden>·</span> : null}
              {igdb ? (
                <span className="inline-flex items-center gap-1">
                  <span className="type-eyebrow text-fg-faint">IGDB</span>
                  <span>{igdb}</span>
                  <span className="sr-only">out of 100 on IGDB</span>
                </span>
              ) : null}
            </p>
          ) : null}

          <p className={cn("truncate pt-1 text-xs text-fg-faint", !ours && !igdb && "mt-auto")}>
            {game.platforms.map((platform) => platform.name).join(" · ") || "Platform unknown"}
          </p>
        </div>
      </Link>

      {action ? <div className="border-t border-line bg-surface-2 p-2">{action}</div> : null}
    </div>
  );
}

export function GameGrid({
  games,
  action,
}: {
  games: GameSummary[];
  /** Rendered under every card. Given the game so one grid can build a control per row. */
  action?: (game: GameSummary) => ReactNode;
}) {
  return (
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {games.map((game) => (
        <li key={game.id}>
          <GameCard game={game} action={action?.(game)} />
        </li>
      ))}
    </ul>
  );
}
