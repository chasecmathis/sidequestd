/**
 * What Sidequestd is, for someone who arrived without being told.
 *
 * The sentences are in `@sidequestd/core`'s `about.ts` — shared with the phone
 * for a weaker reason than the policy documents are, and that module says which.
 * The arrangement is this file's own: a numbered editorial band against a wide
 * measure, and the two-scores illustration as a two-column card. The phone
 * stacks both, from the same words.
 *
 * A server component — no `"use client"` — which is what lets it export
 * `metadata`. `AppShell` below it is a client component, and rendering one from
 * a server component is fine; it just means the shell's auth-dependent bits
 * hydrate as they do everywhere else. The shell already handles the signed-out
 * case, so this page works for a stranger following a link.
 *
 * The measure is `max-w-2xl` inside the shell's `max-w-5xl` main: this is the
 * first screen in the app that is mostly sentences, and a feed's width is far
 * too wide to read a paragraph across.
 */
import type { Metadata } from "next";
import Link from "next/link";

import {
  ABOUT_CONTACT,
  ABOUT_DATA_SOURCE,
  ABOUT_DESCRIPTION,
  ABOUT_DISCLAIMER_INDEX,
  ABOUT_INTRO,
  ABOUT_TITLE,
  APP_VERSION,
  EXAMPLE_IGDB,
  EXAMPLE_STARS,
  formatStars,
  HOW_IT_WORKS,
  igdbMeterFill,
  SITE_NAME,
  TWO_SCORES_CAVEAT,
  TWO_SCORES_LEAD,
  TWO_SCORES_OURS,
  TWO_SCORES_THEIRS,
} from "@sidequestd/core";

import { AppShell } from "@/components/app-shell";
import { Prose } from "@/components/prose";
import { StarRating } from "@/components/star-rating";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "About",
  description: `What ${SITE_NAME} is, how it works, and where its game data comes from.`,
};

export default function AboutPage() {
  return (
    <AppShell>
      <div className="max-w-2xl">
        <PageHeader eyebrow="About" title={ABOUT_TITLE} description={ABOUT_DESCRIPTION} />

        <section className="mt-16">
          <Eyebrow as="h2" rule>
            The idea
          </Eyebrow>
          {/* The container carries the type, so `Prose`'s bare `<p>`s inherit it
              — which is the same arrangement `prose-legal` makes on the policy
              pages, and why one renderer serves both without a variant. */}
          <div className="prose-inline mt-6 space-y-5 text-base leading-relaxed text-fg-dim">
            <Prose blocks={ABOUT_INTRO} />
          </div>
        </section>

        <section className="mt-16">
          <Eyebrow as="h2" rule>
            How it works
          </Eyebrow>
          <ul className="mt-8 space-y-8">
            {HOW_IT_WORKS.map((item) => (
              <li key={item.n} className="border-t border-line pt-5">
                <span className="type-eyebrow text-accent">{item.n}</span>
                <h3 className="type-display mt-3 text-2xl text-fg">{item.title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-fg-dim">{item.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16">
          <Eyebrow as="h2" rule>
            Two scores, not one
          </Eyebrow>
          <p className="mt-6 text-base leading-relaxed text-fg-dim">{TWO_SCORES_LEAD}</p>

          {/* Built from the same `StarRating` and `igdbMeterFill` the real
              component uses, rather than from a mock-up that approximates them.
              An explainer that renders something subtly unlike the thing it is
              explaining teaches the wrong picture, and this one would drift the
              first time the meter was restyled. */}
          <Card className="mt-6">
            <div className="grid divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="px-5 py-5">
                <Eyebrow>{SITE_NAME}</Eyebrow>
                <div className="mt-3 flex h-4 items-center gap-2">
                  <StarRating rating={EXAMPLE_STARS} size={15} />
                  <span className="type-eyebrow text-fg">{formatStars(EXAMPLE_STARS)}</span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-fg-dim">{TWO_SCORES_OURS}</p>
              </div>

              <div className="px-5 py-5">
                <Eyebrow>IGDB</Eyebrow>
                <div className="mt-3 flex h-4 items-center gap-3">
                  <span aria-hidden className="h-px flex-1 bg-line">
                    <span
                      className="block h-px bg-fg-dim"
                      style={{ width: `${igdbMeterFill(EXAMPLE_IGDB) * 100}%` }}
                    />
                  </span>
                  <span className="type-eyebrow text-fg">{EXAMPLE_IGDB}</span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-fg-dim">{TWO_SCORES_THEIRS}</p>
              </div>
            </div>
          </Card>

          <p className="mt-5 text-sm leading-relaxed text-fg-faint">{TWO_SCORES_CAVEAT}</p>
        </section>

        <section className="mt-16">
          <Eyebrow as="h2" rule>
            Where the game data comes from
          </Eyebrow>
          <div className="prose-inline mt-6 space-y-5 text-base leading-relaxed text-fg-dim">
            {/* Rendered a block at a time rather than in one call, because the
                affiliation line is a disclaimer rather than an explanation and
                is set one step dimmer than the two above it. */}
            {ABOUT_DATA_SOURCE.map((block, index) => (
              <div
                key={index}
                className={index === ABOUT_DISCLAIMER_INDEX ? "text-fg-faint" : undefined}
              >
                <Prose blocks={[block]} />
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16 border-t border-line pt-10">
          <Eyebrow as="h2">Get in touch</Eyebrow>
          <div className="prose-inline mt-5 space-y-5 text-base leading-relaxed text-fg-dim">
            <Prose blocks={ABOUT_CONTACT} />
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link href="/privacy" className={buttonStyles({ variant: "secondary", size: "sm" })}>
              Privacy
            </Link>
            <Link href="/terms" className={buttonStyles({ variant: "secondary", size: "sm" })}>
              Terms
            </Link>
          </div>

          <p className="type-eyebrow mt-8 text-fg-faint">Version {APP_VERSION}</p>
        </section>
      </div>
    </AppShell>
  );
}
