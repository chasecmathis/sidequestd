/**
 * The hairline between two facts in a mono strip.
 *
 * The web writes `<span aria-hidden className="h-3 w-px bg-line" />` inline in
 * four places; this is the same 12×1 rule, named, and hidden from a screen
 * reader for the same reason — it is punctuation, and the strip already reads as
 * a list of separate values without anybody announcing the gaps.
 */
import { StyleSheet, View } from "react-native";

import { useStyles, type Tokens } from "@/theme";

export function MetaRule() {
  const styles = useStyles(make);
  return <View style={styles.rule} accessibilityElementsHidden importantForAccessibility="no" />;
}

const make = (t: Tokens) =>
  StyleSheet.create({
    rule: { width: 1, height: 12, backgroundColor: t.color.line },
  });
