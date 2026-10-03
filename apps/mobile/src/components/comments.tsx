/**
 * The comment thread on a review (SPEC §6.10).
 *
 * One level of nesting, because that is all the API will accept: a top-level
 * comment offers "Reply", a reply does not, so the shape of the screen and the
 * shape of the data agree and there is no arrangement of taps that can produce a
 * request the server refuses.
 *
 * Rows are updated in place rather than by re-reading the list. A refetch after
 * every action would reorder or drop a row somebody is halfway through replying
 * to, and the API hands back the comment it just wrote — which is the same thing
 * the list would have returned.
 *
 * Two native decisions on top of the web's:
 *
 * **Delete asks first.** The web deletes on the click, which is defensible with
 * a cursor and an `aria-label` naming the comment being removed. A thumb on a
 * 13pt row beside "Edit" is a different proposition, and the platform already
 * has the control for it — `Alert.alert` with a destructive style is what every
 * iOS and Android app confirms an irreversible row action with, and it costs one
 * tap rather than a dialog of our own.
 *
 * **A row's actions are always visible.** On the web three of them appear in a
 * `hover:text-fg` rail; there is no hover here, so they are simply there, in
 * `type-eyebrow` at the same rank the web gives them at rest.
 */
import { useEffect, useState } from "react";
import { Alert as NativeAlert, Pressable, StyleSheet, View } from "react-native";

import {
  COMMENT_MAX_LENGTH,
  COMMENTS_PAGE_SIZE,
  commentCounter,
  ownsComment,
  profilePath,
  rejectComment,
  timeAgo,
  useAuth,
} from "@sidequestd/core";
import type { CommentItem, CommentPage, CommentThread } from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { useStyles, type Tokens } from "@/theme";

import { Avatar } from "./avatar";
import { Alert } from "./ui/alert";
import { Button, ButtonRow } from "./ui/button";
import { Eyebrow } from "./ui/eyebrow";
import { Textarea } from "./ui/field";
import { ListSkeleton } from "./ui/skeleton";
import { EyebrowText, Text } from "./ui/text";

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
  autoFocus = false,
  onSubmit,
  onCancel,
}: {
  label: string;
  submitLabel: string;
  initialText?: string;
  clearOnSubmit?: boolean;
  autoFocus?: boolean;
  onSubmit: (text: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const styles = useStyles(make);
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counter = commentCounter(text);

  async function submit() {
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
    <View style={styles.composer}>
      <Textarea
        label={label}
        placeholder={label}
        value={text}
        onChangeText={setText}
        rows={3}
        autoFocus={autoFocus}
        // One over the limit, so the API's rejection is reachable and the
        // counter can warn rather than silently truncating what was typed.
        maxLength={COMMENT_MAX_LENGTH + 1}
      />

      <View style={styles.composerActions}>
        <ButtonRow>
          <Button variant="primary" size="sm" disabled={pending} onPress={() => void submit()}>
            {pending ? "Sending…" : submitLabel}
          </Button>
          {onCancel ? (
            <Button size="sm" variant="ghost" onPress={onCancel}>
              Cancel
            </Button>
          ) : null}
        </ButtonRow>

        {counter ? (
          <EyebrowText tone="faint" style={styles.counter}>
            {counter}
          </EyebrowText>
        ) : null}
      </View>

      <Alert tone="error" inline>
        {error}
      </Alert>
    </View>
  );
}

/** One of the row's three actions. Mono, no border — the web's rail, at rest. */
function RowAction({
  children,
  label,
  danger = false,
  onPress,
}: {
  children: string;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(make);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={styles.rowAction}
    >
      {({ pressed }) => (
        <EyebrowText tone={danger ? (pressed ? "danger" : "faint") : pressed ? "fg" : "faint"}>
          {children}
        </EyebrowText>
      )}
    </Pressable>
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
  const styles = useStyles(make);
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

  function confirmRemove() {
    NativeAlert.alert(
      "Delete this comment?",
      // What is about to disappear, in the reader's own words — the alert has no
      // room for the thread beneath it, and a reply count is what makes this
      // decision different from deleting a leaf.
      "It can't be undone. Any replies to it go too.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => void remove() },
      ],
    );
  }

  const openAuthor = () => open(profilePath(comment.author.username));

  return (
    <View style={styles.row}>
      <Pressable
        onPress={openAuthor}
        accessibilityRole="button"
        accessibilityLabel={`@${comment.author.username}`}
        hitSlop={4}
      >
        <Avatar user={comment.author} size={32} />
      </Pressable>

      <View style={styles.rowBody}>
        <View style={styles.byline}>
          <Pressable onPress={openAuthor} accessibilityRole="button" hitSlop={4}>
            <Text size={14} weight="medium">
              {comment.author.username}
            </Text>
          </Pressable>
          <EyebrowText tone="faint">{timeAgo(comment.created_at)}</EyebrowText>
          {comment.edited ? <EyebrowText tone="faint">(edited)</EyebrowText> : null}
        </View>

        {editing ? (
          <Composer
            label="Edit your comment"
            submitLabel="Save"
            initialText={comment.text}
            clearOnSubmit={false}
            autoFocus
            onSubmit={save}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <Text size={14} tone="dim" relaxed selectable style={styles.text}>
            {comment.text}
          </Text>
        )}

        {!editing ? (
          <View style={styles.actions}>
            {canReply && user ? (
              <RowAction
                label={`Reply to ${comment.author.username}`}
                onPress={() => setReplying((value) => !value)}
              >
                {replying ? "Cancel reply" : "Reply"}
              </RowAction>
            ) : null}

            {mine ? (
              <>
                <RowAction label="Edit your comment" onPress={() => setEditing(true)}>
                  Edit
                </RowAction>
                <RowAction label="Delete your comment" danger onPress={confirmRemove}>
                  Delete
                </RowAction>
              </>
            ) : null}
          </View>
        ) : null}

        <Alert tone="error" inline style={styles.rowError}>
          {error}
        </Alert>

        {replying && onReply ? (
          <View style={styles.reply}>
            <Composer
              label={`Reply to ${comment.author.username}`}
              // Not "Reply": that is what the control which opened this box
              // says, and two buttons with one name is a coin toss for anyone
              // reaching them by name rather than by position.
              submitLabel="Post reply"
              autoFocus
              onSubmit={async (text) => {
                await onReply(text);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          </View>
        ) : null}
      </View>
    </View>
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
  const styles = useStyles(make);
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
    <View style={styles.section}>
      <Eyebrow heading rule>
        Comments
      </Eyebrow>

      {user ? (
        <Composer label="Add a comment" submitLabel="Post" onSubmit={(text) => post(text)} />
      ) : (
        <Pressable accessibilityRole="button" onPress={() => open("/login")} hitSlop={6}>
          <Text size={14} tone="dim">
            Sign in to join the conversation.
          </Text>
        </Pressable>
      )}

      {error ? (
        <Alert>{error}</Alert>
      ) : threads === null ? (
        <ListSkeleton count={2} label="Loading comments" />
      ) : threads.length > 0 ? (
        <View accessibilityRole="list" accessibilityLabel="Comments">
          {threads.map((thread, index) => (
            <View key={thread.id} style={index > 0 ? styles.threadRuled : undefined}>
              <Row
                comment={thread}
                canReply
                onReply={(text) => post(text, thread.id)}
                onEdited={replaceComment}
                onDeleted={() => removeThread(thread)}
              />

              {thread.replies.length > 0 ? (
                <View
                  accessibilityRole="list"
                  accessibilityLabel={`Replies to ${thread.author.username}`}
                  style={styles.replies}
                >
                  {thread.replies.map((reply) => (
                    <Row
                      key={reply.id}
                      comment={reply}
                      canReply={false}
                      onEdited={replaceComment}
                      onDeleted={() => removeReply(thread.id, reply.id)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : (
        <EyebrowText tone="faint">{user ? "No comments yet — say something." : "No comments yet."}</EyebrowText>
      )}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    section: { gap: 20 },

    composer: { gap: 12 },
    composerActions: { flexDirection: "row", alignItems: "center", gap: 12 },
    counter: { marginLeft: "auto", fontVariant: ["tabular-nums"] },

    threadRuled: { borderTopWidth: 1, borderTopColor: t.color.line },

    row: { flexDirection: "row", gap: 12, paddingVertical: 14 },
    rowBody: { flex: 1, minWidth: 0, gap: 8 },
    byline: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
    text: { marginTop: 2 },
    actions: { flexDirection: "row", gap: 20, marginTop: 2 },
    rowAction: { paddingVertical: 4 },
    rowError: { marginTop: 4 },
    reply: { marginTop: 8 },

    // The web indents replies by an avatar's width and rules them off on the
    // left. 44 is that avatar plus its gap; the rule is what keeps a reply
    // legible as one when the indent alone is this shallow.
    replies: { marginLeft: 44, borderLeftWidth: 1, borderLeftColor: t.color.line, paddingLeft: 14 },
  });
