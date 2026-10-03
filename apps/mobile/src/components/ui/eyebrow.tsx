/**
 * The mono micro-label, with the editorial rule.
 *
 * Section headings, field legends, the "PLAYED 62H" beside a rating — anything
 * that labels rather than states. `rule` extends a hairline from the end of the
 * text to the edge of its container, which is the device that makes a section
 * feel typeset instead of stacked, and it is most of what a native screen has
 * left once the web's larger headings have been cut down to phone sizes.
 *
 * The web takes `as="h2"` so the document outline still means something. Native
 * has no outline; the equivalent is `accessibilityRole="header"`, which is what
 * `heading` sets — it is what makes VoiceOver's rotor list the sections.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { useStyles, type Tokens } from "@/theme";

import { EyebrowText } from "./text";

export function Eyebrow({
  rule = false,
  heading = false,
  children,
  style,
}: {
  rule?: boolean;
  /** True where this genuinely labels a region rather than a single value. */
  heading?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);

  return (
    <View style={[styles.row, style]}>
      <EyebrowText tone="faint" accessibilityRole={heading ? "header" : undefined}>
        {children}
      </EyebrowText>
      {rule ? <View style={styles.rule} /> : null}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", gap: 12 },
    rule: { flex: 1, height: 1, backgroundColor: t.color.line },
  });
