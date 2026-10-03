/**
 * Touch feedback.
 *
 * The one thing in this client that has no counterpart on the web at all. Every
 * other native decision so far has been a translation — `onPress` for `onClick`,
 * a `FlatList` for an `IntersectionObserver`, a bottom bar for a top one. This
 * is the opposite: a channel the phone has and the browser does not, which a
 * port therefore arrives with none of, and whose absence is most of why a
 * competent React Native app can still feel like a website in a frame.
 *
 * **Selection, not applause.** The taps below fire on the two gestures that
 * change what is on screen without moving the reader anywhere — a facet going
 * on, a sort switching, a tab lighting up — plus the one gesture that commits
 * (pull to refresh). Navigation deliberately gets nothing: iOS does not buzz
 * when you push a screen, and an app that does reads as nervous. The rule is the
 * design system's own rule about the accent, in another sense: spend it rarely
 * and it means something.
 *
 * **iOS only**, which is Expo's own guidance and not squeamishness. Android's
 * haptic vocabulary is one general-purpose vibration rather than a Taptic
 * Engine's, its behaviour varies by manufacturer, and on a device with a coarse
 * motor a selection tick on every chip is a rattle. Android already speaks
 * through the platform's own touch feedback; this adds nothing there.
 *
 * `process.env.EXPO_OS` rather than `Platform.OS`: it is inlined at build time,
 * so the Android bundle drops these calls instead of branching past them.
 */
import * as Haptics from "expo-haptics";

const ios = process.env.EXPO_OS === "ios";

/**
 * A value changed under the finger — a chip toggled, a segment switched, a tab
 * selected. The lightest tick the engine has.
 *
 * Every call is fire-and-forget. A failed haptic is not an error worth handling:
 * the reader is holding a phone whose motor is busy, or off, or absent, and the
 * control they pressed has already done its actual job.
 */
export function selectionTick() {
  if (ios) void Haptics.selectionAsync().catch(() => {});
}

/**
 * A gesture committed to something — the feed pulled far enough to refresh.
 * Heavier than a selection because it marks a request going out, not a value
 * changing.
 */
export function commitTap() {
  if (ios) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
