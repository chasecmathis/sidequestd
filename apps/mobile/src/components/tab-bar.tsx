/**
 * The bottom bar.
 *
 * A custom bar rather than the navigator's own, because the default draws a
 * shadowed, blurred, rounded bar with sans-serif labels — the standard-issue
 * chrome this design system exists to not look like. What is here is the web's
 * mobile nav, which is already a bottom bar under `md`: a hairline, the canvas
 * colour, five icons, and one orchid rule marking where you are.
 *
 * **Icons without labels**, as on the web at 390px. The label is on the tab as
 * its accessible name, so nothing is lost to a screen reader; what is avoided is
 * five mono-caps labels at 11px with 0.12em tracking, which is the point where
 * the eyebrow face stops being a signature and starts being a compromise.
 *
 * **The indicator slides.** On the web it is Motion tweening a shared `layoutId`
 * between tabs, so the nav shows where you came from as well as where you are.
 * The native equivalent is one absolutely-positioned rule with a spring on its
 * translation — same idea, same spring constants, no layout animation needed
 * because the only thing that moves is a rectangle along one axis.
 *
 * **The unread count rides on the Notifications icon.** The web sets it beside
 * the word, where there is a word to set it beside; five unlabelled icons have
 * no such place, so it becomes the pill every phone puts at a tab's top-right.
 * It is the one thing in the bar allowed to be accent-filled — a count the
 * reader is meant to act on is precisely what the palette spends the accent on —
 * and it is `badgeLabel`, shared with the web, that decides it says "99+".
 */
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { badgeAriaLabel, badgeLabel, NOTIFICATIONS_PATH, useNotifications } from "@sidequestd/core";

import { selectionTick } from "@/lib/haptics";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { TABS } from "@/navigation";
import { CHROME_SCALE_CAP, useStyles, useTokens, type Tokens } from "@/theme";

import { EyebrowText } from "./ui/text";

/** The web's `inset-x-3` on the indicator: 12px of clearance at each end. */
const INDICATOR_INSET = 12;

/**
 * Which tab the badge belongs to, derived rather than named.
 *
 * `NOTIFICATIONS_PATH` is `/notifications` and the route file is
 * `app/(tabs)/notifications.tsx`, so the tab's name is the path without its
 * slash — which is the same correspondence every other route in this app
 * relies on, said once instead of as a second literal that could drift.
 */
const BADGED_TAB = NOTIFICATIONS_PATH.slice(1);

export function TabBar({ state, navigation }: BottomTabBarProps) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const { unreadCount } = useNotifications();

  const [barWidth, setBarWidth] = useState(0);
  const tabWidth = barWidth / state.routes.length;
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!tabWidth) return;
    const target = state.index * tabWidth;

    // No spring under reduced motion: the indicator still moves, it just arrives
    // rather than travels.
    if (reducedMotion) {
      slide.setValue(target);
      return;
    }

    Animated.spring(slide, {
      toValue: target,
      stiffness: 420,
      damping: 38,
      mass: 1,
      useNativeDriver: true,
    }).start();
  }, [reducedMotion, slide, state.index, tabWidth]);

  return (
    <View
      // The bar owns the home-indicator inset rather than the screen: content
      // scrolls under it, and the icons have to clear the gesture area.
      style={[styles.bar, { paddingBottom: insets.bottom }]}
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
    >
      {tabWidth > 0 ? (
        <Animated.View
          style={[
            styles.indicator,
            { width: tabWidth - INDICATOR_INSET * 2, transform: [{ translateX: slide }] },
          ]}
        />
      ) : null}

      {state.routes.map((route, index) => {
        const tab = TABS.find((item) => item.name === route.name);
        if (!tab) return null;

        const focused = state.index === index;
        const Icon = tab.icon;
        const badge = tab.name === BADGED_TAB ? badgeLabel(unreadCount) : null;

        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            // The count has to be *in* the name, not a second element beside it:
            // a screen reader walking the bar announces the tab, and a badge it
            // has to find separately is a badge nobody hears.
            accessibilityLabel={badge ? badgeAriaLabel(unreadCount) : tab.label}
            onPress={() => {
              // Emitted for every press, including a press of the tab already
              // showing — that is the event `useScrollToTop` listens for, and
              // it is what makes "tap the tab you are on to go back to the top"
              // work. Every native app does it and nobody notices until it is
              // missing.
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                // Only when the selection actually changes. Re-pressing the
                // current tab scrolls, which is visible enough to not also
                // need announcing.
                selectionTick();
                navigation.navigate(route.name, route.params);
              }
            }}
            style={styles.tab}
          >
            <Icon
              size={22}
              strokeWidth={focused ? 2 : 1.75}
              color={focused ? tokens.color.fg : tokens.color.fgFaint}
            />

            {/* Hidden from the reader that already heard it in the tab's name
                above, so VoiceOver does not say the number twice. */}
            {badge ? (
              <View
                style={styles.badge}
                importantForAccessibility="no-hide-descendants"
                accessibilityElementsHidden
              >
                {/* One of the two capped things in the app — see
                    `CHROME_SCALE_CAP`. This capsule is 18pt and is positioned
                    off the shoulder of the icon, so it has nowhere to grow, and
                    the number in it is already announced in the tab's own
                    accessible name for anybody who cannot read it at this
                    size. */}
                <EyebrowText
                  tone="ink"
                  maxFontSizeMultiplier={CHROME_SCALE_CAP}
                  style={styles.badgeText}
                >
                  {badge}
                </EyebrowText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "stretch",
      // Opaque, not blurred — the same call the web's header makes. A blur here
      // would put a translucent grey between the canvas and the grain, and the
      // solid bar is the more editorial of the two.
      backgroundColor: t.color.canvas,
      borderTopWidth: 1,
      borderTopColor: t.color.line,
    },
    tab: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      // 52 rather than 44: the bar is the app's most-pressed control and it is
      // at the very bottom of the reach arc.
      height: 52,
    },
    // A capsule, so it is a plain `borderRadius` rather than a `rounded()` —
    // the one shape in the system that is deliberately circular at the corners
    // rather than continuous. `theme/shape.ts` has the distinction.
    badge: {
      position: "absolute",
      // Measured off the 22pt icon at the centre of a 52pt row: this sits on
      // its top-right shoulder, overlapping it slightly, which is where every
      // platform draws one.
      top: 8,
      left: "50%",
      marginLeft: 4,
      minWidth: 18,
      height: 18,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 5,
      borderRadius: 9,
      backgroundColor: t.color.accent,
    },
    // The eyebrow face at its own 11px, with the tracking taken back off: at
    // two characters inside 18pt, letter-spacing is what pushes a "12" off
    // centre.
    badgeText: { letterSpacing: 0, lineHeight: 18 },

    indicator: {
      position: "absolute",
      top: 0,
      // The inset lives here so the animated value stays a plain
      // `index × tabWidth` and can be driven natively without arithmetic.
      left: INDICATOR_INSET,
      height: 2,
      borderRadius: 1,
      backgroundColor: t.color.accent,
    },
  });
