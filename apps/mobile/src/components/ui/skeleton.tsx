/**
 * Loading placeholders, in the shape of the thing that is coming.
 *
 * A skeleton is worth the code because it holds the layout still: the feed does
 * not jump a screen's height when the first page lands, which is the difference
 * between a screen that feels fast and one that feels broken.
 *
 * Every set is one `role="status"`-equivalent node carrying the real
 * announcement, with the rectangles themselves hidden. A screen reader should
 * hear "Loading your feed", not a description of twelve grey blocks —
 * `accessibilityElementsHidden` (iOS) and `importantForAccessibility` (Android)
 * are both needed to actually get that, since neither covers the other platform.
 */
import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";

import { useReducedMotion } from "@/lib/use-reduced-motion";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

/**
 * One pulsing block.
 *
 * Pulse rather than a sweeping gradient, which is the web's reasoning and holds
 * doubly here: at 3% grain a moving highlight reads as a rendering artefact, and
 * a gradient sweep on native needs a whole extra view type to draw.
 *
 * `useNativeDriver` keeps the animation off the JS thread, so it stays smooth
 * while the very request it is standing in for is being parsed.
 */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const reducedMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (reducedMotion) {
      pulse.setValue(0.7);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.45,
          duration: tokens.motion.duration.slow * 2,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: tokens.motion.duration.slow * 2,
          useNativeDriver: true,
        }),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [pulse, reducedMotion, tokens.motion.duration.slow]);

  return <Animated.View style={[styles.block, { opacity: pulse }, style]} />;
}

/** The announcement, and the wrapper that hides the blocks from a screen reader. */
function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {children}
    </View>
  );
}

/** One review card's silhouette: author row, wide media panel, rating, text. */
export function ReviewSkeleton() {
  const styles = useStyles(make);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Skeleton style={styles.avatar} />
        <View style={styles.headerLines}>
          <Skeleton style={{ height: 14, width: 128 }} />
          <Skeleton style={{ height: 12, width: 96 }} />
        </View>
      </View>

      <Skeleton style={styles.media} />

      <View style={styles.cardBody}>
        <Skeleton style={{ height: 16, width: 160 }} />
        <Skeleton style={{ height: 14, width: "100%" }} />
        <Skeleton style={{ height: 14, width: "80%" }} />
      </View>
    </View>
  );
}

export function FeedSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Loading label="Loading your feed">
      <View style={{ gap: 24 }}>
        {Array.from({ length: count }, (_, index) => (
          <ReviewSkeleton key={index} />
        ))}
      </View>
    </Loading>
  );
}

/**
 * Matches the game grid's columns, so nothing shifts when covers arrive.
 *
 * Two columns rather than the web's two-to-five: the grid is responsive there
 * and there is only one width here.
 */
export function GameGridSkeleton({
  count = 4,
  label = "Loading games",
}: {
  count?: number;
  label?: string;
}) {
  const styles = useStyles(make);

  return (
    <Loading label={label}>
      <View style={styles.grid}>
        {Array.from({ length: count }, (_, index) => (
          <View key={index} style={styles.gridCell}>
            <Skeleton style={styles.cover} />
            <View style={styles.gridLines}>
              <Skeleton style={{ height: 14, width: "80%" }} />
              <Skeleton style={{ height: 12, width: "50%" }} />
              {/* Title, year, then the score strip — the third line a real card
                  has, so the placeholder is the same height as what replaces it. */}
              <Skeleton style={{ height: 12, width: "33%" }} />
            </View>
          </View>
        ))}
      </View>
    </Loading>
  );
}

export function ProfileSkeleton() {
  const styles = useStyles(make);

  return (
    <Loading label="Loading profile">
      <View style={{ gap: 20, alignItems: "center" }}>
        <Skeleton style={styles.bigAvatar} />
        <View style={{ gap: 12, alignSelf: "stretch", alignItems: "center" }}>
          <Skeleton style={{ height: 32, width: 200 }} />
          <Skeleton style={{ height: 14, width: 140 }} />
          <Skeleton style={{ height: 14, width: "100%" }} />
        </View>
      </View>
    </Loading>
  );
}

/** A stack of rows: notifications, follow requests, search results. */
export function ListSkeleton({ count = 5, label = "Loading" }: { count?: number; label?: string }) {
  const styles = useStyles(make);

  return (
    <Loading label={label}>
      <View style={{ gap: 8 }}>
        {Array.from({ length: count }, (_, index) => (
          <View key={index} style={styles.row}>
            <Skeleton style={styles.avatar} />
            <View style={styles.headerLines}>
              <Skeleton style={{ height: 14, width: 144 }} />
              <Skeleton style={{ height: 12, width: 96 }} />
            </View>
          </View>
        ))}
      </View>
    </Loading>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    block: { ...rounded(t.radius.md), backgroundColor: t.color.surface2 },

    card: {
      overflow: "hidden",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
    },
    cardHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
    headerLines: { flex: 1, gap: 8 },
    avatar: { width: 40, height: 40, borderRadius: 20 },
    bigAvatar: { width: 112, height: 112, borderRadius: 56 },
    // 4:3, as the review media panel is.
    media: { width: "100%", aspectRatio: 4 / 3, borderRadius: 0 },
    cardBody: { gap: 12, padding: 16 },

    grid: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
    gridCell: {
      // Two columns with a 16px gutter: half the row, less half the gap.
      flexBasis: "47%",
      flexGrow: 1,
      overflow: "hidden",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
    },
    cover: { width: "100%", aspectRatio: 3 / 4, borderRadius: 0 },
    gridLines: { gap: 8, padding: 12 },

    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
  });
