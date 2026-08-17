"use client";

/**
 * Close an open popover on Escape or on a press outside it.
 *
 * Extracted from the account menu once a second popover — the theme toggle —
 * needed the identical behaviour. It is four lines of listener and two subtle
 * decisions, and both of them are the kind that get dropped when the code is
 * retyped from memory:
 *
 *   - `pointerdown`, not `click`. A `click` listener fires after the press has
 *     already moved focus and, on touch, after a 300ms delay that reads as the
 *     menu sticking.
 *   - Both paths are required. A popover that only closes by pressing its
 *     trigger again is a trap on touch, where there is no Escape key to reach
 *     for.
 *
 * Returns nothing: the caller already owns the open state, and handing it back a
 * setter it just passed in would only obscure that.
 */
import { useEffect, type RefObject } from "react";

export function useDismissable(
  open: boolean,
  container: RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onDismiss();
    }
    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) onDismiss();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, container, onDismiss]);
}
