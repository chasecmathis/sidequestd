/**
 * The one button in the app.
 *
 * Same four variants as the web's, for the same reasons:
 *   primary   — the one action a screen wants. Accent fill, ink text. At most
 *               one per view; two primaries mean neither is primary.
 *   secondary — everything else that is still an action. Hairline, no fill.
 *   ghost     — actions inside dense rows, where a border would be noise.
 *   danger    — destructive, and never the default focus of a screen.
 *
 * Two things differ from the web, and both are the platform rather than the
 * design.
 *
 * **Press replaces hover.** The web has `hover:` states doing real work — a
 * secondary button's border brightening, a ghost button gaining a ground — and
 * a touch screen has no hover at all. Those states move onto `pressed`, which
 * is why every variant below has a `-pressed` twin. The `active:translate-y-px`
 * nudge comes along too, because it is the one bit of the web's press feedback
 * that already meant "touch".
 *
 * **The heights are bigger.** The web's 32/40/48 become 36/44/52. A 32px control
 * is comfortable with a mouse and misses under a thumb; 44 is the platform floor
 * for anything a finger has to hit, and the small size only stays smaller than
 * that because it is never the only way to do something.
 *
 * **And those heights stop being heights when the reader's type is large.** This
 * is the one primitive where Dynamic Type and a fixed box genuinely collide: a
 * 44pt button holding a one-line 14pt label is a 44pt button holding "Write a…"
 * once the system scale is 2×, because the box cannot grow and the label was
 * told not to wrap. Neither half of that is acceptable — a truncated button is a
 * control nobody can identify, and clipped text is worse.
 *
 * So past `LARGE_TEXT_SCALE` the height becomes a *floor*, padding takes over,
 * and the label is allowed the second line it needs. Below it nothing changes at
 * all, which is the point: a button that wrapped its label at default size to be
 * safe would be paying every reader for a setting almost none of them use.
 */
import type { LucideIcon } from "lucide-react-native";
import {
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import type { ReactNode } from "react";

import { LARGE_TEXT_SCALE, rounded, text, useStyles, useTokens, type Tokens } from "@/theme";

import { Text } from "./text";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<PressableProps, "children" | "style"> {
  variant?: Variant;
  size?: Size;
  /** Drawn before the label, at the size the label is set in. */
  icon?: LucideIcon;
  /** A string is wrapped in the right `<Text>`; anything else is rendered as-is. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const SIZES: Record<Size, { height: number; paddingHorizontal: number; fontSize: number }> = {
  sm: { height: 36, paddingHorizontal: 12, fontSize: text.size.small },
  md: { height: 44, paddingHorizontal: 16, fontSize: text.size.body - 1 },
  lg: { height: 52, paddingHorizontal: 24, fontSize: text.size.body },
};

const ICON_SIZE: Record<Size, number> = { sm: 15, md: 16, lg: 17 };

export function Button({
  variant = "secondary",
  size = "md",
  icon: Icon,
  children,
  disabled,
  style,
  ...props
}: ButtonProps) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const metrics = SIZES[size];

  // `fontScale` is the system's text size, not the screen's — it changes while
  // the app is open, and `useWindowDimensions` re-renders when it does.
  const { fontScale } = useWindowDimensions();
  const grows = fontScale > LARGE_TEXT_SCALE;

  const box: ViewStyle = grows
    ? {
        minHeight: metrics.height,
        paddingHorizontal: metrics.paddingHorizontal,
        // Enough that a wrapped two-line label is not touching the border it
        // grew the box to reach.
        paddingVertical: 10,
      }
    : { height: metrics.height, paddingHorizontal: metrics.paddingHorizontal };

  const labelTone = variant === "primary" ? "ink" : variant === "danger" ? "danger" : "fg";
  const iconColor =
    variant === "primary"
      ? tokens.color.accentInk
      : variant === "danger"
        ? tokens.color.danger
        : variant === "ghost"
          ? tokens.color.fgDim
          : tokens.color.fg;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        box,
        styles[variant],
        pressed && styles[`${variant}Pressed` as const],
        pressed && styles.nudge,
        disabled && styles.disabled,
        style,
      ]}
      {...props}
    >
      {Icon ? (
        <Icon size={ICON_SIZE[size]} color={iconColor} strokeWidth={variant === "primary" ? 2 : 1.75} />
      ) : null}

      {typeof children === "string" ? (
        <Text
          size={metrics.fontSize}
          weight="medium"
          tone={labelTone}
          // One line while the box is a fixed height, and as many as it takes
          // once the box can grow. A truncated label on a control is the reader
          // being told there is a word they are not allowed to read.
          numberOfLines={grows ? undefined : 1}
          style={grows ? styles.labelWrapped : undefined}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

/**
 * A button that is only an icon.
 *
 * Square, so it does not inherit the horizontal padding, and it *requires* an
 * accessible label — an icon-only control with no name is a control a screen
 * reader announces as "button", which is no name at all.
 */
export function IconButton({
  icon: Icon,
  label,
  size = "md",
  variant = "ghost",
  disabled,
  style,
  ...props
}: Omit<ButtonProps, "children" | "icon"> & { icon: LucideIcon; label: string }) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const side = SIZES[size].height;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        { height: side, width: side },
        styles[variant],
        pressed && styles[`${variant}Pressed` as const],
        disabled && styles.disabled,
        style,
      ]}
      {...props}
    >
      <Icon
        size={ICON_SIZE[size] + 2}
        color={variant === "primary" ? tokens.color.accentInk : tokens.color.fgDim}
        strokeWidth={1.75}
      />
    </Pressable>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    // Only when the box has grown, and only then: a `flexShrink` on a label
    // inside a *fixed* row is what makes a one-line label ellipsise early, and
    // `numberOfLines={1}` is already handling that case.
    labelWrapped: { flexShrink: 1 },

    base: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      ...rounded(t.radius.md),
      borderWidth: 1,
      // Transparent rather than absent: a bordered and an unbordered variant
      // must be the same height, or a row of mixed buttons steps up and down.
      borderColor: "transparent",
    },
    nudge: { transform: [{ translateY: 1 }] },
    disabled: { opacity: 0.5 },

    primary: { backgroundColor: t.color.accent },
    primaryPressed: { backgroundColor: t.color.accentDim },

    secondary: { borderColor: t.color.line },
    secondaryPressed: { borderColor: t.color.lineStrong, backgroundColor: t.color.surface2 },

    ghost: {},
    ghostPressed: { backgroundColor: t.color.surface2 },

    danger: { borderColor: t.color.danger },
    // The web presses to `bg-danger/10`, an alpha the palette has no token for —
    // and inventing one here would be a colour that exists on one platform only.
    // `surface2` is the ground every other pressed variant uses, and against a
    // red border and red letters it reads as the same gesture.
    dangerPressed: { borderColor: t.color.danger, backgroundColor: t.color.surface2 },
  });

/** Rows of buttons, and the gap between them. Used by dialogs and card footers. */
export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={ROW}>{children}</View>;
}

const ROW: ViewStyle = { flexDirection: "row", alignItems: "center", gap: 8 };
