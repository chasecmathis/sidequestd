/**
 * The result card from SPEC §6.6: cover art, title, release year, how it was
 * rated, platforms.
 *
 * The cover art is the card. Everything under it is set small and quiet so a
 * grid of these reads as a shelf of boxes rather than a table with pictures —
 * which is also why the title sits in the serif: it is the one line anybody
 * scans. 17pt is the display face's floor (see `theme/typography.ts`), and a
 * card title is the case the floor was chosen for.
 *
 * **Two columns, fixed.** The web's grid runs two to five across its
 * breakpoints; a phone has one width, and at 390px three covers are too small to
 * recognise a box by, which is the entire job of the artwork here.
 *
 * `action` is a slot below the card for a control that belongs to the game but
 * is not "open the game" — the add-to-list picker on Search (SPEC §6.9). On the
 * web it has to be a *sibling* of the link because a select inside an anchor is
 * invalid markup; here it could legally be a child, and is kept a sibling
 * anyway. A control nested in a pressable card wins the touch, which is right
 * for a heart in a feed row and wrong for a 170pt-wide card whose whole face is
 * "open this game": the recessed footer is what says the two are different
 * targets before anybody presses one.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { formatGameRating, formatIgdbRating, releaseYearLabel } from "@sidequestd/core";
import type { GameSummary } from "@sidequestd/api-types";

import { useColumnWidth } from "@/lib/layout";
import { useStyles, type Tokens } from "@/theme";

import { Cover } from "./media";
import { StarGlyph } from "./star-rating";
import { Card, CardFooter } from "./ui/card";
import { EyebrowText, Text } from "./ui/text";

export function GameCard({
  game,
  onPress,
  action,
  style,
}: {
  game: GameSummary;
  onPress: () => void;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);

  const ours = formatGameRating(game.rating_average);
  const igdb = formatIgdbRating(game.igdb_rating);
  const platforms = game.platforms.map((platform) => platform.name).join(" · ");

  // A card with a control under it stops being one big target: the press moves
  // onto the part of the card that is *about* the game, so a thumb reaching for
  // the list picker cannot navigate instead.
  const face = (
    <>
      <Cover uri={game.cover_url} title={game.title} />

      <View style={styles.body}>
        <Text variant="display" size={17} numberOfLines={2}>
          {game.title}
        </Text>
        <EyebrowText tone="faint">{releaseYearLabel(game.release_year)}</EyebrowText>

        {/* Quiet on purpose: a grid of these is a shelf of boxes, and two scores
            set any louder would turn it into a leaderboard. Either half can be
            missing — most of the catalog has no IGDB score until the sync
            reaches it — so the separator and the line itself both come and go,
            and `marginTop: auto` lands on whichever row ends up last. */}
        {ours || igdb ? (
          <View style={[styles.scores, styles.pushed]}>
            {ours ? (
              <View style={styles.score} accessible accessibilityLabel={`${ours} out of 5 on Sidequestd`}>
                <StarGlyph size={11} />
                <Text variant="mono" size={12} tone="dim">
                  {ours}
                </Text>
              </View>
            ) : null}

            {ours && igdb ? <Text variant="mono" size={12} tone="faint">·</Text> : null}

            {igdb ? (
              <View style={styles.score} accessible accessibilityLabel={`${igdb} out of 100 on IGDB`}>
                <EyebrowText tone="faint">IGDB</EyebrowText>
                <Text variant="mono" size={12} tone="dim">
                  {igdb}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <Text
          size={12}
          tone="faint"
          numberOfLines={1}
          style={!ours && !igdb ? styles.pushed : undefined}
        >
          {platforms || "Platform unknown"}
        </Text>
      </View>
    </>
  );

  if (!action) {
    return (
      <Card onPress={onPress} style={style}>
        {face}
      </Card>
    );
  }

  return (
    <Card style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={game.title}
        onPress={onPress}
        style={({ pressed }) => [styles.face, pressed && styles.facePressed]}
      >
        {face}
      </Pressable>

      <CardFooter style={styles.action}>{action}</CardFooter>
    </Card>
  );
}

/**
 * The shelf.
 *
 * A wrapping row rather than a `FlatList` with `numColumns`: every caller draws
 * this inside a scroll that already owns something else — Discover's four
 * sections, a profile's four backlog lists — and a list inside a scroll is the
 * native mistake that turns virtualisation off while pretending to keep it. The
 * pages that genuinely need virtualising are the feed and the follow lists, and
 * those are lists all the way down.
 */
export function GameGrid({
  games,
  onOpen,
  action,
  label = "Games",
}: {
  games: GameSummary[];
  onOpen: (game: GameSummary) => void;
  /** Rendered under every card. Given the game, so one grid can build a control per cell. */
  action?: (game: GameSummary) => ReactNode;
  label?: string;
}) {
  const styles = useStyles(make);
  const width = useColumnWidth(GRID_COLUMNS, GRID_GAP);

  return (
    <View style={styles.grid} accessibilityRole="list" accessibilityLabel={label}>
      {games.map((game) => (
        <GameCard
          key={game.id}
          game={game}
          onPress={() => onOpen(game)}
          action={action?.(game)}
          style={{ width }}
        />
      ))}
    </View>
  );
}

const GRID_COLUMNS = 2;
/** The gutter `GameGridSkeleton` also leaves, so nothing moves when covers land. */
const GRID_GAP = 16;

const make = (_t: Tokens) =>
  StyleSheet.create({
    // No `flex: 1` on the card, and that is a trap rather than an omission: a
    // flex child's `flexBasis` of 0 beats an explicit `width`, so the pixel
    // width the grid hands each cell would be ignored and every row would
    // divide itself evenly — including a last row holding one card. The card
    // still fills its row's height, because a wrapped row stretches its items
    // on the cross axis without being asked.
    body: { flex: 1, gap: 6, padding: 12 },

    // The pressable half of a card that has a footer. It has to grow, or the
    // cover and the footer split the cell's height between them.
    face: { flex: 1 },
    facePressed: { opacity: 0.85 },
    // Roomier than `CardFooter`'s own padding, which was sized for a row of
    // 16pt icon buttons rather than for a control with a label in it.
    action: { padding: 8 },

    scores: { flexDirection: "row", alignItems: "center", gap: 6 },
    score: { flexDirection: "row", alignItems: "center", gap: 4 },
    // Whichever line ends up last is pinned to the foot of the card, so a row of
    // cards with different title lengths still agrees where its bottom line is.
    pushed: { marginTop: "auto", paddingTop: 4 },

    // The cells carry pixel widths from `useColumnWidth` rather than a flex
    // basis — see `lib/layout.ts` for the last-row bug that avoids.
    grid: { flexDirection: "row", flexWrap: "wrap", gap: GRID_GAP },
  });
