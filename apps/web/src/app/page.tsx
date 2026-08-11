"use client";

/**
 * The landing page — the one screen in the app that is allowed to be loud.
 *
 * Everywhere else the chrome recedes so cover art and reviews can lead. Here
 * there is no content yet, so the typography *is* the content: one headline set
 * as large as the viewport will take, revealed a word at a time, over a canvas
 * that is otherwise empty on purpose.
 *
 * The reveal is `motion` rather than CSS keyframes because the stagger reads off
 * an index, and `MotionConfig reducedMotion="user"` at the root already turns
 * the whole thing off for anyone who asked — a hand-rolled keyframe would need
 * its own media query to be as well behaved.
 */
import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { buttonStyles } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { useAuth } from "@/lib/auth";

/** The headline, split so each word can arrive on its own beat. */
const HEADLINE = [
  { text: "Every", italic: false },
  { text: "game", italic: false },
  { text: "you've", italic: false },
  { text: "played,", italic: false },
  { text: "written", italic: true },
  { text: "down.", italic: true },
];

const PITCH = [
  {
    n: "01",
    title: "Log it",
    body: "Rate out of five with half stars, write as much or as little as you want, and attach the screenshots you actually took.",
  },
  {
    n: "02",
    title: "Follow it",
    body: "A feed of the people you follow — their reviews first, their backlog moves woven in between, newest at the top.",
  },
  {
    n: "03",
    title: "Track it",
    body: "Four lists that do not need managing: to be played, playing, completed, dropped. A game sits on exactly one.",
  },
];

export default function LandingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (!isLoading && user) router.replace("/home");
  }, [isLoading, user, router]);

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Two flat layers behind everything: a hairline grid that gives the empty
          canvas a measure, masked out toward the bottom so the page does not
          look tiled, and one orchid bloom off to the left. Both are CSS — no
          image request stands between a first-time visitor and the headline. */}
      <div
        aria-hidden
        // Held at 30%: `--color-line` sits further from the canvas in the violet
        // palette than it did in the warm one, and at full strength the grid
        // stops being a measure and starts competing with the headline.
        className="pointer-events-none absolute inset-0 opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #282634 1px, transparent 1px), linear-gradient(to bottom, #282634 1px, transparent 1px)",
          backgroundSize: "88px 88px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-52 -top-40 size-[44rem] rounded-full bg-accent/8 blur-[140px]"
      />

      <div className="relative mx-auto w-full max-w-5xl px-6">
        <header className="flex h-20 items-center justify-between">
          <span className="flex items-center gap-2.5">
            <span aria-hidden className="size-2 shrink-0 rounded-[1px] bg-accent" />
            <span className="type-display text-xl">
              Side<span className="italic text-fg-dim">questd</span>
            </span>
          </span>
          <Link href="/login" className={buttonStyles({ variant: "ghost", size: "sm" })}>
            Sign in
          </Link>
        </header>

        <section className="flex min-h-[calc(100vh-5rem)] flex-col justify-center pb-24 pt-10">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <Eyebrow>Reviews · Feed · Backlog</Eyebrow>
          </motion.div>

          {/* `clamp` rather than breakpoints: the headline is the page, and it
              should be exactly as large as the viewport can carry at every width
              in between, not at three of them. */}
          <h1
            className="type-display mt-8 max-w-4xl text-fg"
            style={{ fontSize: "clamp(3rem, 9vw, 6.5rem)" }}
          >
            {HEADLINE.map((word, index) => (
              <motion.span
                key={word.text}
                // `inline-block` is what makes the y-offset possible: an inline
                // span cannot be transformed.
                className={`mr-[0.22em] inline-block ${word.italic ? "italic text-fg-dim" : ""}`}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18 + index * 0.07, duration: 0.7 }}
              >
                {word.text}
              </motion.span>
            ))}
          </h1>

          <motion.p
            className="mt-9 max-w-xl text-base leading-relaxed text-fg-dim"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.72, duration: 0.6 }}
          >
            Letterboxd for video games, with an Instagram-style social feed. Log what you play, rate
            it, and see what your friends are into.
          </motion.p>

          <motion.div
            className="mt-11 flex flex-wrap items-center gap-3"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.84, duration: 0.6 }}
          >
            <Link href="/register" className={buttonStyles({ variant: "primary", size: "lg" })}>
              Create an account
              <ArrowRight aria-hidden strokeWidth={2} className="size-4" />
            </Link>
            <Link href="/login" className={buttonStyles({ variant: "secondary", size: "lg" })}>
              Sign in
            </Link>
          </motion.div>
        </section>

        {/* The three things the product does, set as a numbered editorial band.
            Mono numerals over a rule on each column — the same device the section
            eyebrows use everywhere else in the app. */}
        <section className="border-t border-line pb-28 pt-16">
          <ul className="grid gap-10 sm:grid-cols-3 sm:gap-8">
            {PITCH.map((item, index) => (
              <motion.li
                key={item.n}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: index * 0.08, duration: 0.6 }}
                className="border-t border-line pt-5"
              >
                <span className="type-eyebrow text-accent">{item.n}</span>
                <h2 className="type-display mt-4 text-2xl text-fg">{item.title}</h2>
                <p className="mt-3 text-sm leading-relaxed text-fg-dim">{item.body}</p>
              </motion.li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
