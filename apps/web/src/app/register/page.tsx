"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Field, FormError, SubmitButton } from "@/components/form";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();

  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    const data = new FormData(event.currentTarget);
    try {
      await register({
        username: String(data.get("username") ?? ""),
        email: String(data.get("email") ?? ""),
        password: String(data.get("password") ?? ""),
        displayName: String(data.get("display_name") ?? ""),
      });
      router.push("/home");
    } catch (error) {
      // 409 and 422 both name the offending field, so show the message inline
      // where the user can act on it (SPEC §6.1).
      if (error instanceof ApiError && error.field) {
        setFieldErrors({ [error.field]: error.message });
      } else {
        setFormError(error instanceof Error ? error.message : "Something went wrong.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Log the games you play and share what you thought."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="link font-medium text-fg">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />

        <Field
          label="Username"
          name="username"
          autoComplete="username"
          required
          minLength={3}
          maxLength={30}
          placeholder="ripley"
          hint="Letters, numbers, underscores and periods. This is your public handle."
          error={fieldErrors.username}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          hint="Private — never shown on your profile."
          error={fieldErrors.email}
        />
        <Field
          label="Display name"
          name="display_name"
          autoComplete="name"
          maxLength={50}
          placeholder="Ellen Ripley"
          hint="Optional."
          error={fieldErrors.display_name}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          hint="At least 10 characters."
          error={fieldErrors.password}
        />

        <SubmitButton pending={pending}>Create account</SubmitButton>
      </form>
    </AuthShell>
  );
}
