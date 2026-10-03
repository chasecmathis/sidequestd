"use client";

/**
 * A backlog status change, inline in Home (SPEC §6.4, §6.11).
 *
 * Deliberately a *line* and not a card. SPEC §6.11 says reviews are the hero
 * content and activity is "visually lighter-weight", and the difference has to be
 * legible at a glance or the feed reads as a wall of equally important things.
 * So: one row, small avatar, one sentence, a timestamp — and it never grows a
 * like button, because there is nothing here to like.
 *
 * With every review now sitting on a bordered surface, the lighter weight is
 * expressed by having no surface at all: this is a ruled line on the page
 * itself, indented past the cards it sits between.
 */
import Image from "next/image";
import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { activityVerb, profilePath, timeAgo } from "@sidequestd/core";

import type { FeedActivityItem } from "@sidequestd/api-types";

export function ActivityRow({ item }: { item: FeedActivityItem }) {
  const name = item.actor.display_name ?? item.actor.username;

  return (
    <article className="flex items-center gap-3 border-y border-line/60 px-4 py-3">
      <Link href={profilePath(item.actor.username)} className="shrink-0">
        <Avatar user={item.actor} size={24} />
      </Link>

      <p className="min-w-0 flex-1 text-sm leading-snug text-fg-dim">
        <Link href={profilePath(item.actor.username)} className="link-quiet font-medium text-fg">
          {name}
        </Link>{" "}
        <span>{activityVerb(item.status)}</span>{" "}
        <Link href={`/games/${item.game.id}`} className="link-quiet font-medium text-fg">
          {item.game.title}
        </Link>
      </p>

      {item.game.cover_url ? (
        <Link href={`/games/${item.game.id}`} className="shrink-0">
          <span className="relative block h-11 w-8 overflow-hidden rounded-sm border border-line bg-surface-2">
            <Image
              src={item.game.cover_url}
              alt={`${item.game.title} cover art`}
              fill
              sizes="32px"
              className="object-cover"
            />
          </span>
        </Link>
      ) : null}

      <time dateTime={item.occurred_at} className="type-eyebrow shrink-0 text-fg-faint">
        {timeAgo(item.occurred_at)}
      </time>
    </article>
  );
}
