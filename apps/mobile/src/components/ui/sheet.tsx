/**
 * The web's `Dialog`, as the thing a phone actually has.
 *
 * It was deliberately left unbuilt through the read slice — a sheet built
 * against no screen is a sheet built against a guess — and it arrives now
 * because the write surfaces produced three callers at once: pick a game to pin,
 * pick a list to put a game on, pick where a photo comes from. All three are the
 * same shape, which is the shape a modal takes on a phone: a panel that comes up
 * from the bottom edge, over the screen the reader was already on, dismissed by
 * pressing away from it or by dragging it down.
 *
 * **A component rather than an Expo Router `formSheet` route.** A route-presented
 * sheet is the better answer when the sheet *is* a destination — it gets the
 * platform's own dismiss gesture, its own header, and a URL. These are not
 * destinations: each one hands a value back to the state of the screen
 * underneath (the game you picked, the list you chose), and routing that value
 * back through navigation params would replace three `useState` calls with a
 * global. `reviews/new` — which genuinely *is* a destination — is a route, and
 * is presented as a modal by the navigator.
 *
 * Five things that are the platform rather than the design:
 *
 *   - **`onRequestClose` is not optional.** It is what the Android back gesture
 *     fires. Without it the sheet is a trap on half the devices the app runs on.
 *   - **The panel pays the home-indicator inset itself.** A `Modal` is outside
 *     the navigator, so nothing below it is accounting for the inset the way the
 *     tab bar does for a tab screen.
 *   - **The keyboard.** Two of the three callers have a search field in them, so
 *     the panel lifts rather than letting the keyboard cover the field the sheet
 *     exists to offer. `padding` on iOS and nothing on Android, which is where
 *     the window resizes on its own.
 *   - **`accessibilityViewIsModal`.** Without it VoiceOver keeps walking into
 *     the screen *behind* the sheet — swipe past the last option and the reader
 *     is reading the game list they were on, with no indication they have left
 *     the panel and no way to tell that the thing under their finger is covered
 *     by it. It is the native half of what `role="dialog"` plus a focus trap does
 *     on the web, and it is one prop, on one view, that nothing on screen shows.
 *   - **The slide is the largest movement in the app, so it asks first.** A panel
 *     travelling the height of the screen is exactly what somebody who turned
 *     Reduce Motion on turned it on about. `animationType="fade"` rather than
 *     `"none"`: the sheet still has to *arrive* from somewhere, or an entire
 *     screen of new controls appears under a thumb with nothing to say it did.
 *
 * The scrim is a fixed token rather than a palette colour, for the same reason
 * the review tile's is: what is behind it is the reader's own screen, and it
 * cannot get lighter because the theme did.
 */
import { X } from "lucide-react-native";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useStyles, type Tokens } from "@/theme";

import { IconButton } from "./button";
import { Text } from "./text";

export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  contentStyle,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();

  return (
    <Modal
      visible={open}
      transparent
      animationType={reducedMotion ? "fade" : "slide"}
      // Android's hardware/gesture back. iOS routes its own dismissals through
      // the backdrop below.
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* The backdrop is a control, and it is named as one: a screen reader
          landing on an unlabelled full-screen button has no way to know that
          pressing it closes the panel it is in front of. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${title}`}
        onPress={onClose}
        style={styles.backdrop}
      />

      <KeyboardAvoidingView
        behavior={process.env.EXPO_OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
        style={styles.lift}
      >
        <View
          // Everything outside this view is unreachable to a screen reader for
          // as long as the sheet is up, which is what stops a swipe past the
          // last option from walking silently onto the covered screen behind it.
          accessibilityViewIsModal
          style={[styles.panel, { paddingBottom: insets.bottom }]}
        >
          {/* Not a real drag handle — the panel is not draggable, because a
              gesture-driven sheet is Reanimated and a gesture handler for one
              affordance. It is the visual grammar of one, which is what tells a
              reader this thing came from the bottom edge and goes back there. */}
          <View style={styles.grabber} />

          <View style={styles.head}>
            <View style={styles.heading}>
              <Text variant="display" size={22} accessibilityRole="header">
                {title}
              </Text>
              {description ? (
                <Text size={13} tone="dim" relaxed style={styles.description}>
                  {description}
                </Text>
              ) : null}
            </View>

            <IconButton icon={X} label={`Close ${title}`} onPress={onClose} />
          </View>

          <View style={[styles.content, contentStyle]}>{children}</View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * One choice in a sheet that is a list of them — a backlog list, a photo source.
 *
 * Full-bleed rows separated by hairlines rather than a stack of `Button`s: these
 * are a menu, and a menu of four bordered buttons is four competing controls
 * where the reader wants one column to run their thumb down.
 */
export function SheetOption({
  label,
  hint,
  selected = false,
  destructive = false,
  disabled = false,
  onPress,
}: {
  label: string;
  hint?: string;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles(make);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionOn,
        pressed && styles.optionPressed,
        disabled && styles.optionDisabled,
      ]}
    >
      <View style={styles.optionText}>
        <Text size={16} tone={destructive ? "danger" : "fg"} weight={selected ? "medium" : "regular"}>
          {label}
        </Text>
        {hint ? (
          <Text size={12} tone="faint" style={styles.optionHint}>
            {hint}
          </Text>
        ) : null}
      </View>

      {/* A dot rather than a tick: the accent as a fill is the palette's own
          rule, and a checkmark glyph beside a label is the one place a native
          list tends to reach for a colour it has no token for. */}
      {selected ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: t.color.scrim },
    lift: { flex: 1, justifyContent: "flex-end" },

    panel: {
      // Only the top corners: the panel is anchored to the bottom edge and a
      // radius down there would float it off the screen it came from.
      borderTopLeftRadius: t.radius.xl,
      borderTopRightRadius: t.radius.xl,
      borderCurve: "continuous",
      borderTopWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      // The one other place in the app a shadow earns its keep: this is
      // genuinely *over* the page rather than merely raised on it.
      ...t.elevation.pop,
      maxHeight: "85%",
    },

    grabber: {
      alignSelf: "center",
      width: 36,
      height: 5,
      // A capsule, so a plain radius rather than `rounded()` — see theme/shape.
      borderRadius: 999,
      backgroundColor: t.color.lineStrong,
      marginTop: 8,
    },

    head: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      paddingLeft: 20,
      paddingRight: 8,
      paddingTop: 14,
      paddingBottom: 14,
    },
    heading: { flex: 1, minWidth: 0 },
    description: { marginTop: 6 },

    content: { flexShrink: 1 },

    option: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderTopWidth: 1,
      borderTopColor: t.color.line,
      paddingHorizontal: 20,
      paddingVertical: 16,
    },
    optionOn: { backgroundColor: t.color.surface2 },
    optionPressed: { backgroundColor: t.color.surface2 },
    optionDisabled: { opacity: 0.5 },
    optionText: { flex: 1, minWidth: 0 },
    optionHint: { marginTop: 4 },

    dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: t.color.accent },
  });
