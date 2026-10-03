/**
 * The chrome every signed-in surface sits in — `AppShell`, minus the parts the
 * tab bar took over.
 *
 * What is left of the web's header once navigation moves to the bottom is the
 * wordmark and the controls on the right, so that is what `AppBar` is. It does
 * not scroll away: the app bar is 56pt, the reader is never more than a thumb
 * from it, and a header that hides on scroll would take the only theme control
 * with it.
 *
 * `action` is the screen's one primary control, right-aligned beside the theme
 * toggle. On Home that is "Write a review" — a header button exactly as on the
 * web, rather than a centre floating action button, because five tabs is the
 * native ceiling and the design system already says at most one primary per
 * view.
 *
 * `back` is for the pushed routes — a game, a review, somebody's profile. Those
 * cover the tab bar, so the bar is the only way out of them that does not depend
 * on knowing the platform's edge-swipe. It replaces the wordmark rather than
 * joining it: at 390px an arrow, a mark, an action and a toggle is four things
 * competing for one row, and the mark is the one that is decoration here.
 *
 * `back="close"` is the same slot on a route the navigator presents as a modal —
 * the composers. A chevron there would be a lie about what pressing it does: a
 * modal is not behind anything, it is *over* everything, and the platform's own
 * word for leaving one is a cross in the corner you came in through.
 */
import { ChevronLeft, X } from "lucide-react-native";
import { router } from "expo-router";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRef, type ReactNode } from "react";

import { SCREEN_GUTTER } from "@/lib/layout";
import { useScrollToTop } from "@/lib/use-scroll-to-top";
import { useStyles, type Tokens } from "@/theme";

import { ThemeToggle } from "./theme-toggle";
import { IconButton } from "./ui/button";
import { Wordmark } from "./ui/wordmark";

/** `true` for a pushed route, `"close"` for one presented as a modal. */
export type BackKind = boolean | "close";

export function AppBar({ action, back = false }: { action?: ReactNode; back?: BackKind }) {
  const styles = useStyles(make);
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={[styles.barRow, back && styles.barRowBack]}>
        {back ? (
          <IconButton
            icon={back === "close" ? X : ChevronLeft}
            label={back === "close" ? "Close" : "Go back"}
            // `canGoBack` is false when the screen was opened from a deep link
            // or a notification — there is no stack behind it, and `back()`
            // would do nothing at all. Home is where the app starts, so it is
            // the honest destination for "out of here".
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          />
        ) : (
          <Wordmark />
        )}

        <View style={styles.barActions}>
          {action}
          <ThemeToggle />
        </View>
      </View>
    </View>
  );
}

/**
 * A scrolling screen with the app bar above it.
 *
 * `scroll={false}` for the surfaces that own their own scrolling — anything
 * built on a `FlatList`, which is every paged surface in the app. Nesting a list
 * inside a `ScrollView` is the native mistake that turns virtualisation off and
 * takes the feed's memory behaviour with it.
 */
export function Screen({
  action,
  back = false,
  scroll = true,
  contentStyle,
  children,
}: {
  action?: ReactNode;
  back?: BackKind;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const styles = useStyles(make);
  const bottom = useContentBottom(back);

  // Free for every screen that scrolls, and inert on the ones that cannot hear
  // the event — a pushed route has no tab above it to be re-pressed.
  const scroller = useRef<ScrollView>(null);
  useScrollToTop(scroller);

  return (
    <View style={styles.screen}>
      <AppBar action={action} back={back} />
      {scroll ? (
        <ScrollView
          ref={scroller}
          contentContainerStyle={[styles.content, { paddingBottom: bottom }, contentStyle]}
          keyboardShouldPersistTaps="handled"
          // The keyboard goes down when the reader starts scrolling, which is
          // what every native list does and what a form on a 390pt screen needs
          // more than most: the keyboard is half of it.
          keyboardDismissMode="on-drag"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, contentStyle]}>{children}</View>
      )}
    </View>
  );
}

/**
 * How much bottom padding a screen's content actually needs.
 *
 * Inside the tabs this is just the breathing room below the last line, because
 * the tab bar is laid out *below* the screen and owns the home-indicator inset
 * itself. A pushed route — a game, a review, somebody's profile — covers the tab
 * bar, and with it the only thing that was accounting for that inset, so the
 * last line of the longest screen in the app ends up under the indicator with
 * six points to spare. `back` is the honest signal for "this one covers the
 * bar", being the same fact the app bar already branches on.
 *
 * Exported because `scroll={false}` hands the scrolling to a `FlatList`, whose
 * padding has to go on its own `contentContainerStyle`.
 */
export function useContentBottom(back: BackKind): number {
  const insets = useSafeAreaInsets();
  return screenContent.paddingBottom + (back ? insets.bottom : 0);
}

/**
 * The padding a `Screen` puts on its own content, for the lists that cannot use
 * it.
 *
 * `scroll={false}` hands the scrolling to a `FlatList`, and a list's padding has
 * to go on its `contentContainerStyle` — put it on the list itself and the rows
 * are inset from a scrollbar track that is inset from the screen. Exported so
 * the feed and the follow lists are padded the same as everything else rather
 * than by four copies of the same numbers.
 */
// `satisfies` rather than an annotation: `ViewStyle` widens `paddingBottom` to
// the whole of `DimensionValue`, and `useContentBottom` has to add to it.
export const screenContent = {
  paddingHorizontal: SCREEN_GUTTER,
  paddingTop: 28,
  paddingBottom: 40,
} satisfies ViewStyle;

const make = (t: Tokens) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.color.canvas },
    flex: { flex: 1 },

    bar: { backgroundColor: t.color.canvas, borderBottomWidth: 1, borderBottomColor: t.color.line },
    barRow: {
      // A floor rather than a height. Nothing in this row scales far — the
      // wordmark is capped and the two controls are icons — but a screen's one
      // action is a `Button`, and past `LARGE_TEXT_SCALE` that button grows a
      // second line rather than truncating its label. The bar has to grow with
      // it or the thing it grew into is clipped by the bar instead.
      minHeight: 56,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingLeft: SCREEN_GUTTER,
      // Less on the right: the last thing there is an icon button, which carries
      // its own padding inside its 44pt square.
      paddingRight: 8,
    },
    // The back button is an icon button too, so the left gutter comes off for
    // the same reason the right one already has.
    barRowBack: { paddingLeft: 8 },
    barActions: { flexDirection: "row", alignItems: "center", gap: 4 },

    content: {
      ...screenContent,
      // The tab bar is laid out below this rather than over it, so the bottom
      // padding is breathing room at the end of a screen and not clearance.
      gap: 24,
    },
  });
