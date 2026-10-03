/**
 * Create an account (SPEC §6.1) — the web's `/register`.
 *
 * The error handling is the part worth keeping identical: a 409 (username or
 * email taken) and a 422 (a rule the field broke) both name the offending
 * field, so the message goes *under that field* rather than into the box at the
 * top. Only errors with nowhere to go become form-level ones. On a phone that
 * matters more than it does on a desktop — the top of a four-field form is
 * usually behind the keyboard by the time the reader presses the button.
 *
 * The API's field name is `display_name`, so the errors are keyed by the wire
 * name and not by the label.
 */
import { router } from "expo-router";
import { useRef, useState } from "react";
import type { TextInput } from "react-native";

import { ApiError, useAuth } from "@sidequestd/core";

import { AuthFooter, AuthShell } from "@/components/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Field, SubmitButton } from "@/components/ui/field";

export default function RegisterScreen() {
  const { register } = useAuth();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const emailField = useRef<TextInput>(null);
  const displayNameField = useRef<TextInput>(null);
  const passwordField = useRef<TextInput>(null);

  async function onSubmit() {
    if (pending) return;
    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      await register({
        username: username.trim(),
        email: email.trim(),
        password,
        // Sent as typed and empty when untouched; `register` in core is what
        // drops it, because the API rejects an empty display name.
        displayName,
      });
      router.replace("/");
    } catch (error) {
      if (error instanceof ApiError && error.field) {
        setFieldErrors({ [error.field]: error.message });
      } else {
        setFormError(error instanceof Error ? error.message : "Something went wrong.");
      }
      setPending(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Log the games you play and share what you thought."
      footer={<AuthFooter prompt="Already have an account?" label="Sign in" href="/login" />}
    >
      <Alert tone="error">{formError}</Alert>

      <Field
        label="Username"
        value={username}
        onChangeText={setUsername}
        placeholder="ripley"
        hint="Letters, numbers, underscores and periods. This is your public handle."
        error={fieldErrors.username}
        autoComplete="username-new"
        textContentType="username"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={30}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => emailField.current?.focus()}
      />

      <Field
        label="Email"
        inputRef={emailField}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        hint="Private — never shown on your profile."
        error={fieldErrors.email}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => displayNameField.current?.focus()}
      />

      <Field
        label="Display name"
        inputRef={displayNameField}
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="Ellen Ripley"
        hint="Optional."
        error={fieldErrors.display_name}
        autoComplete="name"
        textContentType="name"
        maxLength={50}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordField.current?.focus()}
      />

      <Field
        label="Password"
        inputRef={passwordField}
        value={password}
        onChangeText={setPassword}
        hint="At least 10 characters."
        error={fieldErrors.password}
        secureTextEntry
        // `newPassword` is what offers the OS-generated password and files it in
        // the keychain under this app. `password` would offer to fill an
        // existing one, on the screen where by definition there is not one.
        autoComplete="new-password"
        textContentType="newPassword"
        autoCapitalize="none"
        returnKeyType="go"
        onSubmitEditing={() => void onSubmit()}
      />

      <SubmitButton pending={pending} onPress={() => void onSubmit()}>
        Create account
      </SubmitButton>
    </AuthShell>
  );
}
