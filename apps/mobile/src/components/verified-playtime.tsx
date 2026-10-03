/**
 * Playtime the platform published, next to a review.
 *
 * The design problem the web solves here survives intact: this sits in the same
 * mono strip as the rating and the release year and has to read as a stronger
 * claim than the "Played 15.5h" it replaces — but the palette rule says the
 * accent is a fill or a border and almost never text, and the amber stars are
 * already the one warm chromatic voice on a card. So the distinction is
 * typographic and spatial rather than chromatic: the author's own figure is bare
 * text, and this one is *boxed*. A hairline and a tick, in the same greys.
 *
 * Two things the web has that do not survive the platform:
 *
 * **The hover border is gone.** It brightened to the accent for a reader who
 * went looking, and a touch screen has nobody hovering. Nothing replaces it —
 * this is not a control, so press feedback would be a lie.
 *
 * **The `title` becomes the accessible name.** There is no tooltip to hang the
 * full sentence on, and the sentence is the part that makes four characters into
 * evidence. A screen reader gets all of it; a sighted reader gets the chip,
 * which is what the web's hover-only tooltip amounted to anyway.
 */
import { BadgeCheck } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { formatLibraryPlaytime, providerLabel } from "@sidequestd/core";
import type { VerifiedPlaytime as Verified } from "@sidequestd/api-types";

import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

import { EyebrowText } from "./ui/text";

export function VerifiedPlaytimeChip({ verified }: { verified: Verified }) {
  const styles = useStyles(make);
  const tokens = useTokens();

  const platform = providerLabel(verified.provider);
  const hours = formatLibraryPlaytime(verified.playtime_minutes);

  return (
    <View
      style={styles.chip}
      accessible
      accessibilityLabel={`${platform} reports ${hours} played. This figure comes from ${platform}, not from the reviewer.`}
    >
      <BadgeCheck size={13} strokeWidth={1.75} color={tokens.color.fgDim} />
      {/* The platform name is what makes this evidence rather than a boast, so
          it is never dropped — even though it costs width on a narrow card. */}
      <EyebrowText tone="dim">
        {hours} on {platform}
      </EyebrowText>
    </View>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexShrink: 0,
      ...rounded(t.radius.sm),
      borderWidth: 1,
      borderColor: t.color.line,
      paddingHorizontal: 6,
      paddingVertical: 3,
    },
  });
