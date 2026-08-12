import { describe, expect, it } from "vitest";

import type { ProfileStats } from "@sidequestd/api-types";

import {
  MAX_FAVORITE_GAMES,
  avatarInitial,
  distributionHeights,
  formatAverageRating,
  formatCount,
  formatPlaytime,
  moveFavorite,
  profilePath,
  slotLabel,
  statTiles,
} from "./profile";

function stats(overrides: Partial<ProfileStats> = {}): ProfileStats {
  return {
    games_reviewed: 0,
    review_count: 0,
    average_rating: null,
    total_playtime_minutes: 0,
    completed_count: 0,
    backlog_count: 0,
    rating_distribution: Array.from({ length: 10 }, (_, index) => ({
      rating: index + 1,
      count: 0,
    })),
    member_since: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("avatarInitial", () => {
  it("prefers the display name", () => {
    expect(avatarInitial({ username: "ripley", display_name: "Ellen Ripley" })).toBe("E");
  });

  it("falls back to the handle", () => {
    expect(avatarInitial({ username: "ripley", display_name: null })).toBe("R");
  });

  it("ignores a whitespace-only display name", () => {
    expect(avatarInitial({ username: "ripley", display_name: "   " })).toBe("R");
  });
});

describe("profilePath", () => {
  it("points at the handle route", () => {
    expect(profilePath("ripley")).toBe("/profile/ripley");
  });
});

describe("formatCount", () => {
  it("separates thousands", () => {
    expect(formatCount(1204)).toBe("1,204");
  });
});

describe("formatAverageRating", () => {
  it("converts the stored 1-10 scale to stars", () => {
    expect(formatAverageRating(8)).toBe("4.0 / 5");
    expect(formatAverageRating(7)).toBe("3.5 / 5");
  });

  it("shows a dash rather than a zero when nothing is rated", () => {
    // SPEC §6.8: null means no ratings. "0.0 / 5" would read as a harsh critic.
    expect(formatAverageRating(null)).toBe("—");
    expect(formatAverageRating(undefined)).toBe("—");
  });
});

describe("formatPlaytime", () => {
  it.each([
    [0, "—"],
    [45, "45m"],
    [120, "2h"],
    [750, "12.5h"],
    // A profile sums every review, so this is the figure that gets large.
    [30_000, "20d 20h"],
  ])("formats %i minutes as %s", (minutes, expected) => {
    expect(formatPlaytime(minutes)).toBe(expected);
  });
});

describe("statTiles", () => {
  it("lists the SPEC §6.8 figures", () => {
    const labels = statTiles(stats()).map((tile) => tile.label);

    expect(labels).toEqual([
      "Reviews",
      "Games reviewed",
      "Average rating",
      "Playtime",
      "Completed",
      "Backlog",
    ]);
  });
});

describe("distributionHeights", () => {
  it("scales every bar against the tallest", () => {
    const distribution = stats().rating_distribution.map((entry) => ({
      ...entry,
      count: entry.rating === 9 ? 4 : entry.rating === 5 ? 2 : 0,
    }));

    const heights = distributionHeights(stats({ rating_distribution: distribution }));

    expect(heights[8]).toBe(100);
    expect(heights[4]).toBe(50);
    expect(heights[0]).toBe(0);
  });

  it("gives a flat baseline instead of dividing by zero", () => {
    expect(distributionHeights(stats())).toEqual(Array.from({ length: 10 }, () => 0));
  });
});

describe("slotLabel", () => {
  it("pads to two digits, so the numerals line up in a row", () => {
    expect(slotLabel(0)).toBe("01");
    expect(slotLabel(5)).toBe("06");
  });
});

describe("moveFavorite", () => {
  it("moves an item later and closes the gap behind it", () => {
    expect(moveFavorite(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item earlier", () => {
    expect(moveFavorite(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the list untouched when the move runs off either end", () => {
    // The first slot's "move left" and the last slot's "move right" both land
    // here, which is what lets them render as ordinary disabled buttons.
    const items = ["a", "b", "c"];
    expect(moveFavorite(items, 0, -1)).toEqual(items);
    expect(moveFavorite(items, 2, 3)).toEqual(items);
  });

  it("is a no-op when the item does not move", () => {
    const items = ["a", "b", "c"];
    expect(moveFavorite(items, 1, 1)).toEqual(items);
  });

  it("does not mutate the array it was given", () => {
    const items = ["a", "b", "c"];
    moveFavorite(items, 0, 2);
    expect(items).toEqual(["a", "b", "c"]);
  });

  it("keeps every item, because the API wants a permutation", () => {
    const moved = moveFavorite(["a", "b", "c", "d", "e", "f"], 4, 0);
    expect([...moved].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(moved).toHaveLength(MAX_FAVORITE_GAMES);
  });
});
