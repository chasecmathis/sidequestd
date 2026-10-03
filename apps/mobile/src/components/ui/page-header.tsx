/**
 * The top of every screen: an eyebrow, a serif title, a line of explanation and
 * somewhere to put the screen's one action.
 *
 * Centralised for the same reason as on the web — a serif this high-contrast is
 * unforgiving about being set at two sizes on adjacent screens — but the size
 * itself is re-decided rather than scaled. The web's `<h1>` is 36px rising to
 * 48px against a 1024px measure; at 390px that sets "Notifications" across two
 * lines and pushes the first row of content off the screen. 34 is where the word
 * fits on one line and the face still has its contrast.
 *
 * The action drops below the title rather than sitting beside it. Native's
 * right-hand slot at the top of a screen belongs to the app bar, which is where
 * "Write a review" lives; a second control competing for the same corner is the
 * thing this layout is avoiding.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { text, useStyles, type Tokens } from "@/theme";

import { Eyebrow } from "./eyebrow";
import { Text } from "./text";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  style,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);

  return (
    <View style={style}>
      {eyebrow ? <Eyebrow style={styles.eyebrow}>{eyebrow}</Eyebrow> : null}

      <Text variant="display" size={text.size.page} accessibilityRole="header">
        {title}
      </Text>

      {description ? (
        <Text size={14} tone="dim" relaxed style={styles.description}>
          {description}
        </Text>
      ) : null}

      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const make = (_t: Tokens) =>
  StyleSheet.create({
    eyebrow: { marginBottom: 12 },
    description: { marginTop: 12 },
    action: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 20 },
  });
