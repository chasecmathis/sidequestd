"use client";

/**
 * Form controls.
 *
 * `inputStyles` is shared rather than a component prop because three of the
 * places that need it are not fields at all — the search box, the backlog
 * `<select>`, the review's game picker — and each had grown its own copy of the
 * same nine utilities. One string, four consumers.
 *
 * `Field`, `Textarea` and `Select` all follow the same rule for the line under
 * the control: an error replaces the hint rather than joining it, and whichever
 * is showing is the one `aria-describedby` points at. Announcing a hint the
 * reader has already violated is worse than saying nothing.
 */
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useId } from "react";

import { cn } from "@/lib/cn";
import { Alert } from "@/components/ui/alert";

export function inputStyles({
  invalid = false,
  className,
}: { invalid?: boolean; className?: string } = {}) {
  return cn(
    "w-full rounded-md border bg-surface-2 px-3 py-2.5 text-sm text-fg transition-colors duration-150",
    "placeholder:text-fg-faint hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-60",
    // No focus ring here: the global `:focus-visible` outline in globals.css is
    // the app's one focus treatment, and a second one would double up.
    invalid ? "border-danger/70" : "border-line",
    className,
  );
}

function Shell({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="type-eyebrow block text-fg-dim">
        {label}
      </label>
      {children}
      {error ? (
        <Alert tone="error" inline>
          <span id={`${id}-error`}>{error}</span>
        </Alert>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-fg-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ label, hint, error, className, ...inputProps }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <input
        {...inputProps}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputStyles({ invalid: Boolean(error), className })}
      />
    </Shell>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Textarea({ label, hint, error, className, ...textareaProps }: TextareaProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <textarea
        {...textareaProps}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputStyles({ invalid: Boolean(error), className: cn("resize-y", className) })}
      />
    </Shell>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function Select({ label, hint, error, className, children, ...selectProps }: SelectProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <Shell id={id} label={label} hint={hint} error={error}>
      <select
        {...selectProps}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputStyles({ invalid: Boolean(error), className })}
      >
        {children}
      </select>
    </Shell>
  );
}

/**
 * The submit button.
 *
 * `pending` and `disabled` are separate because they mean different things to a
 * reader: one says the form is working, the other says it is not ready. Both
 * block the press; only one changes the label.
 */
export function SubmitButton({
  pending,
  disabled = false,
  children,
  className,
}: {
  pending: boolean;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex h-11 w-full select-none items-center justify-center gap-2 rounded-md",
        "bg-accent text-sm font-semibold text-accent-ink transition duration-150",
        "hover:bg-accent-dim active:translate-y-px",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {pending ? "Working…" : children}
    </button>
  );
}
