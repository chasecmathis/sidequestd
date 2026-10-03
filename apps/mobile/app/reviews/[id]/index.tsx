/**
 * Review Detail — SPEC §6.3.
 *
 * One request carries everything the screen shows: author, game, rating, text,
 * media carousel, playtime and the three counters. The comment thread is a
 * second request, because it is paged.
 *
 * The counters and the thread are kept in step without re-reading the review:
 * `LikeButton` is handed the interactions and reports what the server said they
 * became, and `CommentSection` reports a *delta* rather than a count, because
 * deleting a top-level comment takes its replies with it. Both are the web's
 * arrangement, and both matter more here — a refetch on a phone is a spinner
 * over a screen somebody is reading.
 *
 * The game is the headline and the reviewer is the byline, in that order — this
 * is a review *of something*, and a screen that leads with the author reads like
 * a profile.
 *
 * Media that is still processing is polled for, exactly as on the web: uploads
 * are handled in the background (SPEC §6.3), so a review opened straight after
 * posting has thumbnails that do not exist yet. That path matters more here than
 * it does on the web, because the phone is where the photo was taken — the
 * reader who sees this is almost always the person who just posted it.
 */
import { useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { MessageSquare, SquarePen } from "lucide-react-native";

import {
  ApiError,
  commentCountLabel,
  formatPlaytime,
  formatStars,
  isProcessing,
  profilePath,
  releaseYearLabel,
  useAuth,
} from "@sidequestd/core";
import type { ReviewDetail } from "@sidequestd/api-types";

import { Avatar } from "@/components/avatar";
import { BacklogControl } from "@/components/backlog-control";
import { CommentSection } from "@/components/comments";
import { LikeButton } from "@/components/like-button";
import { MediaCarousel } from "@/components/media-carousel";
import { Screen } from "@/components/screen";
import { StarRating } from "@/components/star-rating";
import { VerifiedPlaytimeChip } from "@/components/verified-playtime";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { MetaRule } from "@/components/ui/rule";
import { ReviewSkeleton } from "@/components/ui/skeleton";
import { EyebrowText, Text } from "@/components/ui/text";
import { open } from "@/lib/navigate";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

/** How long to wait before asking again whether the media has finished. */
const POLL_MS = 2000;

export default function ReviewDetailScreen() {
  const styles = useStyles(make);
  const tokens = useTokens();

  const { id } = useLocalSearchParams<{ id: string }>();
  const { authedRequest, isLoading, user } = useAuth();

  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => authedRequest<ReviewDetail>(`/reviews/${id}`), [authedRequest, id]);

  useEffect(() => {
    // This endpoint answers signed-out callers with 200, so a request sent
    // before the initial /auth/refresh lands would come back as the anonymous
    // view — with no 401 for `authedRequest`'s retry to hook into.
    if (isLoading) return;

    let cancelled = false;
    setReview(null);
    setError(null);
    load()
      .then((body) => {
        if (!cancelled) setReview(body);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(
          cause instanceof ApiError && cause.status === 404
            ? "That review no longer exists."
            : cause instanceof ApiError && cause.status === 403
              ? "This account is private. Follow them to see their reviews."
              : cause instanceof Error
                ? cause.message
                : "Request failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [load, isLoading]);

  // Poll only while something is actually pending, then stop.
  const pending = review?.media.some(isProcessing) ?? false;
  useEffect(() => {
    if (!pending) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      load()
        .then((body) => {
          if (!cancelled) setReview(body);
        })
        .catch(() => {
          /* A failed poll is not worth reporting: the screen already renders. */
        });
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pending, review, load]);

  if (error) {
    return (
      <Screen back>
        <Alert>{error}</Alert>
        <Button onPress={() => open("/")} style={styles.away}>
          Back to Home
        </Button>
      </Screen>
    );
  }

  if (!review) {
    return (
      <Screen back>
        <ReviewSkeleton />
      </Screen>
    );
  }

  const playtime = formatPlaytime(review.playtime_minutes);
  const isOwner = user?.id === review.author.id;
  const openAuthor = () => open(profilePath(review.author.username));
  const openGame = () => open(`/games/${review.game.id}`);

  return (
    <Screen back>
      <View>
        <Pressable onPress={openGame} accessibilityRole="button">
          <EyebrowText tone="dim">{releaseYearLabel(review.game.release_year)}</EyebrowText>
          <Text variant="display" size={34} accessibilityRole="header" style={styles.title}>
            {review.game.title}
          </Text>
        </Pressable>

        <View style={styles.strip}>
          <StarRating rating={review.rating} size={20} />
          <Text variant="mono" size={11} tone="dim" style={styles.tabular}>
            {formatStars(review.rating)} / 5
          </Text>

          {/* One playtime figure, never two — the platform's supersedes the
              author's, for the reason `ReviewCard` gives. */}
          {review.verified_playtime ? (
            <>
              <MetaRule />
              <VerifiedPlaytimeChip verified={review.verified_playtime} />
            </>
          ) : playtime ? (
            <>
              <MetaRule />
              <EyebrowText tone="faint">Played {playtime}</EyebrowText>
            </>
          ) : null}
        </View>
      </View>

      {/* The byline is a row rather than one big target now that it carries a
          control: a `Pressable` wrapping a `Pressable` works on native, and is
          exactly the arrangement where a thumb aiming for Edit navigates to a
          profile instead. */}
      <View style={styles.byline}>
        <Pressable
          onPress={openAuthor}
          accessibilityRole="button"
          accessibilityLabel={`@${review.author.username}`}
          style={styles.bylineWho}
        >
          <Avatar user={review.author} size={40} />
          <View style={styles.bylineNames}>
            <Text size={14} weight="medium" numberOfLines={1}>
              {review.author.display_name ?? review.author.username}
            </Text>
            <EyebrowText tone="faint" style={styles.handle}>
              @{review.author.username}
            </EyebrowText>
          </View>
        </Pressable>

        {isOwner ? (
          <Button size="sm" icon={SquarePen} onPress={() => open(`/reviews/${review.id}/edit`)}>
            Edit
          </Button>
        ) : null}
      </View>

      {review.media.length > 0 ? (
        <MediaCarousel items={review.media} title={review.game.title} />
      ) : null}

      {/* The one long piece of somebody else's writing in the app, and the only
          screen where it is shown whole rather than as an excerpt. On the web it
          could be selected because everything can; here it has to be asked for,
          and this is the text worth quoting. The card in the feed does not get
          it — a `Text` that swallows a long press is a card that stops opening
          on one. */}
      {review.review_text ? (
        <Text size={16} tone="dim" relaxed selectable>
          {review.review_text}
        </Text>
      ) : null}

      {/* SPEC §6.9's third entry point. Reading somebody's review is the moment
          a reader decides they want to play the thing, and making them go and
          find it again would waste that. */}
      <View style={styles.listPanel}>
        <Eyebrow>Add {review.game.title} to a list</Eyebrow>
        <BacklogControl game={review.game} />
      </View>

      <View style={styles.footer}>
        <LikeButton
          interactions={{
            review_id: review.id,
            like_count: review.like_count,
            comment_count: review.comment_count,
            viewer_has_liked: review.viewer_has_liked,
          }}
          onChange={(result) =>
            setReview((current) =>
              current
                ? {
                    ...current,
                    like_count: result.like_count,
                    viewer_has_liked: result.viewer_has_liked,
                  }
                : current,
            )
          }
        />

        <View style={styles.count}>
          <MessageSquare size={16} strokeWidth={1.75} color={tokens.color.fgFaint} />
          <EyebrowText tone="faint" style={styles.tabular}>
            {commentCountLabel(review.comment_count)}
          </EyebrowText>
        </View>
      </View>

      <CommentSection
        reviewId={review.id}
        onCountChange={(delta) =>
          setReview((current) =>
            current ? { ...current, comment_count: Math.max(current.comment_count + delta, 0) } : current,
          )
        }
      />
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    title: { marginTop: 10 },

    strip: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: 12,
      rowGap: 10,
      marginTop: 18,
    },
    tabular: { fontVariant: ["tabular-nums"] },

    byline: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: t.color.line,
      paddingVertical: 14,
    },
    bylineWho: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
    bylineNames: { flex: 1, minWidth: 0 },
    handle: { marginTop: 4 },

    listPanel: {
      gap: 14,
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      padding: 16,
    },

    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderTopWidth: 1,
      borderTopColor: t.color.line,
      paddingTop: 8,
    },
    // The same metrics `LikeButton` gives its own row, so the two sit on one
    // baseline rather than one being a control and the other a label.
    count: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8 },

    away: { alignSelf: "flex-start" },
  });
