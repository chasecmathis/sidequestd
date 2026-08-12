"use client";

/**
 * The one modal in the app.
 *
 * There was no dialog primitive before this, and only one screen needs one — the
 * game picker behind the pinned-games editor. It is written out rather than
 * pulled from Radix because what a modal actually owes you is short and worth
 * being able to read: a labelled `role="dialog"`, focus moved in on open and put
 * back on close, Escape, an outside press, and the page behind it not scrolling.
 *
 * Focus is *trapped*, not merely moved. A dialog you can Tab out of leaves a
 * keyboard user typing into a form they cannot see, which is worse than having
 * no dialog at all — so Tab and Shift+Tab wrap at the ends of the panel.
 */
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Everything that can hold focus, minus the things that decline it. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  // Where focus was before the dialog took it, so it can be handed back to the
  // control that opened it rather than dumped at the top of the document.
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const focusables = useCallback(
    () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    if (!open) return;

    opener.current = document.activeElement as HTMLElement | null;

    // Deferred a frame: on the opening render the panel is mounted but Motion
    // has not settled it, and focusing mid-animation makes Safari scroll the
    // page under the backdrop.
    const raf = requestAnimationFrame(() => {
      const [first] = focusables();
      (first ?? panel.current)?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const items = focusables();
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Only the ends need handling — the browser walks the middle correctly.
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node)) onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    // The page behind a modal must not scroll: on touch especially, scrolling
    // the document under an open sheet is how people lose their place entirely.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.body.style.overflow = previousOverflow;
      opener.current?.focus();
    };
  }, [open, onClose, focusables]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-canvas/80 backdrop-blur-sm"
          />

          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            tabIndex={-1}
            // A sheet on a phone, a centred panel above it. The y-offset differs
            // per breakpoint in CSS, so the animation only moves opacity/scale
            // and lets the layout decide where "closed" is.
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.22 }}
            className={cn(
              "relative flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden",
              "rounded-t-2xl border border-line bg-surface shadow-2xl shadow-black/70",
              "sm:rounded-2xl",
              className,
            )}
          >
            <header className="flex items-start gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="type-display text-2xl text-fg">
                  {title}
                </h2>
                {description ? (
                  <p id={descriptionId} className="mt-1 text-sm text-fg-dim">
                    {description}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 rounded-md p-1.5 text-fg-faint transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
              >
                <X aria-hidden strokeWidth={1.75} className="size-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
