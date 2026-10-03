/**
 * Form controls.
 *
 * `Field` and `Textarea` follow the web's rule for the line under the control:
 * an error *replaces* the hint rather than joining it, and whichever is showing
 * is the one announced. Reading out a hint the reader has already violated is
 * worse than saying nothing.
 *
 * Two native-only decisions:
 *
 * **The focus treatment is the control's own border.** The web has one global
 * `:focus-visible` ring and every input inherits it. Native has no focus ring at
 * all, and on a phone the focused field is the one the keyboard is about to
 * cover — so it says so itself, with the accent on its edge. This is the one
 * place the accent appears as a border on an otherwise quiet control, and it is
 * within the palette rule: a border, not letters.
 *
 * **The label is on the input, not beside it.** There is no `htmlFor` here;
 * a visible `<Text>` above a `<TextInput>` is two unrelated nodes to a screen
 * reader. `accessibilityLabel` on the input is what actually associates them,
 * and the hint or error rides along as `accessibilityHint`.
 */
import { Search } from "lucide-react-native";
import { useState } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import type { ReactNode, Ref } from "react";

import { rounded, text, useStyles, useTokens, type Tokens } from "@/theme";

import { Alert } from "./alert";
import { Button } from "./button";
import { EyebrowText, Text } from "./text";

interface FieldProps extends Omit<TextInputProps, "style"> {
  label: string;
  hint?: string;
  error?: string;
  style?: StyleProp<ViewStyle>;
  /**
   * The input itself, for the field above it to focus.
   *
   * Named rather than a `ref`, because a `ref` on this component would point at
   * the wrapping `<View>` — the thing with the label and the hint in it, which
   * has no `focus()`. Keyboard chaining is not a nicety on a phone: a four-field
   * form whose Next key does nothing is four dismissals of the keyboard and four
   * taps to get back to where the reader already was.
   */
  inputRef?: Ref<TextInput>;
}

function Shell({
  label,
  hint,
  error,
  children,
  style,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles(make);

  return (
    <View style={[styles.shell, style]}>
      <EyebrowText tone="dim">{label}</EyebrowText>
      {children}
      {error ? (
        <Alert tone="error" inline>
          {error}
        </Alert>
      ) : hint ? (
        <Text size={12} tone="faint" relaxed>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Field({ label, hint, error, style, inputRef, ...inputProps }: FieldProps) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const [focused, setFocused] = useState(false);

  return (
    <Shell label={label} hint={hint} error={error} style={style}>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={tokens.color.fgFaint}
        // The caret is the one moving thing on the screen while a field is being
        // filled, and the accent is what the reader's eye is already following.
        cursorColor={tokens.color.accent}
        selectionColor={tokens.color.accent}
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        style={[
          styles.input,
          styles.singleLine,
          focused && styles.focused,
          error ? styles.invalid : null,
        ]}
      />
    </Shell>
  );
}

/**
 * The multi-line field: a review's text, a profile bio.
 *
 * `textAlignVertical: "top"` is Android-only and load-bearing there — without
 * it a tall input starts its text vertically centred, which looks like a bug the
 * first time anyone types into it.
 */
export function Textarea({
  label,
  hint,
  error,
  rows = 6,
  style,
  inputRef,
  ...inputProps
}: FieldProps & { rows?: number }) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const [focused, setFocused] = useState(false);

  return (
    <Shell label={label} hint={hint} error={error} style={style}>
      <TextInput
        ref={inputRef}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={tokens.color.fgFaint}
        cursorColor={tokens.color.accent}
        selectionColor={tokens.color.accent}
        multiline
        textAlignVertical="top"
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        style={[
          styles.input,
          styles.multiline,
          { minHeight: rows * 22 },
          focused && styles.focused,
          error ? styles.invalid : null,
        ]}
      />
    </Shell>
  );
}

/**
 * The one field with no label above it.
 *
 * Search is the exception the web makes too — there the label is `sr-only`,
 * because a magnifier, a placeholder and a screen called Search have already
 * said it three times and a fourth in 11px mono caps is clutter. The name still
 * has to exist for a screen reader, so it moves onto the control as
 * `accessibilityLabel`, which is where native puts it anyway.
 *
 * `clearButtonMode` is iOS's own; Android has no equivalent and does not need
 * one, since its keyboard keeps a delete key in reach of the thumb throughout.
 */
export function SearchInput({
  label,
  ...inputProps
}: Omit<TextInputProps, "style"> & { label: string }) {
  const styles = useStyles(make);
  const tokens = useTokens();
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.search, focused && styles.focused]}>
      <Search size={17} strokeWidth={1.75} color={tokens.color.fgFaint} />
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={tokens.color.fgFaint}
        cursorColor={tokens.color.accent}
        selectionColor={tokens.color.accent}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        {...inputProps}
        onFocus={(event) => {
          setFocused(true);
          inputProps.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          inputProps.onBlur?.(event);
        }}
        style={styles.searchInput}
      />
    </View>
  );
}

/**
 * The submit button.
 *
 * `pending` and `disabled` are separate because they mean different things to a
 * reader: one says the form is working, the other says it is not ready. Both
 * block the press; only one changes the label. `accessibilityState.busy` is what
 * carries the difference out loud, and it is the native spelling of the web's
 * `aria-busy`.
 *
 * Full width, unlike every other button in the app: it is the end of a form, and
 * on a phone that is the one place a control should be as wide as the thumb
 * expects.
 */
export function SubmitButton({
  pending,
  disabled = false,
  onPress,
  children,
  style,
}: {
  pending: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Button
      variant="primary"
      size="lg"
      onPress={onPress}
      disabled={pending || disabled}
      accessibilityState={{ disabled: pending || disabled, busy: pending }}
      style={[FULL_WIDTH, style]}
    >
      {pending ? "Working…" : children}
    </Button>
  );
}

const FULL_WIDTH: ViewStyle = { alignSelf: "stretch" };

const make = (t: Tokens) =>
  StyleSheet.create({
    shell: { gap: 8 },
    input: {
      ...rounded(t.radius.md),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface2,
      color: t.color.fg,
      paddingHorizontal: 12,
    },

    // The two inputs are set differently, and only in their leading — see
    // `text.input`, which explains why a single-line field must not carry one.
    // The padding makes up the difference so both controls stay the same height
    // they were: 22pt of line and 12 of padding, or 18 of natural line and 14.
    //
    // Vertical padding rather than a height, so a field grows with the system
    // text size instead of clipping it.
    singleLine: { ...text.input(text.size.body), paddingVertical: 14 },
    multiline: { ...text.body(text.size.body), paddingVertical: 12 },

    focused: { borderColor: t.color.accent },
    invalid: { borderColor: t.color.danger },

    search: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      ...rounded(t.radius.md),
      borderWidth: 1,
      borderColor: t.color.line,
      backgroundColor: t.color.surface2,
      paddingHorizontal: 14,
    },
    // A step larger than a form field's: it is the only control on the screen
    // and the thing the reader came to use. Same `text.input` caveat about the
    // caret applies — see `theme/typography.ts`.
    searchInput: { flex: 1, ...text.input(16), color: t.color.fg, paddingVertical: 14 },
  });
