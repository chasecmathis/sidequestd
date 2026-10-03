/**
 * A review as a Home feed row (SPEC §6.4).
 *
 * The type does the work here, exactly as on the web. The game title is the
 * display serif and the loudest thing on the card, because the game is what a
 * reader is scanning for; the author, the year, the rating and the playtime are
 * all one rank quieter in mono, which is what lets six of these stack without
 * any of them shouting.
 *
 * **The whole card presses, which the web's does not.** That is not a redesign,
 * it is the markup rule falling away: the web keeps the card a `<div>` because
 * SPEC §6.4 wants a working like button on it, and a `<button>` inside an
 * `<a>` is invalid and behaves differently in every browser. Native has no such
 * rule — a nested `Pressable` simply wins the touch — so the card can be the
 * large, obvious target a thumb wants, with the author, the game and the media
 * still their own targets inside it.
 *
 * The heart in the footer is a real control now, nested inside the pressable
 * card — which is the arrangement the web could not have: a `<button>` inside an
 * `<a>` is invalid markup, so the web keeps its card a `<div>` and gives the
 * title its own link. Here the inner `Pressable` simply wins the touch, so the
 * heart likes and the rest of the card opens the review.
 *
 * The comment count beside it stays a label. The web links it to the thread with
 * a `#comments` fragment; native has no anchors, so a control there would open
 * the same screen the card already opens and be a second target competing for
 * the same gesture.
 */
import { MessageSquare } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import {
  commentCountLabel,
  excerpt,
  formatPlaytime,
  formatStars,
  profilePath,
  releaseYearLabel,
  reviewPath,
  timeAgo,
} from "@sidequestd/core";
import type { ReviewSummary } from "@sidequestd/api-types";

import { open } from "@/lib/navigate";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

import { Avatar } from "./avatar";
import { LikeButton } from "./like-button";
import { Cover, RemoteImage } from "./media";
import { StarRating } from "./star-rating";
import { Badge } from "./ui/badge";
import { Card, CardFooter } from "./ui/card";
import { MetaRule } from "./ui/rule";
import { EyebrowText, Text } from "./ui/text";
import { VerifiedPlaytimeChip } from "./verified-playtime";

export function ReviewCard({ review }: { review: ReviewSummary }) {
  const styles = useStyles(make);
  const tokens = useTokens();

  const text = excerpt(review.review_text);
  const playtime = formatPlaytime(review.playtime_minutes);
  const hasMedia = review.media_count > 0;

  const openReview = () => open(reviewPath(review.id));
  const openGame = () => open(`/games/${review.game.id}`);
  const openAuthor = () => open(profilePath(review.author.username));

  return (
    <Card onPress={openReview}>
      <View style={styles.header}>
        <Pressable onPress={openAuthor} accessibilityRole="button" hitSlop={6}>
          <Avatar user={review.author} size={32} />
        </Pressable>

        <Pressable onPress={openAuthor} accessibilityRole="button" style={styles.headerName}>
          <Text size={14} weight="medium" numberOfLines={1}>
            {review.author.display_name ?? review.author.username}
          </Text>
        </Pressable>

        <EyebrowText tone="faint">{timeAgo(review.created_at)}</EyebrowText>
      </View>

      {/* Only what the reviewer actually attached gets the wide panel. The API
          falls `thumbnail_url` back to the game's cover art, which is right for
          a square profile tile and wrong here: portrait box art cropped to
          landscape across the full card reads as the reviewer's own screenshot.
          A review with no media shows the cover small and upright below, as
          context for what is being reviewed. */}
      {hasMedia && review.thumbnail_url ? (
        <View style={styles.panel}>
          <RemoteImage
            uri={review.thumbnail_url}
            label={`${review.game.title} — reviewed by ${review.author.username}`}
            style={styles.panelImage}
          />
          {/* The count, not the media itself: a clip and a second photo look the
              same from here, and "3" is what tells a reader there is more inside
              than the frame they can see. */}
          {review.media_count > 1 ? (
            <Badge tone="overlay" style={styles.panelBadge}>
              {review.media_count}
            </Badge>
          ) : null}
        </View>
      ) : null}

      <View style={styles.body}>
        <View style={styles.bodyRow}>
          {!hasMedia && review.game.cover_url ? (
            <Pressable
              onPress={openGame}
              accessibilityRole="button"
              accessibilityLabel={`${review.game.title} cover art`}
              style={styles.thumb}
            >
              <Cover uri={review.game.cover_url} title={review.game.title} compact />
            </Pressable>
          ) : null}

          <View style={styles.bodyText}>
            <Pressable onPress={openGame} accessibilityRole="button">
              <Text variant="display" size={24}>
                {review.game.title}
              </Text>
            </Pressable>

            {/* One mono line for every fact about the review. Read as a strip
                rather than as sentences, which is what makes a rating comparable
                at a glance across a column of cards. */}
            <View style={styles.strip}>
              <StarRating rating={review.rating} size={14} />
              <Text variant="mono" size={11} tone="dim" style={styles.tabular}>
                {formatStars(review.rating)} / 5
              </Text>

              <MetaRule />
              <EyebrowText tone="faint">{releaseYearLabel(review.game.release_year)}</EyebrowText>

              {/* One playtime figure, never two. When the platform has published
                  one it supersedes the author's own: they are measuring the same
                  thing, and a card showing "Played 40h" beside "47h on Steam"
                  invites a reader to work out which one is lying. */}
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
        </View>

        {text ? (
          <Text size={14} tone="dim" relaxed style={styles.excerpt}>
            {text}
          </Text>
        ) : null}
      </View>

      <CardFooter>
        <LikeButton
          interactions={{
            review_id: review.id,
            like_count: review.like_count,
            comment_count: review.comment_count,
            viewer_has_liked: review.viewer_has_liked,
          }}
        />

        <View style={styles.count}>
          <MessageSquare size={16} strokeWidth={1.75} color={tokens.color.fgFaint} />
          <EyebrowText tone="faint" style={styles.tabular}>
            {commentCountLabel(review.comment_count)}
          </EyebrowText>
        </View>
      </CardFooter>
    </Card>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    headerName: { flex: 1, minWidth: 0 },

    panel: {
      marginTop: 16,
      width: "100%",
      aspectRatio: 4 / 3,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface2,
    },
    panelImage: { width: "100%", height: "100%" },
    panelBadge: { position: "absolute", right: 12, top: 12 },

    body: { padding: 16 },
    bodyRow: { flexDirection: "row", gap: 16 },
    // 74×112 on the web — the same 3:4 at the same width, so a card without
    // media is the same height on both clients.
    thumb: {
      width: 74,
      flexShrink: 0,
      overflow: "hidden",
      ...rounded(t.radius.md),
      borderWidth: 1,
      borderColor: t.color.line,
    },
    bodyText: { flex: 1, minWidth: 0 },

    strip: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: 10,
      rowGap: 8,
      marginTop: 10,
    },
    tabular: { fontVariant: ["tabular-nums"] },

    excerpt: { marginTop: 16 },

    count: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
  });
