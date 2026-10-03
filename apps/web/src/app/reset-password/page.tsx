"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Field, FormError, FormSuccess, SubmitButton } from "@/components/form";
import { buttonStyles } from "@/components/ui/button";
import { ApiError, apiRequest } from "@sidequestd/core";
import type { MessageResponse } from "@sidequestd/api-types";

function ResetPasswordForm() {
  // The emailed link is /reset-password?token=… — see request_password_reset.
  const token = useSearchParams().get("token") ?? "";

  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldError(null);

    const data = new FormData(event.currentTarget);
    const password = String(data.get("new_password") ?? "");

    if (password !== String(data.get("confirm_password") ?? "")) {
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
      <FormError message="This reset link is missing its token. Request a new one from the sign-in page." />
    );
  }

  if (done) {
    return (
      <div className="space-y-4">
        <FormSuccess message={done} />
        {/* Was a hand-rolled `bg-accent … text-white`, which put white on the
            luminous orchid at about 1.8:1 — already failing AA before there was
            a second theme to worry about. `buttonStyles` gets it `text-accent-ink`,
            which is the one token that follows the accent across both modes. */}
        <Link href="/login" className={buttonStyles({ variant: "primary", className: "w-full" })}>
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <FormError message={formError} />
      <Field
        label="New password"
        name="new_password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
        error={fieldError ?? undefined}
      />
      <Field
        label="Confirm new password"
        name="confirm_password"
        type="password"
        autoComplete="new-password"
        required
      />
      <SubmitButton pending={pending}>Set new password</SubmitButton>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" subtitle="You'll be signed out on every device.">
      {/* useSearchParams needs a Suspense boundary during prerender. */}
      <Suspense fallback={<p className="text-sm text-fg-dim">Loading…</p>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
