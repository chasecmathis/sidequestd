/**
 * The logomark: a sword through a quest card.
 *
 * The same drawing as the app icon, the splash screen and the notification
 * silhouette — not a copy of it. The geometry lives in
 * `@sidequestd/design-tokens`, which is also what the raster generator reads,
 * so the mark in the app bar cannot drift from the one on the home screen.
 * Same arrangement as `StoreMark` and `STAR_PATH`: shared path data, and the
 * `<Svg>` element — the half with no web equivalent — left to each client.
 *
 * Sized by height alone; the viewBox's aspect ratio supplies the width. There
 * is no `accessibilityLabel` because every place this appears it sits beside
 * the name it is a picture of, and `Wordmark` names the pair.
 */
import Svg, { Path } from "react-native-svg";

import { BLADE, STROKES, VIEW_BOX } from "@sidequestd/design-tokens";

import { useTokens } from "@/theme";

export function Logomark({ height, color }: { height: number; color?: string }) {
  const tokens = useTokens();
  const ink = color ?? tokens.color.accent;

  return (
    <Svg
      width={(height * VIEW_BOX.width) / VIEW_BOX.height}
      height={height}
      viewBox={`0 0 ${VIEW_BOX.width} ${VIEW_BOX.height}`}
    >
      {STROKES.map((stroke) => (
        <Path
          key={stroke.d}
          d={stroke.d}
          fill="none"
          stroke={ink}
          strokeWidth={stroke.width}
          strokeLinecap={stroke.cap}
          strokeLinejoin="round"
        />
      ))}
      {/* `fillRule` is what makes the blade's fuller a hole rather than a second
          shape drawn over it — see BLADE. */}
      <Path d={BLADE.d} fill={ink} fillRule={BLADE.fillRule} />
    </Svg>
  );
}
