import type { Metadata } from "next";
import { Figtree, Instrument_Serif, JetBrains_Mono } from "next/font/google";

import { MotionProvider } from "@/components/motion-provider";
import { AuthProvider } from "@/lib/auth";
import { BacklogProvider } from "@/lib/backlog-store";
import { NotificationsProvider } from "@/lib/notifications-store";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";

import "./globals.css";

/**
 * Three faces, self-hosted by next/font — no CDN request, no layout shift, and
 * the CSP-friendliness comes free. Each is exposed as a variable that
 * globals.css turns into a Tailwind family.
 */

/** Headlines only, >=28px. A high-contrast serif is unreadable as UI text. */
const instrumentSerif = Instrument_Serif({
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

/** Everything else. */
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

/** Micro-labels, ratings, counts, timestamps — anything that is data. */
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

/**
 * The defaults every route inherits.
 *
 * `title.template` is the part that earns its keep: a page exports
 * `title: "About"` and the tab reads "About · Sidequestd", so no route has to
 * remember to append the product name and none of them can disagree about the
 * separator. `metadataBase` resolves the relative URLs Next puts in the Open
 * Graph tags — without it they ship as paths, which no social card renderer
 * will follow.
 */
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${instrumentSerif.variable} ${figtree.variable} ${jetbrainsMono.variable}`}
    >
      <body>
        {/* Outside the providers: it configures animation, which is a property of
            the whole tree and has nothing to fetch. `reducedMotion="user"` is
            what lets every component below animate unconditionally — the
            preference is honoured once, here, rather than in each of them. */}
        <MotionProvider>
          <AuthProvider>
            {/* Inside the auth provider: the backlog is one account's, and it has
                nothing to fetch until there is a session to fetch it for. The
                unread badge is the same, and it is out here rather than in the
                app shell because it has to survive navigation between tabs. */}
            <BacklogProvider>
              <NotificationsProvider>{children}</NotificationsProvider>
            </BacklogProvider>
          </AuthProvider>
        </MotionProvider>
      </body>
    </html>
  );
}
