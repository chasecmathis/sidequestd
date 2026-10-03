"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Field, FormError, SubmitButton } from "@/components/form";
import { useAuth } from "@sidequestd/core";
export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError(null);

    const data = new FormData(event.currentTarget);
    try {
      await login(String(data.get("identifier") ?? ""), String(data.get("password") ?? ""));
      router.push("/home");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      footer={
        <>
          New to Sidequestd?{" "}
          <Link href="/register" className="link font-medium text-fg">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <FormError message={formError} />

        <Field
          label="Email or username"
          name="identifier"
          autoComplete="username"
          required
          placeholder="ripley@example.com"
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />

        <SubmitButton pending={pending}>Sign in</SubmitButton>

        <p className="text-center text-sm">
          <Link href="/forgot-password" className="text-fg-dim hover:text-fg hover:underline">
            Forgot your password?
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
