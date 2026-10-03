/**
 * Corners.
 *
 * `radius` is shared with the web and says how *far* a corner is rounded.
 * Nothing in that package can say how it is *shaped*, because the two platforms
 * do not agree that there is a choice: CSS `border-radius` is a circular arc and
 * the property that would change it (`corner-shape`) is not something a shipping
 * browser can be asked for yet. React Native has had the choice since 0.71.
 *
 * The choice is worth taking. A circular corner meets its straight edge at an
 * abrupt change of curvature, which is the corner every framework draws and the
 * reason a rounded rectangle can look approximately right and still feel bought
 * rather than made. A continuous corner — the squircle every iOS icon, sheet and
 * alert is drawn with — eases the curvature in, and at the 14–24px this system
 * uses the difference is small, constant, and exactly the register the rest of
 * it is pitched in.
 *
 * So: every rounded rectangle in the app goes through here.
 *
 *   const make = (t: Tokens) =>
 *     StyleSheet.create({ card: { ...rounded(t.radius.lg), borderWidth: 1 } });
 *
 * **Two shapes stay circular, and neither is an oversight.** A capsule — a chip,
 * an avatar, a tag — is a semicircle at each end rather than a rounded corner,
 * and `continuous` on a radius that large distorts it into a lozenge; Apple's
 * own guidance carves out the same exception. And a 1px hairline with a 1px
 * radius has no curve to shape. Both are spelled as a plain `borderRadius` at
 * the call site, which is how you can tell one was decided rather than missed.
 */
import type { ViewStyle } from "react-native";

/** A rounded rectangle's corner: how far, and — the part the web cannot say — what shape. */
export function rounded(radius: number): Pick<ViewStyle, "borderRadius" | "borderCurve"> {
  return { borderRadius: radius, borderCurve: "continuous" };
}
