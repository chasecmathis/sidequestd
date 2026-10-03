/**
 * The surface every piece of content sits on.
 *
 * Depth here is lightness and a hairline, not a drop shadow — the same rule the
 * web follows, and on native it is worth restating because `elevation` is right
 * there in the API and every RN card in the world uses it. A card reads as
 * raised because it is two steps lighter than the canvas and has a 1px edge.
 * The shadow tokens exist for things that are genuinely *over* the page — a
 * sheet, a menu — and a feed row is not one of them.
 *
 * `interactive` is for a card that is itself a link. On the web the edge
 * brightens on hover; here it brightens on press, so the card acknowledges the
 * touch before the navigation lands.
 *
 * Border widths are 1 rather than `StyleSheet.hairlineWidth` deliberately: the
 * web draws these at 1px and the two clients are meant to be comparable side by
 * side, whereas a hairline is a third of that on a 3× screen and the elevation
 * ramp goes with it.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { rounded, useStyles, type Tokens } from "@/theme";

export interface CardProps extends ViewProps {
  /** Presses anywhere on the card. Adds the pressed edge treatment. */
  onPress?: () => void;
  interactive?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Card({ onPress, interactive = false, children, style, ...props }: CardProps) {
  const styles = useStyles(make);

  if (onPress || interactive) {
    return (
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
        {...props}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <View style={[styles.card, style]} {...props}>
      {children}
    </View>
  );
}

/** Padded band at the top of a card: avatar, name, timestamp. */
export function CardHeader({ children, style, ...props }: ViewProps) {
  const styles = useStyles(make);
  return (
    <View style={[styles.header, style]} {...props}>
      {children}
    </View>
  );
}

export function CardBody({ children, style, ...props }: ViewProps) {
  const styles = useStyles(make);
  return (
    <View style={[styles.body, style]} {...props}>
      {children}
    </View>
  );
}

/**
 * The action rail. Recessed onto `surface2` rather than merely ruled off: the
 * things in here — like, comment — are controls, and giving them their own
 * ground says so before anyone reads the labels.
 */
export function CardFooter({ children, style, ...props }: ViewProps) {
  const styles = useStyles(make);
  return (
    <View style={[styles.footer, style]} {...props}>
      {children}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    card: {
      // `hidden` on the web, and load-bearing for the same reason: cover art
      // runs to the card's edge and has to take its corners from it.
      overflow: "hidden",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
    },
    pressed: { borderColor: t.color.lineStrong },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    body: { paddingHorizontal: 16, paddingVertical: 16 },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderTopWidth: 1,
      borderTopColor: t.color.line,
      backgroundColor: t.color.surface2,
      paddingHorizontal: 8,
      paddingVertical: 6,
    },
  });
