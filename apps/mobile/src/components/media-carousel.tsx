/**
 * The media carousel from SPEC §6.3.
 *
 * The web is a CSS scroll-snap strip, which works with a trackpad, a swipe and
 * the keyboard without any of them being reimplemented. React Native has the
 * same thing built in — `pagingEnabled` on a horizontal `ScrollView` — so this
 * is the same idea with the same behaviour and no slideshow logic either side.
 *
 * Items that are still processing show their original: the upload succeeded and
 * the file is there; what is missing is the thumbnail. Hiding it would look like
 * the upload was lost, which is the one thing a reader who just posted must not
 * be told.
 *
 * **Video is a real player, not a poster.** The API never generates a thumbnail
 * for a clip (see `ReviewMediaItem`), so the poster-with-a-play-button shortcut
 * has nothing to show — it would be a grey rectangle. `expo-video` is the
 * platform's answer to the web's `<video controls>`; `contentFit: "contain"`
 * letterboxes it in black for the same reason the web sets `bg-black`, so bars
 * that match the page rather than the clip do not read as a broken layout.
 *
 * The dots are native-only. A scroll-snap strip on the web shows a sliver of the
 * next item at the edge of a wide column, which says "there is more"; at 390px
 * an item fills the width exactly and nothing says it. Two of ten photos is a
 * carousel a reader would never know to swipe.
 */
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from "react-native";

import { isProcessing, isVideo } from "@sidequestd/core";
import type { ReviewMediaItem } from "@sidequestd/api-types";

import { mediaUrl } from "@/lib/api";
import { rounded, useStyles, type Tokens } from "@/theme";

import { RemoteImage } from "./media";
import { Badge } from "./ui/badge";

function Clip({ item, title, active }: { item: ReviewMediaItem; title: string; active: boolean }) {
  const styles = useStyles(make);

  // The same development rewrite `RemoteImage` applies, and needed here for the
  // same reason: a clip is served from the API's machine, not from the phone.
  // `expo-video` is the one player of a remote asset that does not go through
  // that component.
  const player = useVideoPlayer(mediaUrl(item.url), (instance) => {
    // No autoplay and no loop: a clip inside somebody's review is content the
    // reader chose to open, not a background. Muted-autoplay would also be the
    // one thing in the app that makes noise without being asked.
    instance.loop = false;
  });

  // Swiping past a playing clip stops it. Without this the audio carries on
  // from behind the next photo, which sounds exactly like a bug.
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);

  return (
    <VideoView
      player={player}
      style={styles.fill}
      contentFit="contain"
      nativeControls
      accessibilityLabel={item.alt_text ?? `Clip attached to the review of ${title}`}
    />
  );
}

export function MediaCarousel({ items, title }: { items: ReviewMediaItem[]; title: string }) {
  const styles = useStyles(make);
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(0);

  if (items.length === 0) return null;

  function onLayout(event: LayoutChangeEvent) {
    setWidth(event.nativeEvent.layout.width);
  }

  return (
    <View onLayout={onLayout} accessibilityLabel="Media carousel">
      <View style={styles.frame}>
        {/* Nothing until the width is known: at zero every page is zero wide and
            the scroll view snaps to the first item for ever. One frame. */}
        {width > 0 ? (
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(event) =>
              setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
            }
          >
            {items.map((item, position) => (
              <View key={item.id} style={[styles.page, { width }]}>
                {isVideo(item) ? (
                  <Clip item={item} title={title} active={position === index} />
                ) : (
                  <RemoteImage
                    uri={item.url}
                    label={item.alt_text ?? `Photo attached to the review of ${title}`}
                    contentFit="contain"
                    style={styles.fill}
                  />
                )}

                {isProcessing(item) ? (
                  <Badge tone="overlay" style={styles.processing}>
                    Processing
                  </Badge>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>

      {items.length > 1 ? (
        <View
          style={styles.dots}
          accessible
          accessibilityLabel={`Item ${index + 1} of ${items.length}`}
        >
          {items.map((item, position) => (
            <View key={item.id} style={[styles.dot, position === index && styles.dotOn]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    frame: {
      width: "100%",
      // 16:9, as the web's `aspect-video` is. A 4:3 photo letterboxes inside it
      // rather than resizing the frame, so swiping a mixed carousel does not
      // move everything below it up and down.
      aspectRatio: 16 / 9,
      overflow: "hidden",
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface2,
    },
    page: { height: "100%" },
    fill: { width: "100%", height: "100%" },
    processing: { position: "absolute", left: 12, top: 12 },

    dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 12 },
    dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: t.color.line },
    dotOn: { backgroundColor: t.color.accent },
  });
