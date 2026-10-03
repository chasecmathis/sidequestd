/**
 * The footer, on every surface except the auth screens.
 *
 * Three jobs, in order of why it exists:
 *
 * 1. **Credit IGDB.** The catalog, the cover art and the 0–100 rating all come
 *    from there, the images are served from their CDN, and until now the app
 *    said so nowhere. Their API terms ask for attribution and it was simply
 *    missing. A footer on every page is the conventional place for it.
 * 2. Reach the pages that make a project look like it is run by somebody —
 *    About, and the two policies.
 * 3. Say which version you are looking at, which is the first question worth
 *    asking when someone reports something odd.
 *
 * Deliberately **hook-free and without a `"use client"` directive**, so the same
 * component renders inside `AppShell` (a client component) and directly inside
 * the server-rendered static pages. The moment this reaches for `useAuth` to
 * vary its links it stops being usable from a server component, so it does not:
 * every destination below is one that a signed-out visitor can also follow.
 */
import Link from "next/link";

import { APP_VERSION, IGDB_URL, SITE_NAME, SITE_TAGLINE } from "@sidequestd/core";

import { Eyebrow } from "@/components/ui/eyebrow";
import { Wordmark } from "@/components/ui/wordmark";
import { cn } from "@/lib/cn";

interface FooterLink {
  href: string;
  label: string;
}

// "Write a review" is pointedly absent: it is the one destination here that
// bounces a signed-out visitor to /login, and a footer that renders identically
// for everyone should not contain a link that only works for half of them.
const EXPLORE: FooterLink[] = [
  { href: "/home", label: "Home" },
  { href: "/discover", label: "Discover" },
  { href: "/search", label: "Search" },
];

const ABOUT: FooterLink[] = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <Eyebrow as="h2">{title}</Eyebrow>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="link-quiet text-sm text-fg-dim transition-colors duration-150 hover:text-fg"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn("border-t border-line", className)}>
      <div className="mx-auto w-full max-w-5xl px-5 pt-12 sm:px-6">
        {/* The brand column is given roughly half again the width of a link
            column, because it carries a sentence and they carry single words. */}
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1.5fr] md:gap-8">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-[26ch] text-sm leading-relaxed text-fg-dim">{SITE_TAGLINE}</p>
            <p className="mt-3 text-sm text-fg-faint">An independent project.</p>
          </div>

          <FooterColumn title="Explore" links={EXPLORE} />
          <FooterColumn title="About" links={ABOUT} />

          <div>
            <Eyebrow as="h2">Game data</Eyebrow>
            <p className="mt-4 text-sm leading-relaxed text-fg-dim">
              Game titles, cover art, release dates and the 0–100 rating come from{" "}
              <a href={IGDB_URL} target="_blank" rel="noreferrer" className="link text-fg">
                IGDB
              </a>
              . {SITE_NAME} is not affiliated with IGDB or Twitch.
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line py-6">
          <p className="type-eyebrow text-fg-faint">
            © {new Date().getFullYear()} {SITE_NAME}
          </p>
          <p className="type-eyebrow text-fg-faint">v{APP_VERSION}</p>
        </div>
      </div>
    </footer>
  );
}
