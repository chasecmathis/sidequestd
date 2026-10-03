/**
 * Edit profile — SPEC §6.2.
 *
 * Two independent operations on one screen, exactly as on the web: the text
 * fields go through `PATCH /users/me`, and the picture goes through
 * `PUT /users/me/avatar` as multipart. The avatar is applied as soon as one is
 * chosen rather than waiting for Save, because the upload has its own failure
 * modes (too large, wrong type, storage down) and burying them inside a form
 * submit makes them much harder to report against the right control.
 *
 * **The picker crops to a square.** The web offers a plain file input and lets
 * the server centre-crop, which is the only thing a browser can do without a
 * cropping library. `expo-image-picker` has one built in, and an avatar is drawn
 * in a circle at eight sizes — so a reader who cannot choose the square finds
 * out where their face ended up after the upload.
 *
 * **Private account is a `Switch`, not a checkbox.** RN has no checkbox, and the
 * platform's switch is the right control anyway: it is a setting that takes
 * effect on its own rather than an item in a set. It keeps the web's shape,
 * though — inside the form, saved with Save — because the API only learns about
 * it through `PATCH /users/me` and a control that appeared to apply instantly
 * while sitting above an unpressed Save button would be lying about which.
 */
import { useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";

import { ApiError, profilePath, useAuth } from "@sidequestd/core";
import type { UserMe, UserUpdate } from "@sidequestd/api-types";

import { Avatar } from "@/components/avatar";
import { Screen } from "@/components/screen";
import { Alert } from "@/components/ui/alert";
import { Button, ButtonRow } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Field, SubmitButton, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ProfileSkeleton } from "@/components/ui/skeleton";
import { EyebrowText, Text } from "@/components/ui/text";
import { pickAvatar, uploadBody } from "@/lib/media-picker";
import { open } from "@/lib/navigate";
import { useRequireAuth } from "@/lib/require-auth";
import { rounded, useStyles, useTokens, type Tokens } from "@/theme";

/** The web's own cap on the bio field. */
const BIO_MAX_LENGTH = 300;

export default function EditProfileScreen() {
  const styles = useStyles(make);
  const tokens = useTokens();

  const user = useRequireAuth();
  const { authedRequest, syncUser } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Seed the form once the session has resolved. Keyed on the user id so it does
  // not clobber what is being typed on every context update.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setBio(user.bio ?? "");
    setIsPrivate(user.is_private);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function submit() {
    setPending(true);
    setError(null);
    setSaved(null);

    // Trimmed-empty means "clear it", which the API spells as null — sending ""
    // would fail the minimum-length rule on display_name.
    const payload: UserUpdate = {
      display_name: displayName.trim() || null,
      bio: bio.trim() || null,
      is_private: isPrivate,
    };

    try {
      syncUser(await authedRequest<UserMe>("/users/me", { method: "PATCH", body: payload }));
      setSaved("Profile saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setPending(false);
    }
  }

  async function changeAvatar() {
    setAvatarError(null);
    setSaved(null);

    const picked = await pickAvatar();
    if (!picked) return;

    setUploading(true);
    try {
      syncUser(
        await authedRequest<UserMe>("/users/me/avatar", { method: "PUT", body: uploadBody(picked) }),
      );
      setSaved("Profile picture updated.");
    } catch (cause) {
      setAvatarError(cause instanceof ApiError ? cause.message : "Could not upload that picture.");
    } finally {
      setUploading(false);
    }
  }

  async function removeAvatar() {
    setUploading(true);
    setAvatarError(null);
    try {
      syncUser(await authedRequest<UserMe>("/users/me/avatar", { method: "DELETE" }));
      setSaved("Profile picture removed.");
    } catch (cause) {
      setAvatarError(cause instanceof Error ? cause.message : "Could not remove that picture.");
    } finally {
      setUploading(false);
    }
  }

  if (!user) {
    return (
      <Screen back>
        <ProfileSkeleton />
      </Screen>
    );
  }

  return (
    <Screen back>
      <PageHeader eyebrow="Account" title="Edit profile" />

      <View style={styles.picture}>
        <Avatar user={user} size={80} />

        <View style={styles.pictureActions}>
          <ButtonRow>
            <Button size="sm" disabled={uploading} onPress={() => void changeAvatar()}>
              {uploading ? "Uploading…" : "Change picture"}
            </Button>
            {user.avatar_url ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={uploading}
                onPress={() => void removeAvatar()}
                accessibilityLabel="Remove your profile picture"
              >
                Remove
              </Button>
            ) : null}
          </ButtonRow>

          <Text size={12} tone="faint" relaxed>
            JPEG, PNG or WebP, up to 5 MB.
          </Text>
        </View>
      </View>

      <Alert>{avatarError}</Alert>

      <Field
        label="Username"
        value={user.username}
        editable={false}
        hint="Your handle is how people find you, so it isn't editable here."
      />

      <Field
        label="Display name"
        value={displayName}
        onChangeText={setDisplayName}
        maxLength={50}
        hint="Shown above your bio. Leave blank to show just your handle."
      />

      <View style={styles.bio}>
        <Textarea
          label="Bio"
          value={bio}
          onChangeText={setBio}
          rows={4}
          maxLength={BIO_MAX_LENGTH}
        />
        <EyebrowText tone="faint" style={styles.counter}>
          {bio.length} / {BIO_MAX_LENGTH}
        </EyebrowText>
      </View>

      {/* The row is not itself pressable, and that is a deliberate difference
          from the web's `<label>` wrapping its checkbox. A `Switch` handles its
          own gesture, including the drag; putting a second target around it
          means a tap that starts on the switch and slides ends up toggling
          twice on Android. */}
      <View style={styles.toggle}>
        <View style={styles.toggleText}>
          <Text size={15} weight="medium">
            Private account
          </Text>
          <Text size={13} tone="dim" relaxed style={styles.toggleHint}>
            Only approved followers see your reviews, favorites and stats. Existing followers keep
            their access.
          </Text>
        </View>

        <Switch
          value={isPrivate}
          onValueChange={setIsPrivate}
          accessibilityLabel="Private account"
          // The accent as a fill — the palette's one sanctioned use of it, and
          // the platform's own control asking for exactly that.
          trackColor={{ false: tokens.color.lineStrong, true: tokens.color.accent }}
          thumbColor={process.env.EXPO_OS === "android" ? tokens.color.surface : undefined}
        />
      </View>

      <Alert>{error}</Alert>
      <Alert tone="success">{saved}</Alert>

      <SubmitButton pending={pending} onPress={() => void submit()}>
        Save changes
      </SubmitButton>

      <View style={styles.section}>
        <Eyebrow heading rule>
          Your profile
        </Eyebrow>
        <Button onPress={() => open(profilePath(user.username))} style={styles.away}>
          View profile
        </Button>
      </View>
    </Screen>
  );
}

const make = (t: Tokens) =>
  StyleSheet.create({
    picture: { flexDirection: "row", alignItems: "center", gap: 18 },
    pictureActions: { flex: 1, minWidth: 0, gap: 10 },

    bio: { gap: 6 },
    counter: { textAlign: "right", fontVariant: ["tabular-nums"] },

    toggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      ...rounded(t.radius.lg),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    toggleText: { flex: 1, minWidth: 0 },
    toggleHint: { marginTop: 6 },

    section: { gap: 14 },
    away: { alignSelf: "flex-start" },
  });
