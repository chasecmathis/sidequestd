/**
 * Join class names, dropping anything falsy.
 *
 * Not `clsx`, and deliberately not `tailwind-merge`: the primitives in
 * `components/ui` compose their variants rather than overriding them, so there
 * is nothing to de-duplicate. A caller who passes a conflicting utility gets
 * whichever Tailwind orders last — the same rule as writing the class by hand.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
