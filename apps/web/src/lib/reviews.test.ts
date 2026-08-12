import { describe, expect, it } from "vitest";

import {
  MAX_IMAGE_BYTES,
  MAX_MEDIA_PER_REVIEW,
  MAX_VIDEO_BYTES,
  formatPlaytime,
  formatStars,
  isProcessing,
  isVideo,
  minutesToPlaytimeInput,
  playtimeToMinutes,
  rejectMedia,
  reviewPath,
  starFill,
  tally,
  toStars,
} from "./reviews";

function file(name: string, type: string, size: number): File {
  const handle = new File(["x"], name, { type });
  // File size is read-only, and building a real multi-megabyte blob in a unit
  // test would be slow for no extra coverage.
  Object.defineProperty(handle, "size", { value: size });
  return handle;
}

describe("ratings", () => {
  it("halves the stored value into stars", () => {
    // SPEC §6.3 stores 1-10 and displays 0.5-5.0.
    expect(toStars(10)).toBe(5);
    expect(toStars(7)).toBe(3.5);
    expect(toStars(1)).toBe(0.5);
  });

  it("keeps the trailing zero so a column lines up", () => {
    expect(formatStars(8)).toBe("4.0");
    expect(formatStars(7)).toBe("3.5");
  });

  it("fills whole stars before the partial one", () => {
    // A rating of 7 is 3.5 stars: three full, one half, one empty.
    expect([0, 1, 2, 3, 4].map((index) => starFill(7, index))).toEqual([1, 1, 1, 0.5, 0]);
  });

  it("never overfills or underfills a star", () => {
    expect(starFill(10, 4)).toBe(1);
    expect(starFill(1, 0)).toBe(0.5);
    expect(starFill(1, 4)).toBe(0);
  });
});

describe("formatPlaytime", () => {
  it("counts in hours, to one decimal", () => {
    expect(formatPlaytime(930)).toBe("15.5h");
    expect(formatPlaytime(120)).toBe("2h");
    expect(formatPlaytime(60)).toBe("1h");
  });

  it("stays in hours below an hour", () => {
    expect(formatPlaytime(45)).toBe("0.8h");
    expect(formatPlaytime(30)).toBe("0.5h");
  });

  it("stays in hours above a day, however large the figure gets", () => {
    // The whole point of the change: one unit at every scale, so two playtimes
    // can be compared without converting one of them first.
    expect(formatPlaytime(24 * 60)).toBe("24h");
    expect(formatPlaytime(25 * 60)).toBe("25h");
    expect(formatPlaytime(30_000)).toBe("500h");
  });

  it("floors a tracked session at 0.1h rather than rounding it to nothing", () => {
    // "0h" would say what null already says — that they did not track it.
    expect(formatPlaytime(5)).toBe("0.1h");
    expect(formatPlaytime(1)).toBe("0.1h");
  });

  it("is null when nothing was tracked", () => {
    // SPEC §6.3 makes playtime optional, and "0h" would claim they played none.
    expect(formatPlaytime(null)).toBeNull();
    expect(formatPlaytime(0)).toBeNull();
  });
});

describe("playtimeToMinutes", () => {
  it("converts typed hours into the minutes the API stores", () => {
    expect(playtimeToMinutes("15.5")).toBe(930);
    expect(playtimeToMinutes("2")).toBe(120);
    expect(playtimeToMinutes("1.25")).toBe(75);
  });

  it("rounds to a whole minute, because the API takes an integer", () => {
    expect(playtimeToMinutes("0.999")).toBe(60);
  });

  it("is null for anything that is not a positive number", () => {
    // All of these mean "not tracked", which the payload spells as null.
    expect(playtimeToMinutes("")).toBeNull();
    expect(playtimeToMinutes("0")).toBeNull();
    expect(playtimeToMinutes("-3")).toBeNull();
    expect(playtimeToMinutes("abc")).toBeNull();
  });
});

describe("minutesToPlaytimeInput", () => {
  it("prefills the edit form in hours", () => {
    expect(minutesToPlaytimeInput(930)).toBe("15.5");
    expect(minutesToPlaytimeInput(120)).toBe("2");
    expect(minutesToPlaytimeInput(75)).toBe("1.25");
  });

  it("is blank when there is nothing to edit", () => {
    expect(minutesToPlaytimeInput(null)).toBe("");
    expect(minutesToPlaytimeInput(0)).toBe("");
  });

  it("round-trips back to the minutes it came from", () => {
    for (const minutes of [1, 30, 45, 75, 120, 930, 30_000]) {
      expect(playtimeToMinutes(minutesToPlaytimeInput(minutes))).toBe(minutes);
    }
  });
});

describe("media state", () => {
  it("tells video apart from photos", () => {
    expect(isVideo({ type: "VIDEO" })).toBe(true);
    expect(isVideo({ type: "IMAGE" })).toBe(false);
  });

  it("treats only the unsettled states as processing", () => {
    expect(isProcessing({ processing_status: "PENDING" })).toBe(true);
    expect(isProcessing({ processing_status: "PROCESSING" })).toBe(true);
    expect(isProcessing({ processing_status: "READY" })).toBe(false);
    // A failed item still has its original to show, so the carousel renders it
    // rather than spinning forever.
    expect(isProcessing({ processing_status: "FAILED" })).toBe(false);
  });

  it("counts what a carousel holds", () => {
    expect(tally([{ isVideo: false }, { isVideo: true }, { isVideo: false }])).toEqual({
      images: 2,
      videos: 1,
    });
  });
});

describe("rejectMedia", () => {
  const empty = { images: 0, videos: 0 };

  it("accepts an ordinary photo", () => {
    expect(rejectMedia(file("shot.png", "image/png", 1000), empty)).toBeNull();
  });

  it("accepts a clip when there is not one already", () => {
    expect(rejectMedia(file("clip.mp4", "video/mp4", 1000), empty)).toBeNull();
  });

  it("refuses a second clip", () => {
    // SPEC §6.3 caps MVP at one video per review.
    expect(rejectMedia(file("clip.mp4", "video/mp4", 1000), { images: 0, videos: 1 })).toMatch(
      /one video clip/i,
    );
  });

  it("refuses an eleventh item", () => {
    const full = { images: MAX_MEDIA_PER_REVIEW, videos: 0 };

    expect(rejectMedia(file("shot.png", "image/png", 10), full)).toMatch(/at most 10/);
  });

  it("counts a clip towards the ten-item limit", () => {
    const full = { images: MAX_MEDIA_PER_REVIEW - 1, videos: 1 };

    expect(rejectMedia(file("shot.png", "image/png", 10), full)).toMatch(/at most 10/);
  });

  it("refuses an oversized photo", () => {
    expect(rejectMedia(file("big.png", "image/png", MAX_IMAGE_BYTES + 1), empty)).toMatch(/15 MB/);
  });

  it("refuses an oversized clip", () => {
    expect(rejectMedia(file("big.mp4", "video/mp4", MAX_VIDEO_BYTES + 1), empty)).toMatch(/100 MB/);
  });

  it("judges a clip by the video cap, not the photo one", () => {
    // The two caps differ, so picking the wrong one would refuse a legitimate
    // 20 MB clip.
    expect(rejectMedia(file("clip.mp4", "video/mp4", MAX_IMAGE_BYTES + 1), empty)).toBeNull();
  });
});

describe("reviewPath", () => {
  it("points at the detail screen", () => {
    expect(reviewPath("abc")).toBe("/reviews/abc");
  });
});
