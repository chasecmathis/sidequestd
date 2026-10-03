/**
 * What a surface says when it has nothing to show.
 *
 * A dimmed icon, a real heading, and — where there is one — the action that
 * would fill it. The dashed edge is what keeps an empty list from looking like
 * a validation error: it reads as an outline waiting to be filled rather than
 * as something highlighted for attention.
 *
 * `title` is what the reader sees first, so it states the situation.
 * `description` explains what would change it. Several callers only have the
 * sentence, so the title is optional and the description carries alone.
 */
import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { rounded, text, useStyles, useTokens, type Tokens } from "@/theme";

import { Text } from "./text";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  style,
}: {
  icon?: LucideIcon;
  title?: string;
  description: ReactNode;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();

  return (
    <View style={[styles.box, style]}>
      {Icon ? (
        <Icon size={28} strokeWidth={1.25} color={tokens.color.fgFaint} style={styles.icon} />
      ) : null}

      {title ? (
        <Text variant="display" size={text.size.section} accessibilityRole="header">
          {title}
        </Text>
      ) : null}

      <Text size={14} tone="dim" relaxed style={[styles.description, title && styles.spaced]}>
        {description}
      </Text>

      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    box: {
      alignItems: "center",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      // Android draws a dashed border as solid once a radius is involved, so on
      // that platform this quietly becomes a hairline outline. That is an
      // acceptable degradation — the shape, the dimmed icon and the centring are
      // what say "nothing here yet"; the dashes only say it more softly.
      borderStyle: "dashed",
      borderColor: t.color.line,
      paddingHorizontal: 24,
      paddingVertical: 40,
    },
    icon: { marginBottom: 16 },
    description: { textAlign: "center", maxWidth: 320 },
    spaced: { marginTop: 8 },
    action: { marginTop: 24 },
  });
