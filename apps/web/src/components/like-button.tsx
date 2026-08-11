"use client";

/**
 * The like control from SPEC §6.10.
 *
 * Optimistic and then server-authoritative, the same shape as `FollowButton`:
 * the heart fills on press and the count moves with it, and the response — which
 * carries the true count, including likes other people added since the page
 * loaded — replaces both. A failure puts the heart back rather than leaving the
 * user believing they liked something they did not.
 *
 * Signed out there is nothing to press. A heart that only ever produces "sign in
 * first" is a worse invitation than the sign-in link already in the nav, so the
 * count renders on its own.
 *
 * The heart pops on press. It is keyed on the liked state rather than on the
 * click, so it fires for the optimistic fill and again if the server disagrees
 * and it un-fills — the animation follows the truth, not the gesture.
 */
import { Heart } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { useAuth } from "@/lib/auth";
import { likeActionLabel, likeCountLabel, likeRequest, optimisticLike } from "@/lib/interactions";
import type { ReviewInteractions } from "@sidequestd/api-types";

export function LikeButton({
  interactions,
  onChange,
}: {
  interactions: ReviewInteractions;
  onChange?: (result: ReviewInteractions) => void;
}) {
  const { authedRequest, user } = useAuth();
  const [current, setCurrent] = useState(interactions);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Depending on the fields rather than the object: the parent builds a fresh
  // one every render, so `[interactions]` would re-sync on every pass — undoing
  // the optimistic state, and looping, because the reset is itself a render.
  // Navigating between two reviews changes `review_id`, which is what stops the
  // previous one's answer staying on screen.
  const { review_id, like_count, comment_count, viewer_has_liked } = interactions;
  useEffect(() => {
    setCurrent({ review_id, like_count, comment_count, viewer_has_liked });
    setError(null);
  }, [review_id, like_count, comment_count, viewer_has_liked]);

  async function press() {
    const before = current;

    setPending(true);
    setError(null);
    setCurrent(optimisticLike(before));

    try {
      const { path, method } = likeRequest(before.viewer_has_liked, before.review_id);
      const result = await authedRequest<ReviewInteractions>(path, { method });
      setCurrent(result);
      onChange?.(result);
    } catch (cause) {
      setCurrent(before);
      setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (!user) {
    return (
      <span className="type-eyebrow flex items-center gap-2 px-2.5 py-2 text-fg-faint">
        <Heart aria-hidden strokeWidth={1.75} className="size-4" />
        <span className="tabular-nums">{likeCountLabel(current.like_count)}</span>
      </span>
    );
  }

  const liked = current.viewer_has_liked;

  return (
    <div className="flex flex-col items-start">
      <button
        type="button"
        onClick={() => void press()}
        disabled={pending}
        aria-pressed={liked}
        aria-label={likeActionLabel(liked)}
        className={`type-eyebrow flex items-center gap-2 rounded-md px-2.5 py-2 transition-colors duration-150 hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 ${
          // The accent rather than the conventional red: the heart is *filled* when
          // liked, which is the palette's sanctioned use of the accent, and red
          // here would be the same colour this button uses to report a failure.
          liked ? "text-accent" : "text-fg-faint hover:text-fg"
        }`}
      >
        {/* A tween rather than a spring: the pop is three keyframes — rest,
            overshoot, rest — and Motion's spring solver only accepts two. The
            `times` array is what puts the overshoot early, so it reads as a
            snap and not as a pulse. */}
        <motion.span
          key={String(liked)}
          initial={{ scale: 1 }}
          animate={liked ? { scale: [1, 1.35, 1] } : { scale: 1 }}
          transition={{ duration: 0.34, times: [0, 0.35, 1], ease: "easeOut" }}
          className="flex"
        >
          <Heart
            aria-hidden
            strokeWidth={1.75}
            className="size-4"
            fill={liked ? "currentColor" : "none"}
          />
        </motion.span>
        <span className="tabular-nums">{likeCountLabel(current.like_count)}</span>
      </button>
      {error ? (
        <p role="alert" className="px-2.5 pb-1 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
