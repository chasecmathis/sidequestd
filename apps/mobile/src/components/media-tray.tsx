/**
 * What is attached to a review, and the two ways to attach more.
 *
 * Shared by the two composers — a new review stages files locally and uploads
 * them once the review exists, an edit uploads each one as it is chosen — which
 * differ in what `onRemove` does and in nothing this component can see.
 *
 * **A local clip shows as a card, not as a frame.** The web renders a `<video>`
 * with the object URL and gets a poster for free. Native has no equivalent that
 * is worth its weight: pulling a frame out of a file: URI means another native
 * module, a decode per thumbnail and a temp file to clean up, all to fill a 78pt
 * square. A film icon and the word "Clip" say the same thing at that size, and
 * the moment the review is saved the API's own thumbnail takes over.
 *
 * **Two buttons rather than one "Add files".** The browser has exactly one way
 * to reach a file and the phone has two, and one of them — the camera — is most
 * of why writing a review from a phone is different from writing one at a desk.
 * Hiding it behind a sheet with two rows would cost a tap to say something the
 * two buttons already say.
 */
import { Camera, Film, ImagePlus, X } from "lucide-react-native";
import { StyleSheet, Pressable, View } from "react-native";

import { MAX_MEDIA_PER_REVIEW } from "@sidequestd/core";

import { useColumnWidth } from "@/lib/layout";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

import { RemoteImage } from "./media";
import { Alert } from "./ui/alert";
import { Button, ButtonRow } from "./ui/button";
import { EyebrowText, Text } from "./ui/text";

export interface TrayItem {
  /** Whatever identifies it to the caller: an upload id, or a local URI. */
  key: string;
  /** The picture to show, or null for a clip with no thumbnail yet. */
  uri: string | null;
  isVideo: boolean;
  /** What removing it takes away, for a screen reader. */
  label: string;
}

/** Four across, which is the web's `grid-cols-4` and lands at ~78pt on a 390 screen. */
const COLUMNS = 4;
const GAP = 8;

export function MediaTray({
  items,
  busy = false,
  error,
  onAddFromLibrary,
  onAddFromCamera,
  onRemove,
}: {
  items: TrayItem[];
  busy?: boolean;
  error?: string | null;
  onAddFromLibrary: () => void;
  onAddFromCamera: () => void;
  onRemove: (key: string) => void;
}) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const width = useColumnWidth(COLUMNS, GAP);

  const full = items.length >= MAX_MEDIA_PER_REVIEW;

  return (
    <View style={styles.tray}>
      {items.length > 0 ? (
        <View accessibilityRole="list" accessibilityLabel="Attached media" style={styles.grid}>
          {items.map((item) => (
            <View key={item.key} style={[styles.tile, { width, height: width }]}>
              {item.uri ? (
                <RemoteImage uri={item.uri} label={item.label} style={StyleSheet.absoluteFill} />
              ) : (
                <View style={styles.clip}>
                  <Film size={18} strokeWidth={1.5} color={tokens.color.fgFaint} />
                  <EyebrowText tone="faint">Clip</EyebrowText>
                </View>
              )}

              {/* `scrim` and `onScrim` rather than a palette pair, and no
                  `<OverMedia>` around them: those two tokens are *fixed* in both
                  themes precisely because this control sits on the reader's own
                  photograph and cannot know what is behind it. The provider
                  exists to pin the four roles that do follow the theme, and
                  nothing here uses one. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.label}`}
                disabled={busy}
                onPress={() => onRemove(item.key)}
                hitSlop={6}
                style={({ pressed }) => [styles.remove, pressed && styles.removePressed]}
              >
                <X size={13} strokeWidth={2.5} color={tokens.color.onScrim} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <ButtonRow>
        <Button icon={ImagePlus} size="sm" disabled={busy || full} onPress={onAddFromLibrary}>
          {busy ? "Working…" : "Add photos"}
        </Button>
        <Button
          icon={Camera}
          size="sm"
          disabled={busy || full}
          onPress={onAddFromCamera}
          accessibilityLabel="Take a photo"
        >
          Camera
        </Button>
      </ButtonRow>

      <Text size={12} tone="faint" relaxed>
        {full
          ? `That's all ${MAX_MEDIA_PER_REVIEW}. Remove one to add another.`
          : `Up to ${MAX_MEDIA_PER_REVIEW} items, one clip. Photos to 15 MB, clips to 100 MB and 60 seconds.`}
      </Text>

      <Alert tone="error" inline>
        {error}
      </Alert>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    tray: { gap: 12 },

    // Pixel widths from `useColumnWidth`, never a flex basis — see lib/layout.
    grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
    tile: {
      overflow: "hidden",
      ...rounded(t.radius.md),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface2,
    },
    clip: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6 },

    remove: {
      position: "absolute",
      right: 4,
      top: 4,
      width: 24,
      height: 24,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 999,
      backgroundColor: t.color.scrim,
    },
    removePressed: { opacity: 0.75 },
  });
