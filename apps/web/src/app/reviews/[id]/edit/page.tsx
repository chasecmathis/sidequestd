"use client";

/**
 * Edit a review — SPEC §6.3 ("the user can edit or delete their review").
 *
 * Unlike the create screen, the review already exists here, so media is added and
 * removed against the API immediately rather than staged: each change has its own
 * failure modes (too large, a second clip, storage down) and burying them inside
 * a form submit makes them much harder to report against the right control. The
 * text fields still save together, on Save.
 */
import Image from "next/image";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { Alert } from "@/components/ui/alert";
import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { inputStyles } from "@/components/ui/field";
import { ReviewSkeleton } from "@/components/ui/skeleton";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/form";
import { StarRatingInput } from "@/components/star-rating";
import {
  ACCEPTED_MEDIA,
  ApiError,
  isVideo,
  MAX_MEDIA_PER_REVIEW,
  minutesToPlaytimeInput,
  playtimeToMinutes,
  rejectMedia,
  REVIEW_TEXT_MAX_LENGTH,
  reviewPath,
  tally,
  useAuth,
} from "@sidequestd/core";

import type { ReviewDetail, ReviewMediaItem, ReviewUpdate } from "@sidequestd/api-types";

export default function EditReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, isLoading, authedRequest } = useAuth();

  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [playtime, setPlaytime] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  // Kept apart from the redirect above, and keyed on the viewer's id rather than
  // the whole record: this effect re-seeds the form from the server, so anything
  // that makes it run twice would discard whatever is half-typed.
  const viewerId = user?.id ?? null;
  useEffect(() => {
    if (isLoading || viewerId === null) return;

    let cancelled = false;
    authedRequest<ReviewDetail>(`/reviews/${id}`)
      .then((body) => {
        if (cancelled) return;
        setReview(body);
        setRating(body.rating);
        setText(body.review_text ?? "");
        // Stored in minutes, edited in hours.
        setPlaytime(minutesToPlaytimeInput(body.playtime_minutes));
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoadError(
            cause instanceof ApiError && cause.status === 404
              ? "That review no longer exists."
              : cause instanceof Error
                ? cause.message
                : "Request failed.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authedRequest, id, isLoading, viewerId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (rating === null) return;

    setSaving(true);
    setError(null);
    setSaved(null);

    const payload: ReviewUpdate = {
      rating,
      // Trimmed-empty means "clear it", which the API spells as null.
      review_text: text.trim() || null,
      playtime_minutes: playtimeToMinutes(playtime),
    };

    try {
      setReview(
        await authedRequest<ReviewDetail>(`/reviews/${id}`, { method: "PATCH", body: payload }),
      );
      setSaved("Review saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your review.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd(files: FileList) {
    if (!review) return;
    setBusy(true);
    setMediaError(null);

    const existing = tally(review.media.map((item) => ({ isVideo: isVideo(item) })));
    try {
      for (const file of Array.from(files)) {
        const reason = rejectMedia(file, existing);
        if (reason) {
          setMediaError(reason);
          break;
        }
        const form = new FormData();
        form.append("file", file);
        const added = await authedRequest<ReviewMediaItem>(`/reviews/${id}/media`, {
          method: "POST",
          body: form,
        });
        if (isVideo(added)) existing.videos += 1;
        else existing.images += 1;
        setReview((current) =>
          current ? { ...current, media: [...current.media, added] } : current,
        );
      }
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : "Could not upload that file.");
    } finally {
      setBusy(false);
      // Reset so picking the same file again still fires a change.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleRemove(mediaId: string) {
    setBusy(true);
    setMediaError(null);
    try {
      const remaining = await authedRequest<ReviewMediaItem[]>(`/reviews/${id}/media/${mediaId}`, {
        method: "DELETE",
      });
      setReview((current) => (current ? { ...current, media: remaining } : current));
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : "Could not remove that file.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/reviews/${id}`, { method: "DELETE" });
      router.push(user ? `/profile/${user.username}` : "/home");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete your review.");
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <AppShell>
        <Alert tone="error">{loadError}</Alert>
      </AppShell>
    );
  }

  if (!review) {
    return (
      <AppShell>
        <ReviewSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="type-display text-4xl text-fg">Edit review</h1>
          <Link href={reviewPath(review.id)} className="link text-sm text-fg">
            View review
          </Link>
        </div>

        <p className="type-eyebrow mt-3 text-fg-faint">{review.game.title}</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-6" noValidate>
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
              onChange={(event) => setText(event.target.value)}
              className={inputStyles({ className: "resize-y" })}
            />
          </div>

          <Field
            label="Playtime"
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={playtime}
            placeholder="15.5"
            onChange={(event) => setPlaytime(event.target.value)}
            hint="Hours played. Optional."
          />

          <FormError message={error} />
          <FormSuccess message={saved} />

          <SubmitButton pending={saving} disabled={rating === null}>
            Save changes
          </SubmitButton>
        </form>

        <section className="mt-10">
          <Eyebrow as="h2" rule>
            Photos and clips
          </Eyebrow>

          {review.media.length > 0 ? (
            <ul aria-label="Attached media" className="mt-4 grid grid-cols-4 gap-2">
              {review.media.map((item) => (
                <li
                  key={item.id}
                  className="relative aspect-square overflow-hidden rounded-md border border-line bg-surface-2"
                >
                  {isVideo(item) ? (
                    <video src={item.url} className="h-full w-full object-cover" muted />
                  ) : (
                    <Image
                      src={item.thumbnail_url ?? item.url}
                      alt={item.alt_text ?? ""}
                      fill
                      sizes="120px"
                      className="object-cover"
                    />
                  )}
                  <button
                    type="button"
                    aria-label="Remove this file"
                    disabled={busy}
                    onClick={() => void handleRemove(item.id)}
                    // Scrim tokens, fixed in both themes — see the note on the
                    // twin of this control in reviews/new.
                    className="absolute right-1 top-1 rounded-full bg-scrim px-1.5 py-0.5 text-xs text-on-scrim backdrop-blur-sm transition-colors duration-150 hover:bg-black disabled:opacity-50"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="type-eyebrow mt-4 text-fg-faint">Nothing attached yet.</p>
          )}

          <div className="mt-4">
            <label
              htmlFor="review-media"
              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-line px-3.5 text-sm text-fg transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
            >
              {busy ? "Working…" : "Add files"}
            </label>
            <input
              id="review-media"
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPTED_MEDIA}
              disabled={busy}
              className="sr-only"
              onChange={(event) => {
                if (event.target.files?.length) void handleAdd(event.target.files);
              }}
            />
            <p className="mt-2.5 text-xs leading-relaxed text-fg-faint">
              Up to {MAX_MEDIA_PER_REVIEW} items, one clip.
            </p>
          </div>

          <FormError message={mediaError} />
        </section>

        <section className="mt-10 border-t border-line pt-6">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleDelete()}
            className={buttonStyles({ variant: "danger", size: "sm" })}
          >
            Delete review
          </button>
          <p className="mt-2.5 text-xs leading-relaxed text-fg-faint">
            This removes the review and its photos and clips. It cannot be undone.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
