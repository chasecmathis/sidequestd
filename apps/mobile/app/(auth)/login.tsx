/**
 * Sign in (SPEC §6.1) — the web's `/login`, with a keyboard.
 *
 * The form itself is state rather than a `FormData` read, which is the whole of
 * what changes: React Native has no `<form>` and no submit event, so there is
 * nothing to read the values *off*. Everything else — the identifier that takes
 * an email or a username, the single form-level error, `router.replace` on
 * success — is the web's screen line for line.
 *
 * `replace`, not `push`, on the way out: the login screen must not be sitting
 * behind Home for the back gesture to find.
 */
import { router } from "expo-router";
import { useRef, useState } from "react";
import type { TextInput } from "react-native";

import { useAuth } from "@sidequestd/core";

import { AuthFooter, AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Field, SubmitButton } from "@/components/ui/field";

export default function LoginScreen() {
  const { login } = useAuth();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const passwordField = useRef<TextInput>(null);

  async function onSubmit() {
    if (pending) return;
    setPending(true);
    setFormError(null);

    try {
      // Trimmed because a phone keyboard's autocorrect appends a space to an
      // address often enough that the alternative is a wrong-password error the
      // reader cannot see the cause of. The password is never touched — a space
      // in there is a character in there.
      await login(identifier.trim(), password);
      router.replace("/");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Something went wrong.");
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      footer={<AuthFooter prompt="New to Sidequestd?" label="Create an account" href="/register" />}
    >
      <Alert tone="error">{formError}</Alert>

      <Field
        label="Email or username"
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="ripley@example.com"
        autoComplete="username"
        textContentType="username"
        // A capitalised first letter in a username field is the most common way
        // to fail a sign-in on iOS, and the keyboard does it by default.
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordField.current?.focus()}
      />

      <Field
        label="Password"
        inputRef={passwordField}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        autoCapitalize="none"
        returnKeyType="go"
        onSubmitEditing={() => void onSubmit()}
      />

      <SubmitButton pending={pending} onPress={() => void onSubmit()}>
        Sign in
      </SubmitButton>

      <AuthFooter label="Forgot your password?" href="/forgot-password" quiet />
    </AuthShell>
  );
}
