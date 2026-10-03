"use client";

/**
 * Edit profile — SPEC §6.2.
 *
 * Two independent operations on one screen: the text fields go through
 * `PATCH /users/me`, and the picture goes through `PUT /users/me/avatar` as
 * multipart. The avatar is applied as soon as a file is chosen rather than
 * waiting for Save, because the upload has its own failure modes (too large,
 * wrong type, storage down) and burying them inside a form submit makes them
 * much harder to report against the right control.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { AppShell } from "@/components/app-shell";
import { ThemeSegments } from "@/components/theme-toggle";
import { Eyebrow } from "@/components/ui/eyebrow";
import { inputStyles } from "@/components/ui/field";
import { ProfileSkeleton } from "@/components/ui/skeleton";
import { Avatar } from "@/components/avatar";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/form";
import { ApiError, profilePath, useAuth } from "@sidequestd/core";

import type { UserMe, UserUpdate } from "@sidequestd/api-types";

const BIO_MAX_LENGTH = 300;

export default function EditProfilePage() {
  const router = useRouter();
  const { user, isLoading, authedRequest, syncUser } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Seed the form once the session has resolved. Keyed on the user id so it
  // does not clobber what is being typed on every context update.
  useEffect(() => {
    if (!user) return;
    setDisplayName(user.display_name ?? "");
    setBio(user.bio ?? "");
    setIsPrivate(user.is_private);
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  if (isLoading || !user) {
    return (
      <AppShell>
        <ProfileSkeleton />
      </AppShell>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      const updated = await authedRequest<UserMe>("/users/me", {
        method: "PATCH",
        body: payload,
      });
      syncUser(updated);
      setSaved("Profile saved.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your profile.");
    } finally {
      setPending(false);
    }
  }

  async function handleAvatar(file: File) {
    setUploading(true);
    setAvatarError(null);
    setSaved(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const updated = await authedRequest<UserMe>("/users/me/avatar", {
        method: "PUT",
        body: form,
      });
      syncUser(updated);
      setSaved("Profile picture updated.");
    } catch (cause) {
      setAvatarError(cause instanceof ApiError ? cause.message : "Could not upload that picture.");
    } finally {
      setUploading(false);
      // Reset the input so picking the same file again still fires a change.
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function handleRemoveAvatar() {
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

  return (
    <AppShell>
      <div className="mx-auto max-w-xl">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="type-display text-4xl text-fg">Edit profile</h1>
          <Link href={profilePath(user.username)} className="link text-sm text-fg">
            View profile
          </Link>
        </div>

        <section className="mt-8 flex items-center gap-5">
          <Avatar user={user} size={80} />
          <div className="space-y-2">
            <label
              htmlFor="avatar"
              className="inline-flex h-9 cursor-pointer items-center rounded-md border border-line px-3.5 text-sm text-fg transition-colors duration-150 hover:border-line-strong hover:bg-surface-2"
            >
              {uploading ? "Uploading…" : "Change picture"}
            </label>
            <input
              id="avatar"
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleAvatar(file);
              }}
            />
            {user.avatar_url ? (
              <button
                type="button"
                onClick={() => void handleRemoveAvatar()}
                disabled={uploading}
                className="type-eyebrow ml-3 text-fg-faint transition-colors duration-150 hover:text-fg disabled:opacity-60"
              >
                Remove
              </button>
            ) : null}
            <p className="text-xs text-fg-faint">JPEG, PNG or WebP, up to 5 MB.</p>
          </div>
        </section>

        <FormError message={avatarError} />

        <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
          <Field
            label="Username"
            value={user.username}
            readOnly
            disabled
            hint="Your handle is how people find you, so it isn't editable here."
          />

          <Field
            label="Display name"
            value={displayName}
            maxLength={50}
            onChange={(event) => setDisplayName(event.target.value)}
            hint="Shown above your bio. Leave blank to show just your handle."
          />

          <div className="space-y-1.5">
            <label htmlFor="bio" className="type-eyebrow block text-fg-dim">
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              rows={4}
              maxLength={BIO_MAX_LENGTH}
              onChange={(event) => setBio(event.target.value)}
              className={inputStyles({ className: "resize-y" })}
            />
            <p className="text-xs leading-relaxed text-fg-faint">
              {bio.length} / {BIO_MAX_LENGTH}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 transition-colors duration-200 hover:border-line-strong">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(event) => setIsPrivate(event.target.checked)}
              className="mt-1"
            />
            <span className="text-sm">
              <span className="font-medium text-fg">Private account</span>
              <span className="mt-1 block text-fg-dim">
                Only approved followers see your reviews, favorites and stats. Existing followers
                keep their access.
              </span>
            </span>
          </label>

          <FormError message={error} />
          <FormSuccess message={saved} />

          <SubmitButton pending={pending}>Save changes</SubmitButton>
        </form>

        {/* Outside the `<form>`, and with no Save button of its own.

            Everything above is account state that round-trips to the API, so it
            batches behind a submit. The theme is a device preference held in
            localStorage — it applies the instant it is pressed, and the whole
            screen changing colour is a more convincing confirmation than any
            toast. Putting it inside the form would imply it needs saving, and
            leave it unsaved if the reader navigated away. */}
        <section aria-labelledby="appearance" className="mt-12 border-t border-line pt-8">
          <Eyebrow as="h2" id="appearance" rule>
            Appearance
          </Eyebrow>

          <p className="mt-4 text-sm leading-relaxed text-fg-dim">
            System follows whatever your device is set to, and changes with it.
          </p>

          <ThemeSegments className="mt-4 max-w-sm" />
        </section>
      </div>
    </AppShell>
  );
}
