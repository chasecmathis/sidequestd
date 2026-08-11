import { describe, expect, it } from "vitest";

import type { ProfileStats } from "@sidequestd/api-types";

import {
  avatarInitial,
  distributionHeights,
  formatAverageRating,
  formatCount,
  formatPlaytime,
  profilePath,
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
