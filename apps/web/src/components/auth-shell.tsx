import Link from "next/link";
import type { ReactNode } from "react";

import { Wordmark } from "@/components/ui/wordmark";

/**
 * The frame around every unauthenticated screen.
 *
 * Two columns above `lg`, one below. The left is the pitch — wordmark, a line of
 * positioning, and the three things the product does — and it exists because a
 * centred form on an empty page tells a first-time visitor nothing about what
 * they are signing up for. Below `lg` it is dropped rather than stacked: someone
 * on a phone who reached /login already knows.
 *
 * The orchid bloom behind the card is the one place in the app the accent is
 * used as light rather than as ink. It sits under the form at 8% and is what
 * keeps a near-black page from reading as an error state.
 *
 * Alone among the shells this one gets no `SiteFooter`. The card is centred in a
 * `min-h-screen` column, and appending a footer would shove it off-centre to put
 * chrome under the one flow that should be frictionless. The `footer` prop below
 * is unrelated — it is the "Don't have an account?" line under the card.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/4 size-[38rem] rounded-full bg-accent/8 blur-[120px]"
      />

      <div className="relative mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center gap-16 px-6 py-16 lg:flex-row lg:items-center lg:gap-24">
        <section className="hidden max-w-sm flex-1 lg:block">
          <Link href="/">
            <Wordmark size="md" />
          </Link>

          <p className="type-display mt-10 text-4xl leading-[1.1] text-fg">
            Every game you&apos;ve played,
            <span className="italic text-fg-dim"> written down.</span>
          </p>

          <ul className="mt-10 space-y-4 border-l border-line pl-5">
            {[
              "Rate and review what you play, with screenshots and clips.",
              "Follow friends and see what they're into, newest first.",
              "Track a backlog across four lists you actually keep.",
            ].map((line) => (
              <li key={line} className="text-sm leading-relaxed text-fg-dim">
                {line}
              </li>
            ))}
          </ul>
        </section>

        <div className="mx-auto w-full max-w-sm lg:mx-0">
          {/* The mark repeats here for the single-column layout, where the panel
              above is not rendered at all. */}
          <Link href="/" className="mb-10 flex justify-center lg:hidden">
            <Wordmark />
          </Link>

          <div className="rounded-xl border border-line bg-surface p-6 shadow-2xl shadow-black/50 sm:p-7">
            <h1 className="type-display text-3xl text-fg">{title}</h1>
            {subtitle ? (
              <p className="mt-2 text-sm leading-relaxed text-fg-dim">{subtitle}</p>
            ) : null}
            <div className="mt-7">{children}</div>
          </div>

          {footer ? <p className="mt-6 text-center text-sm text-fg-dim">{footer}</p> : null}
        </div>
      </div>
    </main>
  );
}
