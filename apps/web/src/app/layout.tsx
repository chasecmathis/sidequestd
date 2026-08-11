import type { Metadata } from "next";
import { Figtree, Instrument_Serif, JetBrains_Mono } from "next/font/google";

import { MotionProvider } from "@/components/motion-provider";
import { AuthProvider } from "@/lib/auth";
import { BacklogProvider } from "@/lib/backlog-store";
import { NotificationsProvider } from "@/lib/notifications-store";

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

export const metadata: Metadata = {
  title: "Sidequestd",
  description: "Letterboxd for video games with an Instagram-style social feed.",
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
