"use client";

/**
 * Animation configuration for the whole tree.
 *
 * A client boundary of its own so the root layout can stay a server component:
 * `MotionConfig` is a context provider, and a provider cannot be rendered from
 * a server component without one.
 *
 * `reducedMotion="user"` is the reason no component below reaches for
 * `useReducedMotion`. Motion reads the media query here and disables transforms
 * and opacity animations for everyone who asked for that, so an animation is
 * written once and is accessible by construction. The CSS backstop in
 * globals.css covers the transitions and keyframes Motion does not manage.
 */
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </MotionConfig>
  );
}
