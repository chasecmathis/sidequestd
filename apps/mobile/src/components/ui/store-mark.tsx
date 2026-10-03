/**
 * A store's mark.
 *
 * The native half of the web's `ui/store-mark.tsx`, and the same division of
 * labour `StarGlyph` already uses: the path is `@sidequestd/core`'s, the element
 * around it is the platform's. Both clients draw Steam in three places between
 * them, and a rating and a logo are the two marks in this product that have to
 * be recognisably identical on a phone and in a browser.
 *
 * `color` is required rather than defaulting, because there is no `currentColor`
 * here to inherit from. The web gets one for free from the cascade; native has
 * no cascade, so every caller has to say — which is the same reason `<Text>` in
 * this app takes a tone.
 *
 * A source with no mark renders nothing, exactly as on the web. The label beside
 * it already names the store, and a placeholder box would read as a broken image
 * rather than as "we have no mark for this one".
 */
import Svg, { Path } from "react-native-svg";

import { storeMarkPath } from "@sidequestd/core";

export function StoreMark({
  source,
  size = 20,
  color,
}: {
  source: string;
  size?: number;
  color: string;
}) {
  const path = storeMarkPath(source);
  if (!path) return null;

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={path} fill={color} />
    </Svg>
  );
}
