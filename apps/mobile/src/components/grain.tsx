/**
 * Grain.
 *
 * The cheapest thing that stops a flat canvas from reading as "unstyled", and
 * the same layer the web puts over `body` — one tile of turbulence over
 * everything, touchable through. `pointerEvents="none"` is load-bearing, not
 * decorative: without it this view eats every tap in the app.
 *
 * Rendered last in the root layout so it sits over the navigator, and *inside*
 * the theme provider so its opacity can follow the mode. The two values differ
 * by more than they look — the same noise is roughly twice as loud on paper as
 * on near-black, which is why the tokens carry 3.5% and 2.2% rather than one
 * number. See `grain` in the tokens package.
 *
 * `resizeMode="repeat"` tiles the 160px source rather than stretching it; a
 * stretched noise tile is a blur, which is the one thing this layer must not be.
 *
 * Hidden from a screen reader on both platforms, which `pointerEvents` does not
 * do. VoiceOver's own reasons for visiting a view are not a finger's: an
 * undecorated full-screen image over the whole app is a plausible thing for it
 * to stop on and announce as "image", once, at the top of every screen. It is
 * the same treatment `ui/rule.tsx` and `ui/skeleton.tsx` already give — anything
 * that is texture rather than content says nothing.
 */
import { Image, StyleSheet, View } from "react-native";

import { useTokens } from "@/theme";

const TILE = require("../../assets/grain.png");

export function Grain() {
  const tokens = useTokens();

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, { opacity: tokens.grain }]}
    >
      <Image source={TILE} resizeMode="repeat" style={StyleSheet.absoluteFill} />
    </View>
  );
}
