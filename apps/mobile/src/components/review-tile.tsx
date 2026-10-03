/**
 * The Instagram-style grid from SPEC §6.2: a square tile per review.
 *
 * `thumbnail_url` is resolved server-side — the first media thumbnail, or the
 * game's cover art — so a tile never has to decide what to fall back to, and a
 * review with only a clip attached still shows something.
 *
 * **The rating is permanent here, and on the web it is on hover.** That is the
 * one substantive difference and it is forced: a touch screen has no hover, so
 * "reveal the stars when the reader asks" has no gesture behind it, and the
 * alternative is a grid where the answer to "what did they think" cannot be
 * reached at all. The scrim comes up with it, which is what keeps a row of
 * amber stars legible over an arbitrary screenshot — and is exactly why `Scrim`
 * pins the palette. See `media.tsx`.
 *
 * The lattice differs too. The web draws flush tiles separated by a 1px gap with
 * a ring showing through it; that trick needs a container background, which
 * fills the empty cells of a short last row as well. Here the tiles are simply
 * spaced, each with its own hairline — the same separation, no phantom
 * rectangles beside a profile's only review.
 */
import { Pressable, StyleSheet, View } from "react-native";

import { reviewPath } from "@sidequestd/core";
import type { ReviewSummary } from "@sidequestd/api-types";

import { useColumnWidth } from "@/lib/layout";
import { rounded, useStyles, type Tokens } from "@/theme";

import { RemoteImage, Scrim } from "./media";
import { StarRating } from "./star-rating";
import { EyebrowText, Text } from "./ui/text";

const COLUMNS = 3;
const GAP = 3;

export function ReviewTile({
  review,
  onPress,
  size,
}: {
  review: ReviewSummary;
  onPress: () => void;
  size: number;
}) {
  const styles = useStyles(make);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${review.game.title} — review by ${review.author.username}`}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, { width: size, height: size }, pressed && styles.pressed]}
    >
      {review.thumbnail_url ? (
        // Unlabelled: the tile itself is the accessible node and already names
        // the game and the reviewer. A label here would say it a second time.
        <RemoteImage uri={review.thumbnail_url} label={null} style={StyleSheet.absoluteFill} />
      ) : (
        <Text variant="display" size={16} tone="dim" numberOfLines={3} style={styles.fallback}>
          {review.game.title}
        </Text>
      )}

      <Scrim>
        <StarRating rating={review.rating} size={11} />
        {review.media_count > 1 ? (
          <EyebrowText tone="dim">{review.media_count}</EyebrowText>
        ) : null}
      </Scrim>
    </Pressable>
  );
}

export function ReviewGrid({
  reviews,
  onOpen,
}: {
  reviews: ReviewSummary[];
  /** Given the path rather than the review, so the caller does not rebuild it. */
  onOpen: (path: string) => void;
}) {
  const styles = useStyles(make);
  const size = useColumnWidth(COLUMNS, GAP);

  return (
    <View style={styles.grid} accessibilityRole="list" accessibilityLabel="Reviews grid">
      {reviews.map((review) => (
        <ReviewTile
          key={review.id}
          review={review}
          size={size}
          onPress={() => onOpen(reviewPath(review.id))}
        />
      ))}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },

    tile: {
      overflow: "hidden",
      ...rounded(t.radius.sm),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface2,
      alignItems: "center",
      justifyContent: "center",
    },
    pressed: { borderColor: t.color.lineStrong },

    fallback: { textAlign: "center", paddingHorizontal: 8 },
  });
