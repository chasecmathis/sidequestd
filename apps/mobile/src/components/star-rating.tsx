/**
 * The five-star, half-star rating from SPEC §6.3.
 *
 * Values are the stored 1-10 integer throughout; the halving happens only at the
 * edge, in `starFill`. A star is two layers — a hollow one and a filled one
 * clipped to a percentage — which is what makes a half-star a width rather than
 * a third glyph.
 *
 * `STAR_PATH` comes from `@sidequestd/core` rather than being copied here. A
 * rating is the one mark in the product that has to be recognisably identical on
 * both clients, and two hand-copied path strings is how that stops being true.
 * The web feeds it to an inline `<svg>`; this feeds it to `react-native-svg`.
 * Same 24×24 viewbox, same geometry.
 *
 * The clip is an `overflow: hidden` view at a percentage width, which is exactly
 * what the web does with a `<span>`. It is worth saying that the *whole* star is
 * drawn inside it and cut off, rather than the path being scaled: a half star
 * has to be the left half of a five-pointed star, not a small one.
 */
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";

import { formatStars, MAX_RATING, MIN_RATING, STAR_PATH, starFill } from "@sidequestd/core";

import { selectionTick } from "@/lib/haptics";
import { useTokens, type Tokens } from "@/theme";

import { EyebrowText } from "./ui/text";

const STARS = [0, 1, 2, 3, 4];

/** The ten values a rating can take, in the 1-10 the API stores. */
const STOPS = Array.from({ length: MAX_RATING - MIN_RATING + 1 }, (_, index) => index + MIN_RATING);

/** The gap the web sets as `0.1em`, resolved against the star's own size. */
const GAP_RATIO = 0.1;

function Glyph({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={STAR_PATH} fill={color} />
    </Svg>
  );
}

function Star({ fill, size, tokens }: { fill: number; size: number; tokens: Tokens }) {
  return (
    <View style={{ width: size, height: size }}>
      <Glyph size={size} color={tokens.color.lineStrong} />

      {/* Nothing at all at zero. An empty clipped view is harmless on iOS and on
          Android draws a 0-width layer that still rounds up to a hairline of
          amber down the star's left edge. */}
      {fill > 0 ? (
        <View style={[StyleSheet.absoluteFill, { width: size * fill, overflow: "hidden" }]}>
          <Glyph size={size} color={tokens.color.star} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * One solid star, for a line too small to carry the whole row.
 *
 * The card's score strip marks a rating with this rather than with "★", for the
 * reason `STAR_PATH` exists — the glyph is a font fallback away from rendering
 * as a colour emoji, which makes the amber meaningless. Same path at full fill,
 * so there is still one amber star in the app.
 */
export function StarGlyph({ size = 11 }: { size?: number }) {
  const tokens = useTokens();
  return <Star fill={1} size={size} tokens={tokens} />;
}

/**
 * Read-only display. The numeric value is the accessible name.
 *
 * One accessible node wrapping all five, not five: a screen reader should hear
 * "3.5 out of 5 stars" once, rather than five unlabelled images.
 */
export function StarRating({
  rating,
  size = 18,
  style,
}: {
  rating: number;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const tokens = useTokens();

  return (
    <View
      accessible
      accessibilityLabel={`${formatStars(rating)} out of 5 stars`}
      style={[ROW, { gap: size * GAP_RATIO }, style]}
    >
      {STARS.map((index) => (
        <Star key={index} fill={starFill(rating, index)} size={size} tokens={tokens} />
      ))}
    </View>
  );
}

/**
 * The input: ten stops laid over five stars.
 *
 * The web spells this as a radio group, and so does this — `radio` and
 * `checked` are real native accessibility roles, and they are what make "3.5 out
 * of 5 stars" reachable one value at a time instead of a picture somebody has to
 * guess at.
 *
 * **It is drawn much larger than the web's.** There the stars are 32px and each
 * half is a 16px click target, which is fine for a cursor that lands where it
 * was pointed. A half of a 32pt star is 16pt of thumb, which is a third of the
 * platform's floor — so the stars are 44 here, making each half 22×44. That is
 * still under the floor in one axis, and is the same compromise every rating
 * control on the platform makes: the neighbours are all the same target, so a
 * near miss lands one half-star away rather than on nothing. It is also why the
 * value is written out beside them — the readout is how a reader confirms they
 * got the half they meant without having to count.
 *
 * The tick is a selection, which is exactly what `lib/haptics.ts` says one is
 * for: a value changing under the finger, with the reader staying put.
 */
export function StarRatingInput({
  value,
  onChange,
  size = 44,
  disabled = false,
}: {
  value: number | null;
  onChange: (rating: number) => void;
  size?: number;
  disabled?: boolean;
}) {
  const tokens = useTokens();

  return (
    <View style={INPUT_ROW}>
      <View accessibilityRole="radiogroup" accessibilityLabel="Rating" style={[ROW, { gap: 2 }]}>
        {STARS.map((index) => (
          <View key={index} style={{ width: size, height: size }}>
            <Star fill={value === null ? 0 : starFill(value, index)} size={size} tokens={tokens} />

            {/* Two invisible halves over the star that was just drawn. The
                alternative — a pressable per whole star with a left/right
                branch on the touch's x — cannot be announced as two values, and
                a rating a screen reader can only set to whole numbers is a
                rating half the scale is unreachable in. */}
            {STOPS.slice(index * 2, index * 2 + 2).map((stop, half) => (
              <Pressable
                key={stop}
                accessibilityRole="radio"
                accessibilityState={{ checked: value === stop, disabled }}
                accessibilityLabel={`${stop / 2} out of 5 stars`}
                disabled={disabled}
                onPress={() => {
                  selectionTick();
                  onChange(stop);
                }}
                // Vertical only: horizontal slop would overlap the neighbouring
                // half and make the boundary between 3.5 and 4 a coin toss.
                hitSlop={{ top: 8, bottom: 8 }}
                style={[styles.half, { width: size / 2, left: half === 0 ? 0 : size / 2 }]}
              />
            ))}
          </View>
        ))}
      </View>

      <EyebrowText tone="dim" style={styles.readout}>
        {value === null ? "Not rated" : `${formatStars(value)} / 5`}
      </EyebrowText>
    </View>
  );
}

const ROW: ViewStyle = { flexDirection: "row", alignItems: "center", flexShrink: 0 };

const INPUT_ROW: ViewStyle = {
  flexDirection: "row",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 16,
};

const styles = StyleSheet.create({
  half: { position: "absolute", top: 0, bottom: 0 },
  readout: { fontVariant: ["tabular-nums"] },
});
