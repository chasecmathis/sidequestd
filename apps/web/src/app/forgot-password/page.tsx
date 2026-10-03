"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/form";
import { apiRequest } from "@sidequestd/core";
import type { MessageResponse } from "@sidequestd/api-types";

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);

    const data = new FormData(event.currentTarget);
    try {
      // The API answers 202 whether or not the address exists, so this screen
      // shows the same confirmation either way.
      const response = await apiRequest<MessageResponse>("/auth/password-reset", {
        method: "POST",
        body: { email: String(data.get("email") ?? "") },
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
      footer={
        <Link href="/login" className="link font-medium text-fg">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <FormSuccess message={sent} />
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <FormError message={formError} />
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
          />
          <SubmitButton pending={pending}>Send reset link</SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}
