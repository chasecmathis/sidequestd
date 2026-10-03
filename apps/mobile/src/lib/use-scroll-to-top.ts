/**
 * Tap the tab you are already on to go back to the top.
 *
 * There is no web equivalent to port, because the web already has one: the
 * browser gives every page Home and Cmd-Up for free, and a long scroll is
 * escapable without the site doing anything. A phone has neither, so a reader
 * forty screens into Discover has only the flick, and the platform's answer —
 * the status-bar tap — hits the wrong scroll view as often as not once a screen
 * has more than one. Re-pressing the tab is the gesture everyone actually
 * reaches for, and the tab bar was already emitting the event for it.
 *
 * Two conditions, and the second is the one that is easy to get wrong:
 *
 *   - the press has to be on the tab you are *on*. `tabPress` is emitted for
 *     the pressed tab's own listeners, so a screen only ever hears its own
 *     press — but it hears it whether it was focused or not, and scrolling on
 *     the way *in* would silently throw away the position every other tab
 *     remembers.
 *   - it has to be the animated scroll. The jump is the same arrival and reads
 *     as a screen that swapped rather than one that travelled.
 */
import { useNavigation } from "expo-router";
import { useEffect, type RefObject } from "react";

/**
 * A `FlatList` or a `ScrollView`, by the one method each has for this. Both are
 * accepted because the read surfaces are split between them: the feed and the
 * follow lists virtualise, everything else scrolls a page.
 */
export type Scrollable =
  | { scrollToOffset: (options: { offset: number; animated?: boolean }) => void }
  | { scrollTo: (options: { y: number; animated?: boolean }) => void };

/**
 * `tabPress` is a bottom-tabs event, and `useNavigation()` is typed for the
 * navigator a screen is *declared* in — which for a route under `app/(tabs)/`
 * is a stack as far as the types are concerned. The cast is to the two methods
 * actually used; the listener simply never fires on a screen with no tab above
 * it, which is what makes it safe for `Screen` to do this unconditionally.
 */
interface TabAware {
  addListener: (event: "tabPress", listener: () => void) => () => void;
  isFocused: () => boolean;
}

export function useScrollToTop(ref: RefObject<Scrollable | null>) {
  const navigation = useNavigation() as unknown as TabAware;

  useEffect(() => {
    return navigation.addListener("tabPress", () => {
      if (!navigation.isFocused()) return;

      const target = ref.current;
      if (!target) return;

      if ("scrollToOffset" in target) target.scrollToOffset({ offset: 0, animated: true });
      else target.scrollTo({ y: 0, animated: true });
    });
  }, [navigation, ref]);
}
