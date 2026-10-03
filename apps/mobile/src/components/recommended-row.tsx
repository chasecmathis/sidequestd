/**
 * A recommended review in Home (SPEC §6.4).
 *
 * The card underneath is the ordinary `ReviewCard` — the API sends the identical
 * review, and a recommendation the reader cannot open or like would be a worse
 * row than the ones around it. What this adds is the one thing SPEC §6.4 insists
 * on: that it is "clearly distinguishable from pure follow feed". A reader who
 * cannot tell why a stranger is in their Home has been given an advert.
 *
 * The label sits *above* the card rather than inside it, so the distinction is
 * legible before the reader has started reading a stranger's opinion, and so the
 * card stays one component with one set of rules. A follow row and a recommended
 * row differ in exactly this line.
 */
import { Sparkles } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { recommendationLabel } from "@sidequestd/core";
import type { FeedRecommendedItem } from "@sidequestd/api-types";

import { useStyles, useTokens, type Tokens } from "@/theme";

import { ReviewCard } from "./review-card";
import { EyebrowText } from "./ui/text";

export function RecommendedRow({ item }: { item: FeedRecommendedItem }) {
  const styles = useStyles(make);
  const tokens = useTokens();

  return (
    <View accessibilityLabel="Recommended for you">
      <View style={styles.label}>
        {/* The accent as a small filled mark rather than as coloured type — the
            palette rule, and the reason this line can be quiet and still be the
            first thing noticed above a card. */}
        <Sparkles size={13} strokeWidth={1.75} color={tokens.color.accent} />
        <EyebrowText tone="faint">Recommended · {recommendationLabel(item.reason)}</EyebrowText>
      </View>

      <ReviewCard review={item.review} />
    </View>
  );
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    label: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 10,
      paddingHorizontal: 4,
    },
  });
