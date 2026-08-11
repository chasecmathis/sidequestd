import { describe, expect, it } from "vitest";

import type { GameSummary, NotificationItem, NotificationType } from "@sidequestd/api-types";

import {
  badgeAriaLabel,
  badgeLabel,
  notificationHref,
  notificationText,
  unreadIds,
} from "./notifications";

const NOTIFICATION_TYPES: NotificationType[] = [
  "NEW_FOLLOWER",
  "FOLLOW_REQUEST",
  "FOLLOW_REQUEST_APPROVED",
  "REVIEW_LIKED",
  "REVIEW_COMMENTED",
  "COMMENT_REPLIED",
  "BACKLOG_GAME_REVIEWED",
];

function game(title = "Hades"): GameSummary {
  return {
    id: "g1",
    slug: title.toLowerCase(),
    title,
    cover_url: null,
    release_date: "2020-09-17",
    release_year: 2020,
    platforms: [],
  };
}

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n1",
    type: "NEW_FOLLOWER",
    actor: {
      id: "u1",
      username: "ripley",
      display_name: "Ellen Ripley",
      bio: null,
      avatar_url: null,
      is_private: false,
      created_at: "2026-01-01T00:00:00Z",
    },
    review: null,
    comment: null,
    is_read: false,
    created_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

describe("notificationText", () => {
  it("reads as the rest of a sentence about the actor", () => {
    expect(notificationText(item({ type: "NEW_FOLLOWER" }))).toBe("started following you");
    expect(notificationText(item({ type: "FOLLOW_REQUEST" }))).toBe("asked to follow you");
  });

  it("names the game a review notification is about", () => {
    const liked = item({ type: "REVIEW_LIKED", review: { id: "r1", game: game() } });

    expect(notificationText(liked)).toBe("liked your review of Hades");
  });

  it("distinguishes a review of a backlogged game from a like on your own", () => {
    const reviewed = item({
      type: "BACKLOG_GAME_REVIEWED",
      review: { id: "r1", game: game("Elden Ring") },
    });

    // Not "your review": the review is theirs, the *list* is yours.
    expect(notificationText(reviewed)).toBe("reviewed Elden Ring, which is on your list");
  });

  it("still says something true when the target has been deleted", () => {
    // A review can be deleted after the notification about it was written; the
    // row is still in somebody's history and must not read "review of undefined".
    expect(notificationText(item({ type: "REVIEW_LIKED", review: null }))).toBe(
      "liked your review",
    );
  });

  it("has a phrase for every type, so no notification renders as a blank", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(notificationText(item({ type }))).not.toBe("");
    }
  });
});

describe("notificationHref", () => {
  it("sends a comment or reply into the thread", () => {
    const replied = item({
      type: "COMMENT_REPLIED",
      review: { id: "r1", game: game() },
      comment: { id: "c1", review_id: "r1", text: "Agreed." },
    });

    // The comment wins over the review it belongs to: a reply is only findable
    // in the thread, and the review alone would land above it.
    expect(notificationHref(replied)).toBe("/reviews/r1#comments");
  });

  it("sends a like to the review", () => {
    const liked = item({ type: "REVIEW_LIKED", review: { id: "r1", game: game() } });

    expect(notificationHref(liked)).toBe("/reviews/r1");
  });

  it("sends a follow to the person who did it", () => {
    expect(notificationHref(item({ type: "NEW_FOLLOWER" }))).toBe("/profile/ripley");
  });

  it("has nowhere to go when there is neither a target nor an actor", () => {
    expect(notificationHref(item({ actor: null }))).toBeNull();
  });
});

describe("badgeLabel", () => {
  it("shows nothing when nothing is unread", () => {
    expect(badgeLabel(0)).toBeNull();
    // Defensive: a count can only be negative if something went wrong, and a
    // badge reading "-1" would be a worse way to show it than no badge.
    expect(badgeLabel(-3)).toBeNull();
  });

  it("caps at 99+, because the dot is not as wide as the number", () => {
    expect(badgeLabel(7)).toBe("7");
    expect(badgeLabel(99)).toBe("99");
    expect(badgeLabel(100)).toBe("99+");
  });
});

describe("badgeAriaLabel", () => {
  it("says what the number means, since the badge itself does not", () => {
    expect(badgeAriaLabel(0)).toBe("Notifications");
    expect(badgeAriaLabel(3)).toBe("Notifications, 3 unread");
  });

  it("does not cap out loud — a screen reader has room for the real number", () => {
    expect(badgeAriaLabel(140)).toBe("Notifications, 140 unread");
  });
});

describe("unreadIds", () => {
  it("names only the ones still unread", () => {
    const rows = [
      item({ id: "a", is_read: false }),
      item({ id: "b", is_read: true }),
      item({ id: "c", is_read: false }),
    ];

    expect(unreadIds(rows)).toEqual(["a", "c"]);
  });

  it("is empty for a page that has been read", () => {
    expect(unreadIds([item({ is_read: true })])).toEqual([]);
  });
});
