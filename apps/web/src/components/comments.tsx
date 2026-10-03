"use client";

/**
 * The comment thread on a review (SPEC §6.10).
 *
 * One level of nesting, because that is all the API will accept: a top-level
 * comment offers "Reply", a reply does not, so the shape of the screen and the
 * shape of the data agree and there is no arrangement of clicks that can produce
 * a request the server refuses.
 *
 * Rows are updated in place rather than by re-reading the list. A refetch after
 * every keystroke-length action would reorder or drop a row somebody is halfway
 * through replying to, and the API hands back the comment it just wrote — which
 * is the same thing the list would have returned.
 */
import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { Avatar } from "@/components/avatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { inputStyles } from "@/components/ui/field";
import { ListSkeleton } from "@/components/ui/skeleton";
import {
  COMMENT_MAX_LENGTH,
  commentCounter,
  COMMENTS_PAGE_SIZE,
  ownsComment,
  profilePath,
  rejectComment,
  timeAgo,
  useAuth,
} from "@sidequestd/core";

import type { CommentItem, CommentPage, CommentThread } from "@sidequestd/api-types";

/**
 * The box, wherever it appears: a new comment, a reply, or an edit.
 *
 * One component for all three because they differ only in what the submit does
 * — and because client-side validation that lives in three places is validation
 * that will eventually disagree with itself.
 */
function Composer({
  label,
  submitLabel,
  initialText = "",
  clearOnSubmit = true,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initialText?: string;
  clearOnSubmit?: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
}) {
  // Several composers can be open at once — the page's own, plus a reply box and
  // an edit box on any row — so the field needs an id nothing else shares.
  const fieldId = useId();
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counter = commentCounter(text);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    const reason = rejectComment(text);
    if (reason !== null) {
      setError(reason);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await onSubmit(text.trim());
      if (clearOnSubmit) setText("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't send. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
      <label className="sr-only" htmlFor={fieldId}>
        {label}
      </label>
      <textarea
        id={fieldId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder={label}
        rows={2}
        // One over the limit, so the API's rejection is reachable in a test and
        // the counter can warn rather than silently truncating what was typed.
        maxLength={COMMENT_MAX_LENGTH + 1}
        className={inputStyles({ className: "resize-y" })}
      />

      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {counter ? (
          <span className="type-eyebrow ml-auto tabular-nums text-fg-faint">{counter}</span>
        ) : null}
      </div>

      <Alert tone="error" inline>
        {error}
      </Alert>
    </form>
  );
}

function Row({
  comment,
  canReply,
  onReply,
  onEdited,
  onDeleted,
}: {
  comment: CommentItem;
  canReply: boolean;
  onReply?: (text: string) => Promise<void>;
  onEdited: (updated: CommentItem) => void;
  onDeleted: () => void;
}) {
  const { authedRequest, user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = ownsComment(comment, user?.id);

  async function save(text: string) {
    const updated = await authedRequest<CommentItem>(`/comments/${comment.id}`, {
      method: "PATCH",
      body: { text },
    });
    onEdited(updated);
    setEditing(false);
  }

  async function remove() {
    setError(null);
    try {
      await authedRequest(`/comments/${comment.id}`, { method: "DELETE" });
      onDeleted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete that comment.");
    }
  }

  return (
    <div className="flex gap-3 py-3">
      <Link href={profilePath(comment.author.username)} className="shrink-0">
        <Avatar user={comment.author} size={32} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Link
            href={profilePath(comment.author.username)}
            className="link-quiet text-sm font-medium text-fg"
          >
            {comment.author.username}
          </Link>
          <span className="type-eyebrow text-fg-faint">{timeAgo(comment.created_at)}</span>
          {comment.edited ? <span className="type-eyebrow text-fg-faint">(edited)</span> : null}
        </div>

        {editing ? (
          <div className="mt-2">
            <Composer
              label="Edit your comment"
              submitLabel="Save"
              initialText={comment.text}
              clearOnSubmit={false}
              onSubmit={save}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-fg-dim">
            {comment.text}
          </p>
        )}

        {!editing ? (
          <div className="type-eyebrow mt-2.5 flex gap-4 text-fg-faint">
            {canReply && user ? (
              <button
                type="button"
                onClick={() => setReplying((open) => !open)}
                className="transition-colors duration-150 hover:text-fg"
              >
                Reply
              </button>
            ) : null}
            {mine ? (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={`Edit your comment "${comment.text}"`}
                  className="transition-colors duration-150 hover:text-fg"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void remove()}
                  aria-label={`Delete your comment "${comment.text}"`}
                  className="transition-colors duration-150 hover:text-danger"
                >
                  Delete
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <Alert tone="error" inline className="mt-2">
          {error}
        </Alert>

        {replying && onReply ? (
          <div className="mt-3">
            <Composer
              label={`Reply to ${comment.author.username}`}
              // Not "Reply": that is what the control which opened this box says,
              // and two buttons with one name is a coin toss for anyone reaching
              // them by name rather than by position.
              submitLabel="Post reply"
              onSubmit={async (text) => {
                await onReply(text);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * `onCountChange` reports how many comments appeared or disappeared, so the
 * review's footer stays in step without re-reading the review. Deleting a
 * top-level comment takes its replies with it, which is why this is a delta and
 * not a boolean.
 */
export function CommentSection({
  reviewId,
  onCountChange,
}: {
  reviewId: string;
  onCountChange?: (delta: number) => void;
}) {
  const { authedRequest, user, isLoading } = useAuth();

  const [threads, setThreads] = useState<CommentThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Same reason as the review itself: this endpoint answers signed-out callers
    // with 200, so asking before the session settles would render the anonymous
    // view with no 401 for `authedRequest` to retry on.
    if (isLoading) return;

    let cancelled = false;
    authedRequest<CommentPage>(`/reviews/${reviewId}/comments?limit=${COMMENTS_PAGE_SIZE}`)
      .then((page) => {
        if (!cancelled) setThreads(page.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load the comments.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authedRequest, reviewId, isLoading]);

  async function post(text: string, parentCommentId?: string) {
    const created = await authedRequest<CommentItem>(`/reviews/${reviewId}/comments`, {
      method: "POST",
      body: { text, ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}) },
    });

    setThreads((current) => {
      const list = current ?? [];
      if (parentCommentId === undefined) return [...list, { ...created, replies: [] }];
      return list.map((thread) =>
        thread.id === parentCommentId
          ? { ...thread, replies: [...thread.replies, created] }
          : thread,
      );
    });
    onCountChange?.(1);
  }

  function replaceComment(updated: CommentItem) {
    setThreads((current) =>
      (current ?? []).map((thread) =>
        thread.id === updated.id
          ? { ...thread, ...updated }
          : {
              ...thread,
              replies: thread.replies.map((reply) => (reply.id === updated.id ? updated : reply)),
            },
      ),
    );
  }

  function removeThread(thread: CommentThread) {
    setThreads((current) => (current ?? []).filter((entry) => entry.id !== thread.id));
    // The replies went with it — see `delete_comment` in the API.
    onCountChange?.(-(1 + thread.replies.length));
  }

  function removeReply(threadId: string, replyId: string) {
    setThreads((current) =>
      (current ?? []).map((thread) =>
        thread.id === threadId
          ? { ...thread, replies: thread.replies.filter((reply) => reply.id !== replyId) }
          : thread,
      ),
    );
    onCountChange?.(-1);
  }

  return (
    // `id` is the anchor the feed's comment shortcut points at (SPEC §6.4).
    <section id="comments" className="mt-8">
      <Eyebrow as="h2" rule className="mb-5">
        Comments
      </Eyebrow>

      {user ? (
        <div className="mt-4">
          <Composer label="Add a comment" submitLabel="Post" onSubmit={(text) => post(text)} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-fg-dim">
          <Link href="/login" className="link text-fg">
            Sign in
          </Link>{" "}
          to join the conversation.
        </p>
      )}

      <div className="mt-4">
        {error ? (
          <Alert tone="error">{error}</Alert>
        ) : threads === null ? (
          <ListSkeleton count={2} label="Loading comments" />
        ) : threads.length > 0 ? (
          <ul aria-label="Comments" className="divide-y divide-line">
            {threads.map((thread) => (
              <li key={thread.id}>
                <Row
                  comment={thread}
                  canReply
                  onReply={(text) => post(text, thread.id)}
                  onEdited={replaceComment}
                  onDeleted={() => removeThread(thread)}
                />

                {thread.replies.length > 0 ? (
                  <ul
                    aria-label={`Replies to ${thread.author.username}`}
                    className="ml-11 border-l border-line pl-4"
                  >
                    {thread.replies.map((reply) => (
                      <li key={reply.id}>
                        <Row
                          comment={reply}
                          canReply={false}
                          onEdited={replaceComment}
                          onDeleted={() => removeReply(thread.id, reply.id)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="type-eyebrow text-fg-faint">
            No comments yet{user ? " — say something." : "."}
          </p>
        )}
      </div>
    </section>
  );
}
