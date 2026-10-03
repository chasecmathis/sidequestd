/**
 * Whether the reader has asked for less movement.
 *
 * The web honours this once, globally, through Motion's `reducedMotion="user"`
 * plus a CSS backstop. React Native has neither: `AccessibilityInfo` will tell
 * you, but nothing consults it on your behalf, so every animated component has
 * to ask.
 *
 * Subscribed rather than read once — the setting can be turned on while the app
 * is open, and a pulse that keeps pulsing until the next cold start is exactly
 * the kind of thing the preference exists to stop.
 */
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let active = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}
