/**
 * One number and what it counts (SPEC §6.8).
 *
 * The number is set in the display serif, large. That is the whole idea of the
 * profile stats block: figures set like pull-quotes rather than rows of a table,
 * so a profile has something with weight on it above the fold.
 *
 * `fontVariant: ["tabular-nums"]` is the web's `tabular-nums`, and it matters
 * more on a phone than it does there — the stats sit in a two-column grid, and
 * proportional digits make the second column jitter as the numbers change.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { rounded, useStyles, type Tokens } from "@/theme";

import { EyebrowText, Text } from "./text";

export function Stat({
  label,
  value,
  style,
}: {
  label: string;
  value: string | number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);

  return (
    // One accessible node rather than two: "Reviews, 42" in a single
    // announcement, instead of a label and a number the reader has to join up.
    <View style={[styles.tile, style]} accessible accessibilityLabel={`${label}, ${value}`}>
      <EyebrowText tone="faint">{label}</EyebrowText>
      <Text variant="display" size={28} style={styles.value}>
        {value}
      </Text>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    tile: {
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    value: { marginTop: 8, fontVariant: ["tabular-nums"] },
  });
