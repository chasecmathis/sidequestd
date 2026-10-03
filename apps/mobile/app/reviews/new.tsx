/**
 * Write a review — SPEC §6.3, and the screen this whole slice is named after.
 *
 * The ordering constraint is the web's and is preserved exactly: a review has to
 * exist before media can hang off it (the upload endpoint lives under
 * `/reviews/{id}/media`), so files chosen here are held locally and uploaded
 * once the review is posted. That keeps "pick a game, rate it, add photos" on
 * one screen without inventing an orphan review to attach things to.
 *
 * If an upload fails part-way, the review is already saved: `reviewId` is kept,
 * so pressing again uploads only what is left instead of posting a second copy.
 * On a phone this is not the edge case it is on the web — a composer with four
 * photos on a train will lose its connection halfway through more often than it
 * will not, and the difference between a retry and a duplicate review is this
 * one piece of state.
 *
 * **Presented as a modal**, which is the plan's call and the platform's: this is
 * a task with a beginning and an end, entered from a button rather than
 * navigated to, and it should come up over the screen the reader was on and
 * leave it where it was. The app bar's close is a cross for the same reason.
 *
 * The staged files are a local list rather than object URLs with a cleanup
 * sweep — the web's `URL.createObjectURL` has no counterpart here, because the
 * picker hands back a `file://` URI the OS already owns. Nothing to revoke,
 * nothing to leak.
 */
import { BadgeCheck } from "lucide-react-native";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  ApiError,
  playtimeSuggestionValue,
  playtimeToMinutes,
  releaseYearLabel,
  REVIEW_TEXT_MAX_LENGTH,
  reviewPath,
  tally,
  useAuth,
} from "@sidequestd/core";
import type {
  GameSummary,
  PlaytimeSuggestion,
  ReviewCreate,
  ReviewDetail,
} from "@sidequestd/api-types";

import { GamePicker } from "@/components/game-picker";
import { Cover } from "@/components/media";
import { MediaTray, type TrayItem } from "@/components/media-tray";
import { Screen } from "@/components/screen";
import { StarRatingInput } from "@/components/star-rating";
import { Alert } from "@/components/ui/alert";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field, SubmitButton, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { EyebrowText, Text } from "@/components/ui/text";
import { captureWithCamera, pickFromLibrary, uploadBody, type PickedMedia } from "@/lib/media-picker";
import { openReplacing } from "@/lib/navigate";
import { useRequireAuth } from "@/lib/require-auth";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

/** How many catalog results the picker offers here. The web's six. */
const PICKER_LIMIT = 6;

export default function NewReviewScreen() {
  const styles = useStyles(make);
  const tokens = useTokens();

  const user = useRequireAuth();
  const { authedRequest } = useAuth();
  const { game: preselected } = useLocalSearchParams<{ game?: string }>();

  const [game, setGame] = useState<GameSummary | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [playtime, setPlaytime] = useState("");
  const [pending, setPending] = useState<PickedMedia[]>([]);
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<string | null>(null);

  // "Write a review" from Game Detail arrives with the game already chosen.
  useEffect(() => {
    if (!preselected || !user) return;

    let cancelled = false;
    authedRequest<GameSummary>(`/games/${preselected}`)
      .then((body) => {
        if (!cancelled) setGame(body);
      })
      .catch(() => {
        /* Fall through to the picker; the game id in the route was not usable. */
      });
    return () => {
      cancelled = true;
    };
  }, [preselected, authedRequest, user]);

  // Asked for once per game picked. Silently absent when nothing is linked or
  // the game is not in that library, which is the common case — a composer that
  // announced "no Steam playtime found" every time would be noise.
  const gameId = game?.id ?? null;
  useEffect(() => {
    if (gameId === null) {
      setSuggestion(null);
      return;
    }

    let cancelled = false;
    authedRequest<PlaytimeSuggestion>(`/me/connections/playtime?game_id=${gameId}`)
      .then((body) => {
        if (cancelled) return;
        setSuggestion(body.playtime_minutes ? playtimeSuggestionValue(body.playtime_minutes) : null);
      })
      .catch(() => {
        if (!cancelled) setSuggestion(null);
      });

    return () => {
      cancelled = true;
    };
  }, [authedRequest, gameId]);

  async function addMedia(from: "library" | "camera") {
    setPicking(true);
    setMediaError(null);
    try {
      const counted = tally(pending);
      const result = from === "library" ? await pickFromLibrary(counted) : await captureWithCamera(counted);
      if (result.items.length > 0) setPending((current) => [...current, ...result.items]);
      setMediaError(result.error);
    } finally {
      setPicking(false);
    }
  }

  async function submit() {
    if (!game || rating === null) return;

    setSaving(true);
    setError(null);

    try {
      let id = reviewId;
      if (id === null) {
        const payload: ReviewCreate = {
          game_id: game.id,
          rating,
          review_text: text.trim() || null,
          // Typed in hours, stored in minutes.
          playtime_minutes: playtimeToMinutes(playtime),
        };
        const created = await authedRequest<ReviewDetail>("/reviews", { method: "POST", body: payload });
        id = created.id;
        setReviewId(id);
      }

      // Sequential rather than parallel, and it is the API's rule rather than a
      // politeness: the ten-item and one-clip limits are checked against what is
      // already attached, so overlapping uploads could each see room that only
      // one of them has. Each one is dropped from the staging list as it lands,
      // which is what makes a retry upload only the remainder.
      for (const item of [...pending]) {
        await authedRequest(`/reviews/${id}/media`, { method: "POST", body: uploadBody(item) });
        setPending((current) => current.filter((staged) => staged.uri !== item.uri));
      }

      // Replace rather than push: this is a modal that has finished its task,
      // and the review it made is where the reader wants to be — with the back
      // gesture going to the screen they started from, not to an empty composer.
      openReplacing(reviewPath(id));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save your review.");
    } finally {
      setSaving(false);
    }
  }

  // The frame between the session settling and the redirect landing.
  if (!user) return <Screen back="close">{null}</Screen>;

  const tray: TrayItem[] = pending.map((item) => ({
    key: item.uri,
    uri: item.isVideo ? null : item.uri,
    isVideo: item.isVideo,
    label: item.name,
  }));

  return (
    <Screen back="close">
      <PageHeader eyebrow="New" title="Write a review" />

      {/* The review exists and the uploads did not finish. Saying so — with the
          way to the review it already made — is the difference between a partial
          failure and a lost one. */}
      {reviewId ? (
        <Alert tone="success">
          Your review is saved. Press Post again to finish the uploads, or open it now.
        </Alert>
      ) : null}

      {game ? (
        <View style={styles.chosen}>
          <View style={styles.chosenCover}>
            <Cover uri={game.cover_url} title={game.title} compact />
          </View>

          <View style={styles.chosenText}>
            <Text variant="display" size={20} numberOfLines={2}>
              {game.title}
            </Text>
            <EyebrowText tone="faint" style={styles.year}>
              {releaseYearLabel(game.release_year)}
            </EyebrowText>
          </View>

          {/* Gone once the review exists: the game is what the row in the
              database is *about*, and the API has no endpoint for moving one. */}
          {reviewId === null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Change game, currently ${game.title}`}
              onPress={() => setGame(null)}
              hitSlop={8}
              style={styles.change}
            >
              {({ pressed }) => <EyebrowText tone={pressed ? "fg" : "faint"}>Change</EyebrowText>}
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.field}>
          <Eyebrow>Game</Eyebrow>
          <GamePicker onPick={setGame} limit={PICKER_LIMIT} />
          <Text size={12} tone="faint" relaxed>
            Reviews attach to a game already in the catalog.
          </Text>
        </View>
      )}

      <View style={styles.field}>
        <Eyebrow>Rating</Eyebrow>
        <StarRatingInput value={rating} onChange={setRating} />
      </View>

      <Textarea
        label="Review"
        value={text}
        onChangeText={setText}
        rows={6}
        maxLength={REVIEW_TEXT_MAX_LENGTH}
        placeholder="What did you think?"
        hint="Optional."
      />

      <View style={styles.field}>
        {/* Hours, matching how playtime reads everywhere else. `decimal-pad`
            rather than `numeric`: the second is a phone keypad with no decimal
            separator on Android, which makes "1.25" untypeable. */}
        <Field
          label="Playtime"
          value={playtime}
          onChangeText={setPlaytime}
          keyboardType="decimal-pad"
          placeholder="15.5"
          hint="Hours played. Optional."
        />

        {/* Offered, never applied.

            The field belongs to the author — they may be reviewing one
            playthrough of a game they have replayed for years — so the platform
            figure arrives as a button rather than as a prefilled value. Hidden
            once it matches what is typed, so it stops being a control the moment
            it has nothing left to do. */}
        {suggestion !== null && suggestion !== playtime ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPlaytime(suggestion)}
            style={({ pressed }) => [styles.suggestion, pressed && styles.suggestionPressed]}
          >
            <BadgeCheck size={14} strokeWidth={1.75} color={tokens.color.fgDim} />
            <EyebrowText tone="dim">Use {suggestion}h from Steam</EyebrowText>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.field}>
        <Eyebrow>Photos and clips</Eyebrow>
        <MediaTray
          items={tray}
          busy={picking || saving}
          error={mediaError}
          onAddFromLibrary={() => void addMedia("library")}
          onAddFromCamera={() => void addMedia("camera")}
          onRemove={(key) => setPending((current) => current.filter((item) => item.uri !== key))}
        />
      </View>

      <Alert>{error}</Alert>

      <SubmitButton
        pending={saving}
        disabled={game === null || rating === null}
        onPress={() => void submit()}
      >
        {game === null ? "Pick a game first" : rating === null ? "Add a rating" : "Post review"}
      </SubmitButton>

      {reviewId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => openReplacing(reviewPath(reviewId))}
          hitSlop={8}
          style={styles.away}
        >
          <EyebrowText tone="dim">View the review</EyebrowText>
        </Pressable>
      ) : null}
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    field: { gap: 12 },

    chosen: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      padding: 12,
    },
    chosenCover: { width: 44, overflow: "hidden", ...rounded(t.radius.sm) },
    chosenText: { flex: 1, minWidth: 0 },
    year: { marginTop: 6 },
    change: { paddingVertical: 8, paddingHorizontal: 4 },

    suggestion: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      ...rounded(t.radius.sm),
      borderWidth: 1,
      borderColor: t.color.line,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    suggestionPressed: { borderColor: t.color.accent, backgroundColor: t.color.surface2 },

    away: { alignSelf: "center", paddingVertical: 8 },
  });
