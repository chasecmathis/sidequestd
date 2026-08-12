"use client";

/**
 * One person, in a list of people.
 *
 * Search results, followers and following all draw the same object — avatar,
 * handle, display name, something on the right — and were on their way to three
 * slightly different versions of it. This is the one.
 *
 * The link wraps the identity block and *not* the whole row, which is the part
 * worth stating: a row that is entirely a link cannot also contain an Unfollow
 * button, because an anchor inside an anchor is invalid and a button inside one
 * swallows the press. So the row is a flex container, the name is the link, and
 * the action sits beside it as a sibling.
 */
import Link from "next/link";
import type { ReactNode } from "react";

import { Avatar } from "@/components/avatar";
import { profilePath } from "@/lib/profile";
import type { UserPublic } from "@sidequestd/api-types";

type Subject = Pick<UserPublic, "username" | "display_name" | "avatar_url">;

export function UserRow({
  user,
  meta,
  action,
}: {
  user: Subject;
  /** Right-aligned detail — a review count, a "Private account" pill. */
  meta?: ReactNode;
  /** A control acting on this person. Rendered outside the link. */
  action?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0">
      <Link
        href={profilePath(user.username)}
        className="group flex min-w-0 flex-1 items-center gap-3.5"
      >
        <Avatar
          user={user}
          size={44}
          className="transition-colors duration-200 group-hover:border-line-strong"
        />

        <span className="min-w-0">
          <span className="link-quiet block truncate text-sm font-medium text-fg">
            @{user.username}
          </span>
          {user.display_name ? (
            <span className="mt-1 block truncate text-sm text-fg-dim">{user.display_name}</span>
          ) : null}
        </span>
      </Link>

      {meta ? <div className="type-eyebrow shrink-0 text-right text-fg-faint">{meta}</div> : null}
      {action ? <div className="shrink-0">{action}</div> : null}
    </li>
  );
}

/**
 * The container the rows sit in.
 *
 * Hairline-ruled rather than a stack of cards: a list of forty people reads as a
 * directory, and forty separate bordered blocks is forty things to look at
 * instead of one.
 */
export function UserList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="overflow-hidden rounded-lg border border-line bg-surface">
      {children}
    </ul>
  );
}
