"use client";

/**
 * The two scores a game carries (SPEC §5).
 *
 * Two measurements, side by side, with deliberately no arithmetic between them.
 * Ours is the amber five-star row the rest of the app rates in; IGDB's is a
 * 0-100 numeral over a hairline meter. Folding IGDB into five stars would invent
 * a precision it does not have and imply the two are one number measured twice —
 * they are a blended critic-and-player aggregate and a small community's mean,
 * and the point of showing both is that they disagree.
 *
 * The meter is achromatic on purpose. The palette keeps the amber stars as the
 * one warm thing on a card and spends the accent on fills, borders and focus
 * rings; a second coloured bar here would give the block a third voice and stop
 * the stars reading as data.
 *
 * Two empty states, and both matter more than they look:
 *
 * * Nobody has rated it → "—" and "Not yet rated", never five hollow stars,
 *   which would say the game was rated zero.
 * * IGDB has no score → the half is *absent*, not empty. Most of the catalog has
 *   none until the weekly sync has walked it, and an empty meter everywhere
 *   would read as "IGDB rated this nothing".
 */
import { StarRating } from "@/components/star-rating";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  formatGameRating,
  formatIgdbRating,
  IGDB_MAX_RATING,
  igdbMeterFill,
  ratingCountLabel,
} from "@sidequestd/core";
import type { GameSummary } from "@sidequestd/api-types";

/**
 * The band under each numeral that carries its mark — the star row on our side,
 * the meter on theirs. One fixed height for both, so the two captions below them
 * sit on the same line and the block reads as two columns of one table.
 */
const SCORE_MARK = "mt-3 flex h-4 items-center";

export function GameScores({ game }: { game: GameSummary }) {
  const average = game.rating_average ?? null;
  const igdbRating = game.igdb_rating ?? null;

  const ours = formatGameRating(average);
  const ourCount = ratingCountLabel(game.rating_count);
  const igdb = formatIgdbRating(igdbRating);
  const igdbCount = ratingCountLabel(game.igdb_rating_count);

  return (
    <dl className="mt-7 grid gap-8 border-y border-line py-6 sm:grid-cols-2 sm:gap-10">
      <div>
        <Eyebrow as="dt">Sidequestd</Eyebrow>
        <dd className="mt-3">
          {average !== null && ours !== null ? (
            <>
              <p className="type-display text-3xl tabular-nums text-fg">
                {ours}
                <span className="ml-1.5 text-lg text-fg-faint"> / 5</span>
              </p>
              {/* Under the numeral, where the other column keeps its meter, so
                  the two big figures share a baseline and can be read against
                  each other in one glance. The fixed height is what keeps the
                  two captions on one line as well — a star row and a hairline
                  are very different heights otherwise. */}
              <div className={SCORE_MARK}>
                <StarRating rating={average} size={14} />
              </div>
            </>
          ) : (
            <p className="type-display text-3xl tabular-nums text-fg-faint">—</p>
          )}
          <p className="type-eyebrow mt-2 text-fg-faint">{ourCount ?? "Not yet rated"}</p>
        </dd>
      </div>

      {igdbRating !== null && igdb !== null ? (
        <div>
          <Eyebrow as="dt">IGDB</Eyebrow>
          <dd className="mt-3">
            <p className="type-display text-3xl tabular-nums text-fg">
              {igdb}
              <span className="ml-1.5 text-lg text-fg-faint"> / {IGDB_MAX_RATING}</span>
              <span className="sr-only">
                {igdb} out of {IGDB_MAX_RATING} on IGDB
              </span>
            </p>
            {/* Restates the numeral directly above it, so it is decoration to a
                screen reader and hidden outright — the same division of labour
                the star row uses, where the paths are hidden and an sr-only
                string carries the value. `role="meter"` would announce it twice. */}
            <div aria-hidden className={SCORE_MARK}>
              <div className="h-px w-full max-w-[13rem] bg-line">
                <div
                  className="h-px bg-fg-dim"
                  style={{ width: `${igdbMeterFill(igdbRating) * 100}%` }}
                />
              </div>
            </div>
            <p className="type-eyebrow mt-2 text-fg-faint">{igdbCount ?? "Score only"}</p>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
