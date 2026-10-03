/**
 * Request a password reset (SPEC §6.1) — the web's `/forgot-password`.
 *
 * `apiRequest` directly rather than through `useAuth`: this is the one auth
 * screen that does not touch the session. There is nothing to store and nothing
 * to sign in, so routing it through the provider would only add a hop.
 *
 * The confirmation *replaces* the form, and the API answers 202 whether or not
 * the address is registered — so the screen cannot say "we sent it" or "no such
 * account" without leaking which addresses have accounts. The wording comes back
 * from the server for exactly that reason; it is not written twice.
 */
import { useState } from "react";

import { apiRequest } from "@sidequestd/core";
import type { MessageResponse } from "@sidequestd/api-types";

import { AuthFooter, AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Field, SubmitButton } from "@/components/ui/field";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit() {
    if (pending) return;
    setPending(true);
    setFormError(null);

    try {
      const response = await apiRequest<MessageResponse>("/auth/password-reset", {
        method: "POST",
        body: { email: email.trim() },
      });
      setSent(response.detail);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link to choose a new one."
      footer={<AuthFooter label="Back to sign in" href="/login" />}
    >
      {sent ? (
        <Alert tone="success">{sent}</Alert>
      ) : (
        <>
          <Alert tone="error">{formError}</Alert>

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => void onSubmit()}
          />

          <SubmitButton pending={pending} onPress={() => void onSubmit()}>
            Send reset link
          </SubmitButton>
        </>
      )}
    </AuthShell>
  );
}
