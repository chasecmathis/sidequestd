/**
 * A row of covers that scrolls sideways.
 *
 * **The one layout that is not the web's, and the reason is the page it is on.**
 * A profile stacks four backlog lists, a favourites row and a most-played row;
 * the web gives each of them a six-across grid, which at 390px becomes six
 * stacked rows of two and a profile you scroll for a minute to reach the reviews
 * of. A sideways shelf keeps each section one row tall, which is what makes the
 * *page* readable — the sections are a summary, and the grid they link into is
 * where somebody goes to actually browse.
 *
 * It is also the shape the content already has: these rows are ordered (by
 * position, by hours) and short. A shelf says "here are the top few, in order"
 * where a wrapped grid says "here is all of it".
 *
 * `CoverTile` is the tile itself, caption open to the caller — the three shelves
 * caption differently and only differ in that: a slot numeral on favourites,
 * hours on the platform showcase, nothing but a title on a backlog list.
 */
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ReactNode } from "react";

import { SCREEN_GUTTER } from "@/lib/layout";
import { rounded, useStyles, type Tokens } from "@/theme";

import { Cover } from "./media";

/** Wide enough to recognise box art by, narrow enough that three and a bit show. */
const TILE_WIDTH = 104;

export function GameShelf({ label, children }: { label: string; children: ReactNode }) {
  const styles = useStyles(make);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="list"
      accessibilityLabel={label}
      // The shelf runs to both screen edges while its parent is inset, so the
      // last cover is visibly cut off rather than sitting in a margin that
      // suggests the row has ended. `contentContainerStyle` puts the gutter back
      // as padding, which is what keeps the first tile aligned with the heading.
      style={styles.bleed}
      contentContainerStyle={styles.track}
    >
      {children}
    </ScrollView>
  );
}

export function CoverTile({
  title,
  coverUrl,
  onPress,
  caption,
}: {
  title: string;
  coverUrl: string | null | undefined;
  onPress: () => void;
  /** Under the cover. Kept to two lines' worth — the shelf is a row, not a list. */
  caption: ReactNode;
}) {
  const styles = useStyles(make);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <Cover uri={coverUrl} title={title} compact />
      <View style={styles.caption}>{caption}</View>
    </Pressable>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    bleed: { marginHorizontal: -SCREEN_GUTTER },
    track: { paddingHorizontal: SCREEN_GUTTER, gap: 10 },

    tile: {
      width: TILE_WIDTH,
      overflow: "hidden",
      ...rounded(t.radius.md),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
    },
    pressed: { borderColor: t.color.lineStrong },

    caption: { gap: 3, paddingHorizontal: 8, paddingVertical: 8 },
  });
