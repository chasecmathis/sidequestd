/**
 * Set a new password (SPEC §6.1) — the web's `/reset-password`.
 *
 * The token arrives in the route rather than in `useSearchParams`, and there is
 * no `Suspense` boundary because there is no prerender to wait for. Everything
 * else matches: the two fields are compared *before* the request, since a typo
 * the client can see is not worth a round trip; a 422 on `new_password` lands
 * under the field; and the success state offers the way back to sign-in, because
 * the API signs every session out when a password changes.
 *
 * ---
 *
 * **How the token gets here: a universal link, and no API change at all.**
 *
 * The email has always carried `https://sidequestd.app/reset-password?token=…`,
 * built from `settings.web_app_url`. What changed is who answers it. The domain
 * now serves an `apple-app-site-association` and an `assetlinks.json` naming
 * this bundle (`apps/web/src/lib/app-links.ts`), and `app.json` claims the path
 * on both platforms — so on a phone with the app installed the OS hands that URL
 * here instead of to a browser, and Expo Router strips the origin and routes
 * `/reset-password?token=…` to this file. Everywhere else the same URL is still
 * the web page it always was.
 *
 * That is the whole reason it is not a `sidequestd://` link, which is what an
 * earlier plan assumed and what the Steam callback actually uses. A custom
 * scheme is safe there because the app opened the browser that lands on it. An
 * email is read wherever somebody keeps their mail — very often a laptop — and
 * a `sidequestd://` link there is a dead end that reports nothing.
 *
 * The missing-token branch below is not dead code and is not only for mistakes:
 * the association deliberately claims `/reset-password` without requiring the
 * query, because "this link is missing its token, request a new one" is a better
 * answer than silently sending that case to a browser.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import type { TextInput } from "react-native";

import { ApiError, apiRequest } from "@sidequestd/core";
import type { MessageResponse } from "@sidequestd/api-types";

import { AuthFooter, AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, SubmitButton } from "@/components/ui/field";

export default function ResetPasswordScreen() {
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const confirmationField = useRef<TextInput>(null);

  async function onSubmit() {
    if (pending || !token) return;
    setPending(true);
    setFormError(null);
    setFieldError(null);

    if (password !== confirmation) {
      setFieldError("Those passwords don't match.");
      setPending(false);
      return;
    }

    try {
      const response = await apiRequest<MessageResponse>("/auth/password-reset/confirm", {
        method: "POST",
        body: { token, new_password: password },
      });
      setDone(response.detail);
    } catch (error) {
      if (error instanceof ApiError && error.field === "new_password") {
        setFieldError(error.message);
      } else {
        setFormError(error instanceof Error ? error.message : "Something went wrong.");
      }
    } finally {
      setPending(false);
    }
  }

  if (!token) {
    return (
      <AuthShell
        title="Choose a new password"
        footer={<AuthFooter label="Back to sign in" href="/login" />}
      >
        <Alert tone="error">
          This reset link is missing its token. Request a new one from the sign-in screen.
        </Alert>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Choose a new password">
        <Alert tone="success">{done}</Alert>
        {/* A button rather than the footer link: the password has changed and
            signing in again is the only thing left to do, so it is the screen's
            one primary action. */}
        <Button variant="primary" size="lg" onPress={() => router.replace("/login")}>
          Sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Choose a new password"
      subtitle="You'll be signed out on every device."
      footer={<AuthFooter label="Back to sign in" href="/login" />}
    >
      <Alert tone="error">{formError}</Alert>

      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        hint="At least 10 characters."
        error={fieldError ?? undefined}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => confirmationField.current?.focus()}
      />

      <Field
        label="Confirm new password"
        inputRef={confirmationField}
        value={confirmation}
        onChangeText={setConfirmation}
        secureTextEntry
        // Not `newPassword`: two fields both offering to generate a password
        // makes the OS suggest a *different* one for the confirmation.
        autoComplete="off"
        textContentType="none"
        autoCapitalize="none"
        returnKeyType="go"
        onSubmitEditing={() => void onSubmit()}
      />

      <SubmitButton pending={pending} onPress={() => void onSubmit()}>
        Set new password
      </SubmitButton>
    </AuthShell>
  );
}
