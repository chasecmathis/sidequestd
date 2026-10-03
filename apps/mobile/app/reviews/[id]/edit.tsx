/**
 * Edit a review — SPEC §6.3 ("the user can edit or delete their review").
 *
 * Unlike the composer, the review already exists here, so media is added and
 * removed against the API immediately rather than staged: each change has its
 * own failure modes (too large, a second clip, storage down) and burying them
 * inside a form submit makes them much harder to report against the right
 * control. The text fields still save together, on Save.
 *
 * Which is also why this is a pushed route rather than a modal, where the
 * composer is one. A modal is a task with an end — post it and you are gone. An
 * edit screen is a place where several independent things can be changed, some
 * of which have already been committed by the time the reader looks up; putting
 * a cross in the corner of that would promise a cancel this screen cannot give.
 *
 * Delete asks first, through the platform's own alert. The web deletes on the
 * click; here the same tap is a thumb on a phone, and this is the one control in
 * the app that destroys something with photographs in it.
 */
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert as NativeAlert, StyleSheet, View } from "react-native";

import {
  ApiError,
  isVideo,
  minutesToPlaytimeInput,
  playtimeToMinutes,
  profilePath,
  REVIEW_TEXT_MAX_LENGTH,
  reviewPath,
  tally,
  useAuth,
} from "@sidequestd/core";
import type { ReviewDetail, ReviewMediaItem, ReviewUpdate } from "@sidequestd/api-types";

import { MediaTray, type TrayItem } from "@/components/media-tray";
import { Screen } from "@/components/screen";
import { StarRatingInput } from "@/components/star-rating";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field, SubmitButton, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ReviewSkeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { captureWithCamera, pickFromLibrary, uploadBody } from "@/lib/media-picker";
import { openReplacing } from "@/lib/navigate";
import { useRequireAuth } from "@/lib/require-auth";
import { useStyles, type Tokens } from "@/theme";

export default function EditReviewScreen() {
  const styles = useStyles(make);
  const { id } = useLocalSearchParams<{ id: string }>();

  const user = useRequireAuth();
  const { authedRequest } = useAuth();

  const [review, setReview] = useState<ReviewDetail | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [playtime, setPlaytime] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Keyed on the viewer's id rather than on the whole record: this effect
  // re-seeds the form from the server, so anything that makes it run twice would
  // discard whatever is half-typed.
  const viewerId = user?.id ?? null;
  useEffect(() => {
    if (viewerId === null) return;

    let cancelled = false;
    authedRequest<ReviewDetail>(`/reviews/${id}`)
      .then((body) => {
        if (cancelled) return;
        setReview(body);
        setRating(body.rating);
        setText(body.review_text ?? "");
        // Stored in minutes, edited in hours.
        setPlaytime(minutesToPlaytimeInput(body.playtime_minutes));
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoadError(
          cause instanceof ApiError && cause.status === 404
            ? "That review no longer exists."
            : cause instanceof Error
              ? cause.message
              : "Request failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [authedRequest, id, viewerId]);

  async function submit() {
    if (rating === null) return;

    setSaving(true);
    setError(null);
    setSaved(null);

    const payload: ReviewUpdate = {
      rating,
      // Trimmed-empty means "clear it", which the API spells as null.
      review_text: text.trim() || null,
      playtime_minutes: playtimeToMinutes(playtime),
    };

    try {
      setReview(await authedRequest<ReviewDetail>(`/reviews/${id}`, { method: "PATCH", body: payload }));
      setSaved("Review saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your review.");
    } finally {
      setSaving(false);
    }
  }

  async function addMedia(from: "library" | "camera") {
    if (!review) return;

    setBusy(true);
    setMediaError(null);
    setSaved(null);

    const counted = tally(review.media.map((item) => ({ isVideo: isVideo(item) })));

    try {
      const picked = from === "library" ? await pickFromLibrary(counted) : await captureWithCamera(counted);

      // Uploaded one at a time, and appended as each lands: the limits are
      // judged against what is already attached, so two in flight could each see
      // room only one of them has.
      for (const file of picked.items) {
        const added = await authedRequest<ReviewMediaItem>(`/reviews/${id}/media`, {
          method: "POST",
          body: uploadBody(file),
        });
        setReview((current) => (current ? { ...current, media: [...current.media, added] } : current));
      }

      setMediaError(picked.error);
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : "Could not upload that file.");
    } finally {
      setBusy(false);
    }
  }

  async function removeMedia(mediaId: string) {
    setBusy(true);
    setMediaError(null);
    try {
      const remaining = await authedRequest<ReviewMediaItem[]>(`/reviews/${id}/media/${mediaId}`, {
        method: "DELETE",
      });
      setReview((current) => (current ? { ...current, media: remaining } : current));
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : "Could not remove that file.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await authedRequest(`/reviews/${id}`, { method: "DELETE" });
      // Replacing, not pushing: the review this screen was editing no longer
      // exists, and the back gesture must not walk into a 404.
      openReplacing(user ? profilePath(user.username) : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete your review.");
      setBusy(false);
    }
  }

  function confirmRemove() {
    NativeAlert.alert("Delete this review?", "This removes the review and its photos and clips. It can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void remove() },
    ]);
  }

  if (loadError) {
    return (
      <Screen back>
        <Alert>{loadError}</Alert>
      </Screen>
    );
  }

  if (!user || !review) {
    return (
      <Screen back>
        <ReviewSkeleton />
      </Screen>
    );
  }

  const tray: TrayItem[] = review.media.map((item) => ({
    key: item.id,
    // The API's own thumbnail, which exists for a clip as soon as it has been
    // processed — so a video that was a bare icon in the composer becomes a
    // frame here.
    uri: item.thumbnail_url ?? (isVideo(item) ? null : item.url),
    isVideo: isVideo(item),
    label: item.alt_text ?? (isVideo(item) ? "this clip" : "this photo"),
  }));

  return (
    <Screen back>
      <PageHeader eyebrow="Editing" title="Edit review" description={review.game.title} />

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
      />

      <Field
        label="Playtime"
        value={playtime}
        onChangeText={setPlaytime}
        keyboardType="decimal-pad"
        placeholder="15.5"
        hint="Hours played. Optional."
      />

      <Alert>{error}</Alert>
      <Alert tone="success">{saved}</Alert>

      <SubmitButton pending={saving} disabled={rating === null} onPress={() => void submit()}>
        Save changes
      </SubmitButton>

      <View style={styles.field}>
        <Eyebrow heading rule>
          Photos and clips
        </Eyebrow>
        <MediaTray
          items={tray}
          busy={busy}
          error={mediaError}
          onAddFromLibrary={() => void addMedia("library")}
          onAddFromCamera={() => void addMedia("camera")}
          onRemove={(key) => void removeMedia(key)}
        />
      </View>

      {/* Below everything, behind a confirmation, and the only danger-variant
          control on the screen — which is the design system's rule about
          destructive actions never being the default focus of a view. */}
      <View style={styles.danger}>
        <Button variant="danger" size="sm" disabled={busy} onPress={confirmRemove}>
          Delete review
        </Button>
        <Text size={12} tone="faint" relaxed>
          This removes the review and its photos and clips. It cannot be undone.
        </Text>
      </View>

      <Button onPress={() => openReplacing(reviewPath(review.id))} style={styles.away}>
        View the review
      </Button>
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    field: { gap: 12 },
    danger: {
      alignItems: "flex-start",
      gap: 10,
      borderTopWidth: 1,
      borderTopColor: t.color.line,
      paddingTop: 20,
    },
    away: { alignSelf: "flex-start" },
  });
