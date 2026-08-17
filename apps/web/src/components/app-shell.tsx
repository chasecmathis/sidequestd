"use client";

/** Chrome for the signed-in surfaces: the nav from SPEC §5 plus a sign-out. */
import { motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  Compass,
  Home,
  LogOut,
  PenLine,
  Search,
  Settings,
  User,
  UserPlus,
  type LucideIcon,
} from "lucide-react";

import { Avatar } from "@/components/avatar";
import { SiteFooter } from "@/components/site-footer";
import { ThemeMenu } from "@/components/theme-toggle";
import { buttonStyles } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Wordmark } from "@/components/ui/wordmark";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { useDismissable } from "@/lib/use-dismissable";
import { NOTIFICATIONS_PATH, badgeAriaLabel, badgeLabel } from "@/lib/notifications";
import { useNotifications } from "@/lib/notifications-store";
import { profilePath } from "@/lib/profile";
import { FOLLOW_REQUESTS_PATH } from "@/lib/social";
import type { UserMe } from "@sidequestd/api-types";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** A number to render beside the label, or null when there is nothing to say. */
  badge?: string | null;
  /** Overrides the visible label out loud, for a tab whose label is incomplete. */
  ariaLabel?: string;
}

// SPEC §5 lists five tabs. Only these have screens so far; the rest arrive with
// their slices. Profile is appended below, since its href depends on the signed-in
// handle and there is nothing to link to when signed out.
const NAV: NavItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
];

/**
 * One nav destination, in both layouts.
 *
 * There is a single set of these links in the DOM, not one for the header and
 * another for a mobile bar — two would mean two elements answering to the name
 * "Notifications", which is ambiguous to a screen reader before it is ambiguous
 * to a test. So the *same* nodes are a bottom bar under `md` and a row in the
 * header above it, and the label goes `sr-only` on mobile because five mono caps
 * labels do not fit across 390px. The accessible name is identical either way.
 */
function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={item.ariaLabel}
      className={cn(
        "type-eyebrow relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5",
        "transition-colors duration-150 md:flex-none md:flex-row md:gap-2 md:px-1 md:py-1",
        active ? "text-fg" : "text-fg-faint hover:text-fg-dim",
      )}
    >
      {active ? (
        // Shared id: Motion tweens the orchid rule between tabs instead of
        // cutting, so the nav shows where you came from as well as where you are.
        <motion.span
          layoutId="nav-indicator"
          aria-hidden
          className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-accent md:inset-x-0 md:-bottom-2.5 md:top-auto md:h-px"
          transition={{ type: "spring", stiffness: 420, damping: 38 }}
        />
      ) : null}

      <span className="relative">
        <Icon aria-hidden strokeWidth={1.75} className="size-5 md:hidden" />
        {item.badge ? (
          // `aria-hidden`: the count is already in the link's own accessible
          // name, and reading it twice is worse than not reading it at all.
          <Badge
            tone="accent"
            aria-hidden
            className="absolute -right-2.5 -top-1.5 px-1 py-0.5 md:hidden"
          >
            {item.badge}
          </Badge>
        ) : null}
      </span>

      <span className="sr-only md:not-sr-only">{item.label}</span>

      {item.badge ? (
        <Badge tone="accent" aria-hidden className="hidden px-1 py-0.5 md:inline-flex">
          {item.badge}
        </Badge>
      ) : null}
    </Link>
  );
}

/**
 * Avatar, then the account actions behind it.
 *
 * A menu rather than a naked "Sign out" in the bar: signing out is the least
 * frequent thing anyone does here and it was taking the most prominent slot.
 * Closing on Escape and on an outside press are both handled, because a popover
 * that only closes by pressing its trigger again is a trap on touch.
 */
function UserMenu({ user, onSignOut }: { user: UserMe; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement | null>(null);

  useDismissable(
    open,
    container,
    useCallback(() => setOpen(false), []),
  );

  const items: { href: string; label: string; icon: LucideIcon }[] = [
    { href: profilePath(user.username), label: "Your profile", icon: User },
    { href: "/settings/profile", label: "Settings", icon: Settings },
  ];

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex rounded-full transition-opacity duration-150 hover:opacity-80"
      >
        <Avatar user={user} size={32} />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-pop"
        >
          <p className="truncate px-3 py-2 text-sm text-fg-dim">@{user.username}</p>
          <div aria-hidden className="my-1 h-px bg-line" />

          {items.map((item) => (
            <Link
              key={item.label}
              href={item.href ?? "#"}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-fg-dim transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
            >
              <item.icon aria-hidden strokeWidth={1.75} className="size-4" />
              {item.label}
            </Link>
          ))}

          <div aria-hidden className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-fg-dim transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
          >
            <LogOut aria-hidden strokeWidth={1.75} className="size-4" />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { unreadCount } = useNotifications();

  const nav: NavItem[] = [
    ...NAV,
    // Signed in only: there is no inbox to look at without an account, and the
    // badge would have nothing to count.
    ...(user
      ? [
          {
            href: NOTIFICATIONS_PATH,
            label: "Notifications",
            icon: Bell,
            badge: badgeLabel(unreadCount),
            // The count belongs in the accessible name rather than beside it —
            // a screen reader announcing "Notifications 3" reads the number as
            // part of the label anyway, and this says what the 3 means.
            ariaLabel: badgeAriaLabel(unreadCount),
          },
        ]
      : []),
    // Only a private account can accumulate requests — a public one is followed
    // without being asked (SPEC §6.7) — so the link would be a dead end for
    // everyone else. It appears the moment the account is switched to private.
    ...(user?.is_private
      ? [{ href: FOLLOW_REQUESTS_PATH, label: "Requests", icon: UserPlus }]
      : []),
    ...(user ? [{ href: profilePath(user.username), label: "Profile", icon: User }] : []),
  ];

  return (
    // A flex column so `main` can take the slack: on a short screen — an empty
    // feed, a 404 — the footer belongs at the bottom of the viewport rather than
    // floating halfway up it.
    <div className="flex min-h-screen flex-col">
      {/* Opaque rather than blurred. A backdrop-filter would make this element a
          containing block, and the nav inside it is `fixed` to the bottom of the
          viewport on mobile — it would anchor to the header instead. The solid
          bar is also the more editorial of the two. */}
      <header className="sticky top-0 z-40 border-b border-line bg-canvas">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-8 px-5 sm:px-6">
          <Link href="/" aria-label="Sidequestd home" className="shrink-0">
            <Wordmark />
          </Link>

          <nav
            aria-label="Main"
            className={cn(
              "fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-canvas",
              "pb-[env(safe-area-inset-bottom)]",
              "md:static md:border-t-0 md:bg-transparent md:pb-0 md:gap-7",
            )}
          >
            {nav.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              />
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            {/* Deliberately outside the `user ?` branches below: the theme is a
                device preference, and a signed-out visitor reading the landing
                page has as much right to it as anyone. */}
            <ThemeMenu />

            {user ? (
              <Link
                href="/reviews/new"
                className={buttonStyles({ variant: "primary", size: "sm" })}
              >
                <PenLine aria-hidden strokeWidth={2} className="size-4" />
                <span className="hidden sm:inline">Write a review</span>
                <span className="sr-only sm:hidden">Write a review</span>
              </Link>
            ) : null}

            {user ? (
              <UserMenu
                user={user}
                onSignOut={() => {
                  void logout().then(() => router.push("/login"));
                }}
              />
            ) : (
              <Link href="/login" className={buttonStyles({ variant: "secondary", size: "sm" })}>
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-16 pt-10 sm:px-6">{children}</main>

      {/* The tab-bar clearance lives here rather than on `main`.

          `main` used to carry `pb-28 md:pb-20`, because the mobile nav is
          `fixed inset-x-0 bottom-0` and would otherwise cover the last row of
          content. Now that something follows `main`, that padding would open a
          gap above the footer *and* leave the footer itself underneath the bar —
          so it moves to the last element on the page, which is what actually
          needs to clear it. Above `md` the nav is back in the header and only
          ordinary breathing room is left. */}
      <SiteFooter className="pb-28 md:pb-10" />
    </div>
  );
}
