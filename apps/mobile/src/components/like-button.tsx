/**
 * The like control from SPEC §6.10.
 *
 * Optimistic and then server-authoritative, exactly as on the web: the heart
 * fills on press and the count moves with it, and the response — which carries
 * the true count, including likes other people added since the screen loaded —
 * replaces both. A failure puts the heart back rather than leaving a reader
 * believing they liked something they did not.
 *
 * Signed out there is nothing to press, so the count renders as plain text. A
 * heart that only ever produces "sign in first" is a worse invitation than the
 * one the app already makes when a gated screen redirects.
 *
 * **The pop is RN's own `Animated`, not Motion and not Reanimated.** The web
 * runs three keyframes through Motion — rest, overshoot, rest — with the
 * overshoot early so it reads as a snap. `Animated.sequence` of two timings says
 * the same thing with the same asymmetry, on the native driver, and a scale is
 * one of the four properties that driver can carry off the JS thread. It is
 * keyed on the liked *state* rather than on the press, so it fires for the
 * optimistic fill and again if the server disagrees and it un-fills — the
 * animation follows the truth, not the gesture.
 */
import { Heart } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";

import {
  likeActionLabel,
  likeCountLabel,
  likeRequest,
  optimisticLike,
  useAuth,
} from "@sidequestd/core";
import type { ReviewInteractions } from "@sidequestd/api-types";

import { selectionTick } from "@/lib/haptics";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

import { EyebrowText } from "./ui/text";

/** How far the heart overshoots. The web's 1.35. */
const POP_SCALE = 1.35;

export function LikeButton({
  interactions,
  onChange,
}: {
  interactions: ReviewInteractions;
  onChange?: (result: ReviewInteractions) => void;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const reducedMotion = useReducedMotion();

  const { authedRequest, user } = useAuth();
  const [current, setCurrent] = useState(interactions);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scale = useRef(new Animated.Value(1)).current;

  // Depending on the fields rather than the object, for the web's reason: the
  // parent builds a fresh one every render, so `[interactions]` would re-sync on
  // every pass — undoing the optimistic state, and looping, because the reset is
  // itself a render. `review_id` changing is what stops the previous review's
  // answer staying on screen.
  const { review_id, like_count, comment_count, viewer_has_liked } = interactions;
  useEffect(() => {
    setCurrent({ review_id, like_count, comment_count, viewer_has_liked });
    setError(null);
  }, [review_id, like_count, comment_count, viewer_has_liked]);

  const liked = current.viewer_has_liked;

  // The `mounted` ref is what keeps this from popping on arrival: without it
  // every heart in a feed would animate as its row scrolled into view, which is
  // the same movement meaning something entirely different.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!liked || reducedMotion) return;

    Animated.sequence([
      Animated.timing(scale, {
        toValue: POP_SCALE,
        duration: tokens.motion.duration.fast,
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: tokens.motion.duration.base,
        useNativeDriver: true,
      }),
    ]).start();
  }, [liked, reducedMotion, scale, tokens.motion.duration]);

  async function press() {
    const before = current;

    // On the press rather than on the response: this is a value changing under
    // the finger, and feedback that waits for a round trip has stopped being
    // feedback about the gesture.
    selectionTick();
    setPending(true);
    setError(null);
    setCurrent(optimisticLike(before));

    try {
      const { path, method } = likeRequest(before.viewer_has_liked, before.review_id);
      const result = await authedRequest<ReviewInteractions>(path, { method });
      setCurrent(result);
      onChange?.(result);
    } catch (cause) {
      setCurrent(before);
      setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (!user) {
    return (
      <View style={styles.count}>
        <Heart size={16} strokeWidth={1.75} color={tokens.color.fgFaint} />
        <EyebrowText tone="faint" style={styles.tabular}>
          {likeCountLabel(current.like_count)}
        </EyebrowText>
      </View>
    );
  }

  return (
    <View style={styles.column}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: liked, disabled: pending }}
        accessibilityLabel={likeActionLabel(liked)}
        disabled={pending}
        onPress={() => void press()}
        style={({ pressed }) => [styles.button, pressed && styles.pressed, pending && styles.busy]}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <Heart
            size={16}
            strokeWidth={1.75}
            // The accent rather than the conventional red: the heart is *filled*
            // when liked, which is the palette's sanctioned use of the accent,
            // and red here would be the colour this control uses to report a
            // failure a line below itself.
            color={liked ? tokens.color.accent : tokens.color.fgFaint}
            fill={liked ? tokens.color.accent : "transparent"}
          />
        </Animated.View>

        <EyebrowText tone={liked ? "accent" : "faint"} style={styles.tabular}>
          {likeCountLabel(current.like_count)}
        </EyebrowText>
      </Pressable>

      {error ? (
        <EyebrowText
          tone="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.error}
        >
          {error}
        </EyebrowText>
      ) : null}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    column: { alignItems: "flex-start" },

    button: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      ...rounded(t.radius.md),
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    pressed: { backgroundColor: t.color.surface },
    busy: { opacity: 0.6 },

    // The signed-out spelling, at the same metrics so a footer does not change
    // height when a reader signs in.
    count: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 8 },

    tabular: { fontVariant: ["tabular-nums"] },
    error: { paddingHorizontal: 10, paddingBottom: 4 },
  });
