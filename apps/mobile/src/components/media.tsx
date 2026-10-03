/**
 * Everything that puts a photograph on the screen.
 *
 * The web reaches for `next/image` two dozen times and gets caching, decoding
 * and a placeholder from the framework. `expo-image` is the native equivalent
 * and is wrapped once here rather than imported everywhere, because three of the
 * decisions around it are the same every time and one of them is easy to get
 * wrong.
 *
 *   - **The ground under the image.** Cover art is portrait, tiles are square,
 *     and the two disagree — so every remote image sits on `surface2`, which is
 *     what the reader sees while it decodes and wherever it does not fill.
 *   - **The fade in.** `transition` is `expo-image`'s own crossfade, at the
 *     motion token's `base`. Without it a scrolling feed pops each cover in,
 *     which reads as jank rather than as loading.
 *   - **`recyclingKey`.** The one that bites. `FlatList` reuses row views, so a
 *     recycled `<Image>` keeps showing the *previous* row's cover until the new
 *     URI decodes — a feed that scrolls past a dozen wrong covers. Keying on the
 *     URI tells `expo-image` the view is now a different image and to blank it.
 *   - **`mediaUrl`.** In development the API points at its own machine's MinIO,
 *     on `localhost:9000`, which on a phone is the phone. This is the one place
 *     that gets fixed, because it is the one place a remote image is built —
 *     see `lib/api.ts` for the whole of the reasoning, and note that the
 *     `recyclingKey` takes the rewritten URI too, since two images that differ
 *     only by host must not be treated as one.
 *
 * `Scrim` is the other half of this file and is the one place `OverMedia` is
 * mandatory: it is a gradient over artwork, and everything inside it has to stop
 * following the theme. See `toMedia` in `theme/tokens.ts`.
 */
import { Image } from "expo-image";
import { ImageOff } from "lucide-react-native";
import {
  StyleSheet,
  View,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import type { ReactNode } from "react";

import { mediaUrl } from "@/lib/api";
import { OverMedia, useStyles, useTokens, type Tokens } from "@/theme";

import { EyebrowText } from "./ui/text";

export function RemoteImage({
  uri,
  /**
   * Required, and not optional the way `alt` effectively is on the web.
   *
   * Native has no equivalent of `alt=""` meaning "decorative" — an image with no
   * label is announced as "image", which is worse than silence. Callers that
   * genuinely have nothing to say pass `decorative` instead.
   */
  label,
  contentFit = "cover",
  style,
}: {
  uri: string;
  label: string | null;
  contentFit?: "cover" | "contain";
  /**
   * An image style, not a view style. `overflow: "scroll"` is the difference —
   * a `View` has it and an image cannot, so the two are not interchangeable
   * even though every value a caller here passes is in both.
   */
  style?: StyleProp<ImageStyle>;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();

  const source = mediaUrl(uri);

  return (
    <Image
      source={{ uri: source }}
      recyclingKey={source}
      contentFit={contentFit}
      transition={tokens.motion.duration.base}
      accessible={label !== null}
      accessibilityRole="image"
      accessibilityLabel={label ?? undefined}
      // Hidden outright when there is nothing to say, rather than left unnamed:
      // the two are the same to a sighted reader and opposites to a screen
      // reader, which either skips it or stops on "image".
      accessibilityElementsHidden={label === null}
      importantForAccessibility={label === null ? "no-hide-descendants" : "auto"}
      style={[styles.image, style]}
    />
  );
}

/**
 * What a missing cover looks like.
 *
 * The web writes this inline in three components with the same icon, the same
 * stroke weight and the same two words. One of them had drifted to a different
 * icon size, which is how this ended up a component.
 */
export function NoCover({ compact = false }: { compact?: boolean }) {
  const styles = useStyles(make);
  const tokens = useTokens();

  return (
    <View style={styles.noCover}>
      <ImageOff size={compact ? 18 : 22} strokeWidth={1.25} color={tokens.color.fgFaint} />
      {compact ? null : <EyebrowText tone="faint">No cover art</EyebrowText>}
    </View>
  );
}

/**
 * Box art, at its own aspect ratio, with the fallback already decided.
 *
 * 3:4 everywhere — a grid cell, a favourite slot, the detail page's large one —
 * because it is the ratio the covers themselves are, and a shelf of boxes only
 * reads as a shelf if the boxes are the same shape.
 *
 * Deliberately draws no border and no radius. Every caller clips it with
 * something of its own: a card's `overflow: hidden`, a tile's corners. A cover
 * with its own edge inside a card that has one is two hairlines a pixel apart.
 */
export function Cover({
  uri,
  title,
  compact = false,
  style,
}: {
  uri: string | null | undefined;
  title: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);

  return (
    <View style={[styles.cover, style]}>
      {uri ? (
        <RemoteImage uri={uri} label={`${title} cover art`} style={StyleSheet.absoluteFill} />
      ) : (
        <NoCover compact={compact} />
      )}
    </View>
  );
}

/**
 * The fade at the foot of a piece of artwork, and the palette that belongs on it.
 *
 * **This is permanent, where the web's is on hover.** A review tile shows its
 * rating in a scrim that the web reveals with `group-hover:opacity-100`; a touch
 * screen has no hover, so the same rule would make the rating unreachable rather
 * than uncluttered. It stays up, and the gradient is what keeps a row of stars
 * legible over whatever the screenshot happens to be.
 *
 * Which makes the `OverMedia` wrapper load-bearing rather than tidy. Inside it a
 * light-theme `StarRating` would paint its filled stars in the paper palette's
 * dark amber and its empty ones in a mid grey — the rating reads *inverted*
 * against the black. The provider pins those four roles; see the tokens package.
 *
 * Drawn as SVG stops rather than as stacked translucent views, because a
 * two-view approximation of a gradient has a visible seam at exactly the height
 * the type sits at.
 */
export function Scrim({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(make);
  const tokens = useTokens();

  return (
    <View style={[styles.scrim, style]} pointerEvents="box-none">
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          {/* Bottom to top: `y1` is the foot of the box. `t.scrim` and not
              `color.scrim` — a stop ignores its colour's alpha and takes it from
              `stopOpacity`, so the rgba token would paint a solid black bar. */}
          <LinearGradient id="media-scrim" x1="0" y1="1" x2="0" y2="0">
            <Stop offset="0" stopColor={tokens.scrim.color} stopOpacity={tokens.scrim.opacity} />
            <Stop offset="1" stopColor={tokens.scrim.color} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#media-scrim)" />
      </Svg>

      <OverMedia>{children}</OverMedia>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    image: { backgroundColor: t.color.surface2 },

    cover: {
      width: "100%",
      aspectRatio: 3 / 4,
      overflow: "hidden",
      backgroundColor: t.color.surface2,
    },

    noCover: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 8 },

    scrim: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      // Top-heavy: the gradient needs room to reach nothing above the type, or
      // it ends in a band rather than a fade. 20 rather than the web's 32,
      // because the only thing wearing one of these is a 114pt grid tile and a
      // scrim half its height stops being a scrim.
      paddingTop: 20,
      paddingBottom: 8,
      paddingHorizontal: 8,
    },
  });
