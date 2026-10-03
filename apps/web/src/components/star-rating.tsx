"use client";

/**
 * The five-star, half-star rating from SPEC §6.3.
 *
 * Values are the stored 1-10 integer throughout; the halving happens only at the
 * edge, in `starFill`. A star is two layers — a hollow one and a filled one
 * clipped to a percentage — which is what makes a half-star a width rather than
 * a third glyph.
 *
 * Drawn as an SVG path rather than the "★" character. The glyph is a font
 * fallback away from rendering as a colour emoji on some platforms, which makes
 * the amber fill and the half-star clip both meaningless; a path renders the
 * same everywhere and stays crisp at the 12px the profile grid uses.
 */
import { formatStars, MAX_RATING, MIN_RATING, starFill } from "@sidequestd/core";
const STARS = [0, 1, 2, 3, 4];
const STOPS = Array.from({ length: MAX_RATING - MIN_RATING + 1 }, (_, index) => index + MIN_RATING);

const PATH =
  "M12 2.4l2.86 5.8 6.4.93-4.63 4.51 1.09 6.37L12 16.99l-5.72 3.02 1.09-6.37L2.74 9.13l6.4-.93z";

function Star({ fill, size }: { fill: number; size: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-block shrink-0 align-middle"
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="absolute inset-0 text-line-strong"
      >
        <path d={PATH} fill="currentColor" />
      </svg>
      {/* The clip. Width is the whole trick: a half star is 50% of the same
          shape, not a different one. */}
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
        <svg viewBox="0 0 24 24" width={size} height={size} className="text-star">
          <path d={PATH} fill="currentColor" />
        </svg>
      </span>
    </span>
  );
}

/**
 * One solid star, for a line too small to carry the whole row.
 *
 * Exists so the card's score strip can mark a rating without reaching for "★" —
 * see the note above about what that character does on the wrong platform. It is
 * the same path at full fill, so there is still one amber star in the app.
 */
export function StarGlyph({ size = 11 }: { size?: number }) {
  return <Star fill={1} size={size} />;
}

/** Read-only display. The numeric value is the accessible name. */
export function StarRating({ rating, size = 18 }: { rating: number; size?: number }) {
  return (
    <span
      className="inline-flex items-center gap-[0.1em]"
      title={`${formatStars(rating)} out of 5`}
    >
      {STARS.map((index) => (
        <Star key={index} fill={starFill(rating, index)} size={size} />
      ))}
      <span className="sr-only">{formatStars(rating)} out of 5 stars</span>
    </span>
  );
}

/**
 * The input. Ten stops laid over five stars, as a radio group.
 *
 * Radios rather than a slider so each half-star is individually reachable and
 * announced — "3.5 out of 5" is a meaningful label, "7" is not.
 */
export function StarRatingInput({
  value,
  onChange,
  size = 32,
  disabled = false,
}: {
  value: number | null;
  onChange: (rating: number) => void;
  size?: number;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <div role="radiogroup" aria-label="Rating" className="inline-flex items-center gap-1">
        {STARS.map((index) => (
          <span key={index} className="relative inline-block" style={{ width: size, height: size }}>
            <Star fill={value === null ? 0 : starFill(value, index)} size={size} />
            {STOPS.slice(index * 2, index * 2 + 2).map((stop, half) => (
              <button
                key={stop}
                type="button"
                role="radio"
                aria-checked={value === stop}
                aria-label={`${stop / 2} out of 5 stars`}
                disabled={disabled}
                onClick={() => onChange(stop)}
                className="absolute top-0 h-full w-1/2 cursor-pointer rounded-sm disabled:cursor-not-allowed"
                style={{ left: half === 0 ? 0 : "50%" }}
              />
            ))}
          </span>
        ))}
      </div>

      <span className="type-eyebrow tabular-nums text-fg-dim">
        {value === null ? "Not rated" : `${formatStars(value)} / 5`}
      </span>
    </div>
  );
}
