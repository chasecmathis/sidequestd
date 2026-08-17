/**
 * What Sidequestd is, for someone who arrived without being told.
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

import { AppShell } from "@/components/app-shell";
import { StarRating } from "@/components/star-rating";
import { buttonStyles } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Eyebrow } from "@/components/ui/eyebrow";
import { PageHeader } from "@/components/ui/page-header";
import { igdbMeterFill } from "@/lib/catalog";
import { formatStars } from "@/lib/reviews";
import { APP_VERSION, CONTACT_EMAIL, IGDB_URL, SITE_NAME } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: `What ${SITE_NAME} is, how it works, and where its game data comes from.`,
};

/** The five things the product does, as a numbered editorial band. */
const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Log it",
    body: "Rate out of five with half stars, write as much or as little as you want, and attach the screenshots you actually took. One review per game, editable forever — the record is meant to be revised when you change your mind.",
  },
  {
    n: "02",
    title: "Follow it",
    body: "A feed of the people you follow: their reviews first, their backlog moves woven in between, newest at the top. No ranking, no suggested posts from strangers.",
  },
  {
    n: "03",
    title: "Track it",
    body: "Four lists that do not need managing — to be played, playing, completed, dropped. A game sits on exactly one of them, so moving it is the whole interaction.",
  },
  {
    n: "04",
    title: "Find it",
    body: "Trending is computed from real activity over a rolling seven-day window, not from what a publisher paid for. Browse by genre and platform, or take the recommendations built from the games you called favourites.",
  },
  {
    n: "05",
    title: "Keep it to yourself",
    body: "Accounts can be private. Then your reviews, stats and lists are visible only to followers you approved, and that is enforced on the server for every request — not hidden in the interface.",
  },
];

/**
 * The numbers in the "two scores" illustration.
 *
 * `EXAMPLE_STARS` is on the stored 1–10 scale that `StarRating` and
 * `formatStars` both take, not the 0–5 a reader sees — 5 renders as 2.5. Picked
 * to disagree loudly with the IGDB figure beside it, because a pair that agreed
 * would illustrate nothing.
 */
const EXAMPLE_STARS = 5;
const EXAMPLE_IGDB = 87;

export default function AboutPage() {
  return (
    <AppShell>
      <div className="max-w-2xl">
        <PageHeader
          eyebrow="About"
          title="What Sidequestd is"
          description="A place to write down every game you play, and to see what the people you follow are playing."
        />

        <section className="mt-16">
          <Eyebrow as="h2" rule>
            The idea
          </Eyebrow>
          <div className="mt-6 space-y-5 text-base leading-relaxed text-fg-dim">
            <p>
              You put eighty hours into a game, and a year later all that is left is a vague sense
              that it was good. The screenshots are in a folder you never open. The opinion you
              actually had — the sharp, specific one, the week you finished it — is gone.
            </p>
            <p>
              {SITE_NAME} is the record. You rate a game, you write down what you thought, you
              attach the screenshots you took at the time, and it stays. The rating is the cheap
              part; the sentence you wrote the week you finished something is the part you will be
              glad about later.
            </p>
            <p>
              And it is social, because playing is. What you see is the people you chose to follow,
              in the order they posted, with their own screenshots — not press assets, not key art,
              not a stranger&apos;s take promoted into your day.
            </p>
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
          <p className="mt-6 text-base leading-relaxed text-fg-dim">
            Every game page shows two numbers, and they measure different things. The stars are the{" "}
            {SITE_NAME} average — what members here rated it, out of five. The 0–100 meter is
            IGDB&apos;s, aggregated from a much larger and much broader pool.
          </p>

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
                <p className="mt-4 text-sm leading-relaxed text-fg-dim">
                  Members here, out of five. A smaller and more opinionated group.
                </p>
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
                <p className="mt-4 text-sm leading-relaxed text-fg-dim">
                  Everyone, out of a hundred. Broader, and slower to move.
                </p>
              </div>
            </div>
          </Card>

          <p className="mt-5 text-sm leading-relaxed text-fg-faint">
            An example, not a real game. The two disagree often, and that is the point of showing
            both — a game the wider world rates {EXAMPLE_IGDB} and the people you follow rate two
            stars is telling you something neither number would on its own.
          </p>
        </section>

        <section className="mt-16">
          <Eyebrow as="h2" rule>
            Where the game data comes from
          </Eyebrow>
          <div className="mt-6 space-y-5 text-base leading-relaxed text-fg-dim">
            <p>
              Titles, cover art, release dates, genres, platforms and the 0–100 rating all come from{" "}
              <a href={IGDB_URL} target="_blank" rel="noreferrer" className="link text-fg">
                IGDB
              </a>
              , the games database. The catalog is synced on a schedule and cached here so that
              browsing does not depend on a live third-party call, and trending is recomputed from
              activity on this site rather than fetched.
            </p>
            <p>
              Cover images are served directly from IGDB&apos;s own image CDN. Ratings are shown as
              IGDB reports them and are not adjusted.
            </p>
            <p className="text-fg-faint">
              {SITE_NAME} is not affiliated with, endorsed by, or sponsored by IGDB or Twitch.
            </p>
          </div>
        </section>

        <section className="mt-16 border-t border-line pt-10">
          <Eyebrow as="h2">Get in touch</Eyebrow>
          <p className="mt-5 text-base leading-relaxed text-fg-dim">
            {SITE_NAME} is an independent project, not a company. Bugs, requests, and anything about
            your account or your data go to{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="link text-fg">
              {CONTACT_EMAIL}
            </a>
            .
          </p>

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
