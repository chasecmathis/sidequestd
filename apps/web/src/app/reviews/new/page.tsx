"use client";

/**
 * Write a review — SPEC §6.3.
 *
 * The order matters. A review has to exist before media can hang off it (the
 * upload endpoint lives under `/reviews/{id}/media`), so files chosen here are
 * held locally with object-URL previews and uploaded once the review is posted.
 * That keeps the "pick a game, rate it, add photos" flow on one screen without
 * inventing an orphan review to attach things to.
 *
 * If an upload fails part-way, the review is already saved: `reviewId` is kept so
 * a retry uploads only what is left instead of posting the review twice.
 */
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { Field, FormError, SubmitButton } from "@/components/form";
import { StarRatingInput } from "@/components/star-rating";
import { inputStyles } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { releaseYearLabel, searchQuery } from "@/lib/catalog";
import {
  ACCEPTED_MEDIA,
  MAX_MEDIA_PER_REVIEW,
  REVIEW_TEXT_MAX_LENGTH,
  formatPlaytime,
  rejectMedia,
  reviewPath,
  tally,
} from "@/lib/reviews";
import type { GamePage, GameSummary, ReviewCreate, ReviewDetail } from "@sidequestd/api-types";

const DEBOUNCE_MS = 250;

interface Pending {
  file: File;
  url: string;
  isVideo: boolean;
}

function GamePicker({ onPick }: { onPick: (game: GameSummary) => void }) {
  const { authedRequest } = useAuth();
  const [term, setTerm] = useState("");
  const [results, setResults] = useState<GameSummary[]>([]);

  useEffect(() => {
    const query = term.trim();
    if (!query) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      authedRequest<GamePage>(searchQuery("games", query))
        .then((page) => {
          if (!cancelled) setResults(page.items.slice(0, 6));
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [authedRequest, term]);

  return (
    <div className="space-y-3">
      <Field
        label="Game"
        type="search"
        value={term}
        autoComplete="off"
        placeholder="Search the catalog"
        onChange={(event) => setTerm(event.target.value)}
        hint="Reviews attach to a game already in the catalog."
      />

      {results.length > 0 ? (
        <ul className="space-y-1" aria-label="Game results">
          {results.map((game) => (
            <li key={game.id}>
              <button
                type="button"
                onClick={() => onPick(game)}
                className="flex w-full items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5 text-left transition-colors duration-150 hover:border-line-strong"
              >
                <span className="relative h-12 w-9 shrink-0 overflow-hidden rounded-sm bg-surface-2">
                  {game.cover_url ? (
                    <Image src={game.cover_url} alt="" fill sizes="36px" className="object-cover" />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{game.title}</span>
                  <span className="type-eyebrow mt-1 block text-fg-faint">
                    {releaseYearLabel(game.release_year)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function NewReviewForm() {
  const router = useRouter();
  const params = useSearchParams();
  const preselected = params.get("game");
  const { user, isLoading, authedRequest } = useAuth();

  const [game, setGame] = useState<GameSummary | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [playtime, setPlaytime] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  // A "write a review" link from Game Detail arrives with the game already chosen.
  useEffect(() => {
    if (!preselected || isLoading) return;
    let cancelled = false;
    authedRequest<GameSummary>(`/games/${preselected}`)
      .then((body) => {
        if (!cancelled) setGame(body);
      })
      .catch(() => {
        /* Fall through to the picker; the game id in the URL was not usable. */
      });
    return () => {
      cancelled = true;
    };
  }, [preselected, authedRequest, isLoading]);

  // Object URLs are a manual allocation: without the unmount sweep the previews
  // leak for as long as the tab lives. Read through a ref so the cleanup sees the
  // final list rather than the empty one this effect closed over.
  const latest = useRef<Pending[]>([]);
  useEffect(() => {
    latest.current = pending;
  }, [pending]);
  useEffect(
    () => () => {
      latest.current.forEach((item) => URL.revokeObjectURL(item.url));
    },
    [],
  );

  const addFiles = useCallback(
    (chosen: FileList) => {
      setMediaError(null);
      // Built outside the state updater on purpose: `createObjectURL` allocates,
      // and React may call an updater twice, which would leak one URL per file.
      const next = [...pending];
      for (const file of Array.from(chosen)) {
        const reason = rejectMedia(file, tally(next));
        if (reason) {
          setMediaError(reason);
          break;
        }
        next.push({
          file,
          url: URL.createObjectURL(file),
          isVideo: file.type.startsWith("video/"),
        });
      }
      setPending(next);
      if (fileInput.current) fileInput.current.value = "";
    },
    [pending],
  );

  function removeFile(url: string) {
    URL.revokeObjectURL(url);
    setPending((current) => current.filter((item) => item.url !== url));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!game || rating === null) return;

    setSaving(true);
    setError(null);

    try {
      let id = reviewId;
      if (id === null) {
        const minutes = Number.parseInt(playtime, 10);
        const payload: ReviewCreate = {
          game_id: game.id,
          rating,
          review_text: text.trim() || null,
          playtime_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
        };
        const created = await authedRequest<ReviewDetail>("/reviews", {
          method: "POST",
          body: payload,
        });
        id = created.id;
        setReviewId(id);
      }

      // Sequential rather than parallel: the ten-item and one-video limits are
      // checked against what is already attached, so overlapping uploads could
      // each see room that only one of them has.
      for (const item of [...pending]) {
        const form = new FormData();
        form.append("file", item.file);
        await authedRequest(`/reviews/${id}/media`, { method: "POST", body: form });
        removeFile(item.url);
      }

      router.push(reviewPath(id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your review.");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !user) {
    return <ListSkeleton count={1} label="Loading" />;
  }

  const minutes = Number.parseInt(playtime, 10);
  const playtimeLabel = Number.isFinite(minutes) ? formatPlaytime(minutes) : null;

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader eyebrow="New" title="Write a review" />

      {reviewId ? (
        <p
          role="status"
          className="mt-6 flex items-center gap-2.5 rounded-md border border-success/30 bg-success/10 px-3 py-2.5 text-sm text-success"
        >
          Your review is saved. Finishing the uploads —{" "}
          <Link href={reviewPath(reviewId)} className="link">
            view it now
          </Link>
          .
        </p>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-8 space-y-6" noValidate>
        {game ? (
          <div className="flex items-center gap-3.5 rounded-lg border border-line bg-surface p-3">
            <span className="relative h-16 w-11 shrink-0 overflow-hidden rounded-sm border border-line bg-surface-2">
              {game.cover_url ? (
                <Image src={game.cover_url} alt="" fill sizes="40px" className="object-cover" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="type-display block truncate text-lg text-fg">{game.title}</span>
              <span className="type-eyebrow mt-1 block text-fg-faint">
                {releaseYearLabel(game.release_year)}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setGame(null)}
              disabled={reviewId !== null}
              className="type-eyebrow shrink-0 text-fg-faint transition-colors duration-150 hover:text-fg disabled:opacity-50"
            >
              Change
            </button>
          </div>
        ) : (
          <GamePicker onPick={setGame} />
        )}

        <div className="space-y-2">
          <span className="type-eyebrow block text-fg-dim">Rating</span>
          <StarRatingInput value={rating} onChange={setRating} />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="review-text" className="type-eyebrow block text-fg-dim">
            Review
          </label>
          <textarea
            id="review-text"
            value={text}
            rows={6}
            maxLength={REVIEW_TEXT_MAX_LENGTH}
            placeholder="What did you think?"
            onChange={(event) => setText(event.target.value)}
            className={inputStyles({ className: "resize-y" })}
          />
          <p className="text-xs text-fg-faint">Optional.</p>
        </div>

        <Field
          label="Playtime"
          type="number"
          min={0}
          inputMode="numeric"
          value={playtime}
          placeholder="930"
          onChange={(event) => setPlaytime(event.target.value)}
          hint={playtimeLabel ? `Minutes — that's ${playtimeLabel}.` : "Minutes played. Optional."}
        />

        <div className="space-y-2">
          <span className="type-eyebrow block text-fg-dim">Photos and clips</span>
          <label
            htmlFor="review-media"
            className="inline-flex h-9 cursor-pointer items-center rounded-md border border-line px-3.5 text-sm text-fg transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
          >
            Add files
          </label>
          <input
            id="review-media"
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPTED_MEDIA}
            className="sr-only"
            onChange={(event) => {
              if (event.target.files?.length) addFiles(event.target.files);
            }}
          />
          <p className="text-xs leading-relaxed text-fg-faint">
            Up to {MAX_MEDIA_PER_REVIEW} items, one clip. Photos to 15 MB, clips to 100 MB and 60
            seconds.
          </p>

          {pending.length > 0 ? (
            <ul aria-label="Selected media" className="mt-3 grid grid-cols-4 gap-2">
              {pending.map((item) => (
                <li
                  key={item.url}
                  className="relative aspect-square overflow-hidden rounded-md border border-line bg-surface-2"
                >
                  {item.isVideo ? (
                    <video src={item.url} className="h-full w-full object-cover" muted />
                  ) : (
                    // A blob: URL, so next/image's optimiser has nothing to fetch.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.url} alt="" className="h-full w-full object-cover" />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove ${item.file.name}`}
                    onClick={() => removeFile(item.url)}
                    className="absolute right-1 top-1 rounded-full bg-black/75 px-1.5 py-0.5 text-xs text-white backdrop-blur-sm transition-colors duration-150 hover:bg-black"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <FormError message={mediaError} />
        </div>

        <FormError message={error} />

        <SubmitButton pending={saving} disabled={game === null || rating === null}>
          {game === null ? "Pick a game first" : rating === null ? "Add a rating" : "Post review"}
        </SubmitButton>
      </form>
    </div>
  );
}

export default function NewReviewPage() {
  return (
    <AppShell>
      {/* useSearchParams needs a boundary so the route can still be prerendered. */}
      <Suspense fallback={<ListSkeleton count={1} label="Loading" />}>
        <NewReviewForm />
      </Suspense>
    </AppShell>
  );
}
