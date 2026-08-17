"use client";

/**
 * Light / dark / follow-the-device, in two shapes.
 *
 * `ThemeMenu` is the one in the chrome: an icon button opening a small popover.
 * `ThemeSegments` is the one on the settings screen: three visible options in a
 * row. Both drive the same context, so opening one after touching the other
 * shows the right thing without any syncing.
 *
 * Three options rather than a two-state switch. A bare light/dark toggle forces
 * a reader who is happy following their OS to pick a side, and once they have,
 * the page stops tracking their device forever — "System" has to be a choice
 * that can be returned to, not merely the starting value.
 */
import { Monitor, Moon, Sun, SunMoon, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { useTheme, type ThemeChoice } from "@/lib/theme";
import { useDismissable } from "@/lib/use-dismissable";

const OPTIONS: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

/**
 * One glyph, whatever the mode.
 *
 * A sun-or-moon that mirrors the current theme is the tempting version, and it
 * is wrong twice over. It cannot be server-rendered — the preference lives in
 * the reader's storage — so it would swap under them a beat after the page
 * arrived, on every cold load. And it is redundant: the whole page is already
 * either dark or light, at a size no icon competes with. Under "System" it also
 * has nothing true to say.
 *
 * `SunMoon` says "appearance" instead, which is what the control is for, and it
 * is identical in both modes and all three states. The accessible name carries
 * the choice, since that is the part a screen reader cannot infer from the page.
 */
export function ThemeMenu({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  useDismissable(open, container, close);

  return (
    <div ref={container} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Theme: ${theme}`}
        className="flex size-8 items-center justify-center rounded-md text-fg-dim transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
      >
        <SunMoon aria-hidden strokeWidth={1.75} className="size-4.5" />
      </button>

      {open ? (
        // Mirrors the account menu next to it — same width idiom, same border,
        // same surface — because two popovers a few pixels apart that disagree
        // about their own shape look like a bug rather than a set.
        <div
          role="menu"
          aria-label="Theme"
          className="absolute right-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop"
        >
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === option.value}
              onClick={() => {
                setTheme(option.value);
                close();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors duration-150",
                "hover:bg-surface-2 hover:text-fg",
                theme === option.value ? "text-fg" : "text-fg-dim",
              )}
            >
              <option.icon aria-hidden strokeWidth={1.75} className="size-4" />
              {option.label}
              {/* The tick is `aria-hidden` because `aria-checked` on the item
                  already says this out loud; announcing both reads as
                  "Dark, checked, checked". */}
              {theme === option.value ? (
                <span aria-hidden className="ml-auto size-1.5 rounded-full bg-accent" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The settings form's version: everything visible at once, no press required to
 * see what the options even are.
 *
 * A `radiogroup` rather than three buttons, so the arrow keys move between the
 * options and the group is announced as one control with one answer — which is
 * what it is. `tabIndex` follows the roving pattern the role implies: one stop
 * for the whole group, landing on the current choice.
 */
export function ThemeSegments({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;

    event.preventDefault();
    const index = OPTIONS.findIndex((option) => option.value === theme);
    // Wraps, per the radiogroup pattern — the ends of the row are not walls.
    const next = OPTIONS[(index + delta + OPTIONS.length) % OPTIONS.length];
    setTheme(next.value);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      className={cn("flex gap-1 rounded-lg border border-line bg-surface p-1", className)}
    >
      {OPTIONS.map((option) => {
        const checked = theme === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => setTheme(option.value)}
            className={cn(
              "relative flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm",
              "transition-colors duration-150",
              checked ? "text-fg" : "text-fg-dim hover:text-fg",
            )}
          >
            {checked ? (
              // The same shared-id trick the main nav uses for its orchid rule,
              // so the pill slides between options instead of cutting.
              // `MotionConfig reducedMotion="user"` in the root layout already
              // turns this into a jump for anyone who asked for that.
              <motion.span
                layoutId="theme-segment"
                aria-hidden
                className="absolute inset-0 rounded-md bg-surface-2"
                transition={{ type: "spring", stiffness: 420, damping: 38 }}
              />
            ) : null}

            <span className="relative flex items-center gap-2">
              <option.icon aria-hidden strokeWidth={1.75} className="size-4" />
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
