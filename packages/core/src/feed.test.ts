import { describe, expect, it } from "vitest";

import type { FeedItem, ReviewSummary } from "@sidequestd/api-types";

import {
  FEED_PAGE_SIZE,
  RECOMMENDATION_LABELS,
  commentsPath,
  excerpt,
  feedItemKey,
  feedQuery,
  isActivityItem,
  isRecommendedItem,
  isReviewItem,
  recommendationLabel,
} from "./feed";

function reviewItem(id = "r1"): FeedItem {
  return {
    type: "review",
    id,
    occurred_at: "2026-03-01T12:00:00Z",
    review: { id } as ReviewSummary,
  };
}

function activityItem(id = "b1"): FeedItem {
  return {
    type: "backlog_activity",
    id,
    occurred_at: "2026-03-01T11:00:00Z",
    actor: { id: "u1", username: "ripley" },
    game: { id: "g1", title: "Hades" },
    status: "PLAYING",
  } as unknown as FeedItem;
}

function recommendedItem(id = "r9", reason = "recommended_game"): FeedItem {
  return {
    type: "recommended_review",
    id,
    occurred_at: "2026-03-01T10:00:00Z",
    review: { id } as ReviewSummary,
    reason,
  } as FeedItem;
}

describe("feedQuery", () => {
  it("asks for one page by default", () => {
    expect(feedQuery({})).toBe(`/feed?limit=${FEED_PAGE_SIZE}`);
  });

  it("passes a cursor through", () => {
    expect(feedQuery({ cursor: "abc123" })).toBe(`/feed?limit=${FEED_PAGE_SIZE}&cursor=abc123`);
  });

  it("escapes a cursor rather than pasting it into the URL", () => {
    // Cursors are base64url and safe today, but the encoding is the API's to
    // change and a query string is not the place to find that out.
    expect(feedQuery({ cursor: "a b+c/d" })).toContain("cursor=a+b%2Bc%2Fd");
  });

  it("takes a smaller page when asked", () => {
    expect(feedQuery({ limit: 3 })).toBe("/feed?limit=3");
  });
});

describe("isReviewItem", () => {
  it("recognises a review", () => {
    expect(isReviewItem(reviewItem())).toBe(true);
  });

  it("turns down an activity event", () => {
    expect(isReviewItem(activityItem())).toBe(false);
  });

  it("turns down a kind it has never seen", () => {
    // What the next thing SPEC §6.11 blends in looks like arriving at a client
    // built today: skipped, not rendered as a review.
    const unknown = { type: "achievement" } as unknown as FeedItem;

    expect(isReviewItem(unknown)).toBe(false);
  });
});

describe("isActivityItem", () => {
  it("recognises a backlog status change", () => {
    expect(isActivityItem(activityItem())).toBe(true);
  });

  it("turns down a review", () => {
    expect(isActivityItem(reviewItem())).toBe(false);
  });
});

describe("isRecommendedItem", () => {
  it("recognises a blended-in review", () => {
    expect(isRecommendedItem(recommendedItem())).toBe(true);
  });

  it("turns down a review from somebody the reader follows", () => {
    // The whole distinction SPEC §6.4 asks for: these two carry the identical
    // payload, and only the envelope says which one the reader chose.
    expect(isRecommendedItem(reviewItem())).toBe(false);
    expect(isReviewItem(recommendedItem())).toBe(false);
  });
});

describe("recommendationLabel", () => {
  it("explains a game the reader is likely to enjoy", () => {
    expect(recommendationLabel("recommended_game")).toMatch(/rated/i);
  });

  it("explains an author who rates the way the reader does", () => {
    expect(recommendationLabel("suggested_account")).toMatch(/rates like you/i);
  });

  it("has something to say for every reason the API can send", () => {
    // A missing entry renders `undefined` next to a stranger's review, which is
    // worse than no label at all.
    expect(Object.values(RECOMMENDATION_LABELS).every(Boolean)).toBe(true);
  });
});

describe("feedItemKey", () => {
  it("includes the kind, not only the id", () => {
    expect(feedItemKey(reviewItem("r1"))).toBe("review:r1");
  });

  it("separates two items that share an id", () => {
    expect(feedItemKey(reviewItem("r1"))).not.toBe(feedItemKey(activityItem("r1")));
  });

  it("keys an item it cannot read the inside of", () => {
    // The whole point of the envelope: an activity event has no `review`, and a
    // kind this build has never met has nothing at all — the list still has to
    // be able to render around both.
    const unknown = { type: "achievement", id: "a7" } as unknown as FeedItem;

    expect(feedItemKey(unknown)).toBe("achievement:a7");
    expect(feedItemKey(activityItem("b7"))).toBe("backlog_activity:b7");
  });
});

describe("commentsPath", () => {
  it("lands on the thread, not the top of the page", () => {
    expect(commentsPath("r1")).toBe("/reviews/r1#comments");
  });
});

describe("excerpt", () => {
  it("has nothing to show for a rating-only review", () => {
    expect(excerpt(null)).toBeNull();
  });

  it("treats whitespace as nothing", () => {
    expect(excerpt("   \n  ")).toBeNull();
  });

  it("leaves a short review alone", () => {
    expect(excerpt("One more run.")).toBe("One more run.");
  });

  it("does not promise more when the text already fits", () => {
    const exact = "x".repeat(20);

    expect(excerpt(exact, 20)).toBe(exact);
  });

  it("cuts on a word boundary", () => {
    const text = "the story is astonishing and the combat never once got old";

    const result = excerpt(text, 20);

    expect(result).toBe("the story is…");
  });

  it("cuts mid-word rather than throwing most of it away", () => {
    // A single long token has no boundary to fall back to, and "…" alone would
    // be a worse card than a clipped word.
    expect(excerpt("Supercalifragilisticexpialidocious", 10)).toBe("Supercalif…");
  });
});
