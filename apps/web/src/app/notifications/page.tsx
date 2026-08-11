"use client";

/**
 * Notifications — SPEC §6.12.
 *
 * One list, read and unread together, with the unread ones marked rather than
 * separated. SPEC §6.12 asks for read *state*, not two tabs, and a history you
 * can scroll back through is worth more than an inbox that empties itself.
 *
 * Opening the tab deliberately does **not** mark anything read. Instagram-style
 * products do, and it is the thing people complain about: you glance at a badge,
 * the list clears, and whatever you meant to come back to is gone. So marking is
 * a press — on one row, or on "Mark all read" — and the badge only moves when
 * the reader moved it.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { BellOff } from "lucide-react";

import { AppShell } from "@/components/app-shell";
import { Avatar } from "@/components/avatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { timeAgo } from "@/lib/interactions";
import {
  NOTIFICATIONS_PAGE_SIZE,
  notificationHref,
  notificationText,
  unreadIds,
} from "@/lib/notifications";
import { useNotifications } from "@/lib/notifications-store";
import { profilePath } from "@/lib/profile";
import type { NotificationItem, NotificationPage } from "@sidequestd/api-types";

function Row({ item, onMarkRead }: { item: NotificationItem; onMarkRead: (id: string) => void }) {
  const name = item.actor?.display_name ?? item.actor?.username ?? "Someone";
  const href = notificationHref(item);
  const text = notificationText(item);

  return (
    <li
      className={`flex items-center gap-3.5 border-b border-line px-4 py-4 last:border-b-0 ${
        // The whole row rather than a dot: unread is the state of the
        // notification, not a decoration attached to one corner of it. The
        // orchid rule on the leading edge is the accent used as a *border*,
        // which is what the palette allows and what a coloured row would not be.
        item.is_read ? "" : "border-l-2 border-l-accent bg-surface"
      }`}
    >
      {item.actor ? (
        <Link href={profilePath(item.actor.username)} className="shrink-0">
          <Avatar user={item.actor} size={40} />
        </Link>
      ) : null}

      <p className="min-w-0 flex-1 text-sm leading-snug text-fg-dim">
        {/* Two links side by side rather than one wrapping the other: the name
            goes to the person and the rest of the sentence goes to the thing
            that happened, and an anchor inside an anchor is invalid markup that
            no browser agrees on how to resolve. */}
        {item.actor ? (
          <Link href={profilePath(item.actor.username)} className="link-quiet font-medium text-fg">
            {name}
          </Link>
        ) : (
          <span className="font-medium">{name}</span>
        )}{" "}
        {href ? (
          <Link href={href} className="link-quiet">
            {text}
          </Link>
        ) : (
          text
        )}
        {item.comment ? (
          <span className="mt-1 block truncate border-l border-line pl-2.5 text-xs italic text-fg-faint">
            “{item.comment.text}”
          </span>
        ) : null}
      </p>

      <time
        dateTime={item.created_at}
        className="type-eyebrow shrink-0 text-fg-faint"
        suppressHydrationWarning
      >
        {timeAgo(item.created_at)}
      </time>

      {item.is_read ? null : (
        <button
          type="button"
          onClick={() => onMarkRead(item.id)}
          aria-label={`Mark as read: ${name} ${text}`}
          className="type-eyebrow shrink-0 rounded-md border border-line px-2.5 py-2 text-fg-dim transition-colors duration-150 hover:border-line-strong hover:text-fg"
        >
          Mark read
        </button>
      )}
    </li>
  );
}

export default function NotificationsPage() {
  const router = useRouter();
  const { user, isLoading, authedRequest } = useAuth();
  const { unreadCount, markRead } = useNotifications();

  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login");
  }, [isLoading, user, router]);

  useEffect(() => {
    if (isLoading || !user) return;

    let cancelled = false;
    authedRequest<NotificationPage>(`/notifications?limit=${NOTIFICATIONS_PAGE_SIZE}`)
      .then((page) => {
        if (!cancelled) setItems(page.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load your notifications.");
        }
      });
    return () => {
      cancelled = true;
    };
    // Keyed on the id for the same reason the requests screen is: the session
    // object is replaced whenever anything about it changes, and refetching on
    // each of those would flicker a list somebody is reading.
  }, [authedRequest, isLoading, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function mark(ids?: string[]) {
    setPending(true);
    setError(null);
    try {
      await markRead(ids);
      // Marked locally rather than refetched: the rows have not changed, only
      // their state has, and re-reading the page would reorder nothing and cost
      // a request. `ids` undefined is "all", which is every row on the page.
      setItems((current) =>
        (current ?? []).map((item) =>
          ids === undefined || ids.includes(item.id) ? { ...item, is_read: true } : item,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn't work. Try again.");
    } finally {
      setPending(false);
    }
  }

  const onPage = unreadIds(items ?? []);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl">
        <PageHeader
          eyebrow="Activity"
          title="Notifications"
          description={
            unreadCount > 0
              ? `${unreadCount} unread. Opening this tab doesn't clear them.`
              : "You're all caught up."
          }
          action={
            onPage.length > 0 ? (
              <Button size="sm" disabled={pending} onClick={() => void mark()}>
                Mark all read
              </Button>
            ) : null
          }
        />

        <div className="mt-8">
          {error ? <Alert tone="error">{error}</Alert> : null}

          {items === null ? (
            <ListSkeleton label="Loading notifications" />
          ) : items.length > 0 ? (
            <ul
              aria-label="Notifications"
              className="overflow-hidden rounded-lg border border-line bg-surface/40"
            >
              {items.map((item) => (
                <Row key={item.id} item={item} onMarkRead={(id) => void mark([id])} />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={BellOff}
              description="Nothing yet. Follows, likes and comments on your reviews show up here."
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
