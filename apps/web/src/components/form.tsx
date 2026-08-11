"use client";

/**
 * The form controls moved to `components/ui`, where the rest of the design
 * system lives and where the input styling is shared with the three non-field
 * controls that need it (search, the backlog picker, the game picker).
 *
 * This file stays as the re-export so the twelve screens importing from
 * `@/components/form` did not all have to change in the same commit. New code
 * should import from `@/components/ui/field` directly.
 */
import { Alert } from "@/components/ui/alert";

export { Field, Select, SubmitButton, Textarea, inputStyles } from "@/components/ui/field";

/** Form-level error, announced to screen readers when it appears. */
export function FormError({ message }: { message: string | null }) {
  return <Alert tone="error">{message}</Alert>;
}

export function FormSuccess({ message }: { message: string | null }) {
  return <Alert tone="success">{message}</Alert>;
}
