import { describe, expect, it } from "vitest";

import {
  callbackMessage,
  canSyncNow,
  cooldownLabel,
  formatGameCount,
  formatLibraryPlaytime,
  formatSyncedAt,
  formatTotalPlaytime,
  matchedLabel,
  playtimeSuggestionValue,
  providerLabel,
  syncNotice,
} from "@/lib/connections";
import { playtimeToMinutes } from "@/lib/reviews";
import type { LinkedAccount } from "@sidequestd/api-types";

function account(overrides: Partial<LinkedAccount> = {}): LinkedAccount {
  return {
    provider: "STEAM",
    provider_account_id: "76561197960287930",
    provider_username: "ada",
    provider_avatar_url: null,
    profile_url: null,
    is_visible: true,
    connected_at: "2026-08-01T00:00:00Z",
    last_synced_at: null,
    last_sync_status: null,
    sync_cooldown_minutes: 0,
    total_games: 0,
    matched_games: 0,
    total_playtime_minutes: 0,
    ...overrides,
  };
}

describe("playtime formatting", () => {
  it("uses the same format as a review's playtime", () => {
    // Two different spellings of the same number on one screen would read as two
    // different measurements.
    expect(formatLibraryPlaytime(930)).toBe("15.5h");
  });

  it("drops the decimal on a library total", () => {
    // One decimal on four figures is false precision on a number that moves
    // whenever the member plays anything.
    expect(formatTotalPlaytime(77_040)).toBe("1,284h");
  });

  it("counts games in words a person would use", () => {
    expect(formatGameCount(1)).toBe("1 game");
    expect(formatGameCount(1200)).toBe("1,200 games");
  });
});

describe("the composer suggestion", () => {
  it("round-trips through the field it fills", () => {
    // The suggestion is shown as hours and saved as minutes by a different
    // function. If these two disagree, accepting the suggestion and pressing
    // save stores a number the member was never shown.
    const suggested = playtimeSuggestionValue(930);

    expect(suggested).toBe("15.5");
    expect(playtimeToMinutes(suggested)).toBe(930);
  });

  it("does not round a real session down to nothing", () => {
    expect(playtimeSuggestionValue(6)).toBe("0.1");
  });
});

describe("sync state", () => {
  it("says nothing when the last sync was fine", () => {
    // A screen that congratulates you every time you open it is noise.
    expect(syncNotice("OK")).toBeNull();
    expect(syncNotice(null)).toBeNull();
  });

  it("turns a private Steam profile into steps rather than an apology", () => {
    const notice = syncNotice("PROFILE_PRIVATE");

    expect(notice?.tone).toBe("error");
    // The whole reason the API distinguishes this from FAILED: it is the one
    // outcome the member can fix, and the fix is a specific Steam setting.
    expect(notice?.steps.join(" ")).toContain("Game details");
    expect(notice?.steps.length).toBeGreaterThan(1);
  });

  it("does not invent steps for an outage nobody can act on", () => {
    expect(syncNotice("FAILED")?.steps).toEqual([]);
  });

  it("reports a library that has never been read", () => {
    expect(formatSyncedAt(null)).toBe("Not synced yet");
  });
});

describe("the sync cooldown", () => {
  it("lets a fresh link sync straight away", () => {
    expect(canSyncNow(account())).toBe(true);
    expect(cooldownLabel(account())).toBe("Sync now");
  });

  it("says when the button will work again", () => {
    const cooling = account({ sync_cooldown_minutes: 42 });

    expect(canSyncNow(cooling)).toBe(false);
    expect(cooldownLabel(cooling)).toBe("Sync again in 42 minutes");
  });

  it("does not say '1 minutes'", () => {
    expect(cooldownLabel(account({ sync_cooldown_minutes: 1 }))).toBe("Sync again in a minute");
  });
});

describe("the catalog match count", () => {
  it("explains the gap between a library and what is shown", () => {
    // A real Steam library is full of tools, demos and soundtracks. Somebody who
    // sees "412 games" beside six cards deserves to know why.
    expect(matchedLabel(account({ total_games: 412, matched_games: 180 }))).toBe(
      "180 of 412 matched to the catalog",
    );
  });

  it("says nothing about an empty library", () => {
    expect(matchedLabel(account())).toBeNull();
  });
});

describe("the callback verdict", () => {
  it("welcomes a successful link", () => {
    expect(callbackMessage("connected")?.tone).toBe("success");
  });

  it("explains a Steam account somebody else already holds", () => {
    const message = callbackMessage("taken");

    expect(message?.tone).toBe("error");
    expect(message?.steps.length).toBeGreaterThan(0);
  });

  it("stays quiet on a plain visit", () => {
    // The settings screen is reachable without coming back from Steam, and it
    // must not announce anything then.
    expect(callbackMessage(null)).toBeNull();
    expect(callbackMessage("something-else")).toBeNull();
  });
});

describe("provider labels", () => {
  it("names the platform rather than echoing the enum", () => {
    expect(providerLabel("STEAM")).toBe("Steam");
  });
});
