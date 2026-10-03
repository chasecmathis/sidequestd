import { describe, expect, it } from "vitest";

import type { ReviewInteractions } from "@sidequestd/api-types";

import {
  COMMENT_MAX_LENGTH,
  commentCountLabel,
  commentCounter,
  likeActionLabel,
  likeCountLabel,
  likeRequest,
  optimisticLike,
  ownsComment,
  rejectComment,
  timeAgo,
} from "./interactions";

function interactions(overrides: Partial<ReviewInteractions> = {}): ReviewInteractions {
  return {
    review_id: "r1",
    like_count: 3,
    comment_count: 1,
    viewer_has_liked: false,
    ...overrides,
  };
}

describe("likeRequest", () => {
  it("posts when there is no like yet", () => {
    expect(likeRequest(false, "r1")).toEqual({ path: "/reviews/r1/like", method: "POST" });
  });

  it("deletes when there is", () => {
    expect(likeRequest(true, "r1")).toEqual({ path: "/reviews/r1/like", method: "DELETE" });
  });
});

describe("likeActionLabel", () => {
  it("names the action rather than the state", () => {
    // The visible control is a heart and a number, which says nothing out loud.
    expect(likeActionLabel(false)).toBe("Like this review");
    expect(likeActionLabel(true)).toBe("Unlike this review");
  });
});

describe("optimisticLike", () => {
  it("fills the heart and adds one", () => {
    expect(optimisticLike(interactions())).toMatchObject({
      viewer_has_liked: true,
      like_count: 4,
    });
  });

  it("empties it and takes one away", () => {
    expect(optimisticLike(interactions({ viewer_has_liked: true }))).toMatchObject({
      viewer_has_liked: false,
      like_count: 2,
    });
  });

  it("never goes below zero", () => {
    // A count and a like state that arrived in separate responses can disagree
    // for a frame; "-1 likes" is a worse way to show that than a still number.
    const impossible = interactions({ like_count: 0, viewer_has_liked: true });

    expect(optimisticLike(impossible).like_count).toBe(0);
  });

  it("leaves the comment count alone", () => {
    expect(optimisticLike(interactions()).comment_count).toBe(1);
  });
});

describe("count labels", () => {
  it("says like and likes", () => {
    expect(likeCountLabel(0)).toBe("0 likes");
    expect(likeCountLabel(1)).toBe("1 like");
    expect(likeCountLabel(2)).toBe("2 likes");
  });

  it("says comment and comments", () => {
    expect(commentCountLabel(1)).toBe("1 comment");
    expect(commentCountLabel(4)).toBe("4 comments");
  });
});

describe("rejectComment", () => {
  it("accepts ordinary text", () => {
    expect(rejectComment("Astonishing.")).toBeNull();
  });

  it("refuses an empty box", () => {
    expect(rejectComment("")).toMatch(/write something/i);
  });

  it("refuses whitespace, which the API would strip to nothing", () => {
    expect(rejectComment("   \n  ")).toMatch(/write something/i);
  });

  it("refuses more than the API will take", () => {
    expect(rejectComment("x".repeat(COMMENT_MAX_LENGTH + 1))).toMatch(/500 characters/);
  });

  it("accepts exactly the limit", () => {
    expect(rejectComment("x".repeat(COMMENT_MAX_LENGTH))).toBeNull();
  });
});

describe("commentCounter", () => {
  it("stays out of the way until the cap is close", () => {
    // A counter on an empty box is noise; one that appears is a warning.
    expect(commentCounter("Astonishing.")).toBeNull();
  });

  it("appears as the limit approaches", () => {
    expect(commentCounter("x".repeat(450))).toBe("450 / 500");
  });
});

describe("ownsComment", () => {
  const comment = {
    author: {
      id: "u1",
      username: "hicks",
      display_name: null,
      bio: null,
      avatar_url: null,
      is_private: false,
      created_at: "2026-01-01T00:00:00Z",
    },
  };

  it("recognises your own", () => {
    expect(ownsComment(comment, "u1")).toBe(true);
  });

  it("does not offer edit on someone else's", () => {
    expect(ownsComment(comment, "u2")).toBe(false);
  });

  it("offers nothing when signed out", () => {
    expect(ownsComment(comment, undefined)).toBe(false);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-03-01T12:00:00Z");

  it("says just now for the last minute", () => {
    expect(timeAgo("2026-03-01T11:59:30Z", now)).toBe("just now");
  });

  it("counts minutes, hours and days", () => {
    expect(timeAgo("2026-03-01T11:30:00Z", now)).toBe("30m");
    expect(timeAgo("2026-03-01T08:00:00Z", now)).toBe("4h");
    expect(timeAgo("2026-02-27T12:00:00Z", now)).toBe("2d");
  });

  it("falls back to a date once relative stops meaning anything", () => {
    expect(timeAgo("2026-01-15T12:00:00Z", now)).toBe("Jan 15");
  });

  it("does not count backwards when a clock is ahead", () => {
    expect(timeAgo("2026-03-01T12:00:30Z", now)).toBe("just now");
  });
});
