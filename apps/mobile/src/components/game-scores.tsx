/**
 * The two scores a game carries (SPEC §5).
 *
 * Two measurements, side by side, with deliberately no arithmetic between them.
 * Ours is the amber five-star row the rest of the app rates in; IGDB's is a
 * 0-100 numeral over a hairline meter. Folding IGDB into five stars would invent
 * a precision it does not have and imply the two are one number measured twice —
 * they are a blended critic-and-player aggregate and a small community's mean,
 * and the point of showing both is that they disagree.
 *
 * The meter is achromatic on purpose. The palette keeps the amber stars as the
 * one warm thing on a card and spends the accent on fills, borders and focus
 * rings; a second coloured bar here would give the block a third voice and stop
 * the stars reading as data.
 *
 * Two empty states, and both matter more than they look:
 *
 * * Nobody has rated it → "—" and "Not yet rated", never five hollow stars,
 *   which would say the game was rated zero.
 * * IGDB has no score → the half is *absent*, not empty. Most of the catalog has
 *   none until the weekly sync has walked it, and an empty meter everywhere
 *   would read as "IGDB rated this nothing".
 *
 * The two columns stay two columns at 390px rather than stacking. They are meant
 * to be read *against* each other, and one above the other is a list.
 */
import { StyleSheet, View } from "react-native";

import {
  formatGameRating,
  formatIgdbRating,
  IGDB_MAX_RATING,
  igdbMeterFill,
  ratingCountLabel,
} from "@sidequestd/core";
import type { GameSummary } from "@sidequestd/api-types";

import { useStyles, type Tokens } from "@/theme";

import { StarRating } from "./star-rating";
import { Eyebrow } from "./ui/eyebrow";
import { EyebrowText, Text } from "./ui/text";

/**
 * The band under each numeral that carries its mark — the star row on our side,
 * the meter on theirs. One fixed height for both, so the two captions below them
 * sit on the same line and the block reads as two columns of one table.
 */
const MARK_HEIGHT = 16;

export function GameScores({ game }: { game: GameSummary }) {
  const styles = useStyles(make);

  const average = game.rating_average ?? null;
  const igdbRating = game.igdb_rating ?? null;

  const ours = formatGameRating(average);
  const ourCount = ratingCountLabel(game.rating_count);
  const igdb = formatIgdbRating(igdbRating);
  const igdbCount = ratingCountLabel(game.igdb_rating_count);

  return (
    <View style={styles.band}>
      <View style={styles.column}>
        <Eyebrow>Sidequestd</Eyebrow>

        {average !== null && ours !== null ? (
          <>
            <Text variant="display" size={30} style={styles.figure}>
              {ours}
              <Text variant="display" size={18} tone="faint">
                {" "}
                / 5
              </Text>
            </Text>
            {/* Under the numeral, where the other column keeps its meter, so the
                two big figures share a baseline and can be read against each
                other in one glance. */}
            <View style={styles.mark}>
              <StarRating rating={average} size={14} />
            </View>
          </>
        ) : (
          <Text variant="display" size={30} tone="faint" style={styles.figure}>
            —
          </Text>
        )}

        <EyebrowText tone="faint" style={styles.caption}>
          {ourCount ?? "Not yet rated"}
        </EyebrowText>
      </View>

      {igdbRating !== null && igdb !== null ? (
        <View style={styles.column}>
          <Eyebrow>IGDB</Eyebrow>

          <Text
            variant="display"
            size={30}
            style={styles.figure}
            accessibilityLabel={`${igdb} out of ${IGDB_MAX_RATING} on IGDB`}
          >
            {igdb}
            <Text variant="display" size={18} tone="faint">
              {" "}
              / {IGDB_MAX_RATING}
            </Text>
          </Text>

          {/* Restates the numeral directly above it, so it is decoration to a
              screen reader and hidden outright — the same division of labour the
              star row uses, where the value rides on one accessible name. */}
          <View
            style={styles.mark}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${igdbMeterFill(igdbRating) * 100}%` }]} />
            </View>
          </View>

          <EyebrowText tone="faint" style={styles.caption}>
            {igdbCount ?? "Score only"}
          </EyebrowText>
        </View>
      ) : null}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    band: {
      flexDirection: "row",
      gap: 24,
      marginTop: 28,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: t.color.line,
      paddingVertical: 20,
    },
    column: { flex: 1, minWidth: 0 },

    figure: { marginTop: 10, fontVariant: ["tabular-nums"] },
    mark: { height: MARK_HEIGHT, justifyContent: "center", marginTop: 10 },
    caption: { marginTop: 8 },

    track: { height: 1, width: "100%", backgroundColor: t.color.line },
    fill: { height: 1, backgroundColor: t.color.fgDim },
  });
