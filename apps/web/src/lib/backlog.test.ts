import { describe, expect, it } from "vitest";

import type { BacklogEntry, BacklogLists, BacklogStatus, GameSummary } from "@sidequestd/api-types";

import {
  BACKLOG_ORDER,
  activityVerb,
  emptyListMessage,
  entriesOn,
  listName,
  statusByGame,
} from "./backlog";

function game(id: string, title = "Hades"): GameSummary {
  return {
    id,
    slug: title.toLowerCase(),
    title,
    cover_url: null,
    release_date: "2020-09-17",
    release_year: 2020,
    platforms: [],
  };
}

function entry(status: BacklogStatus, id: string): BacklogEntry {
  return {
    id: `b-${id}`,
    game: game(id),
    status,
    position: 0,
    created_at: "2026-02-01T00:00:00Z",
    status_changed_at: "2026-02-01T00:00:00Z",
  };
}

function lists(entries: BacklogEntry[]): BacklogLists {
  return {
    lists: BACKLOG_ORDER.map((status) => ({
      status,
      items: entries.filter((item) => item.status === status),
    })),
  };
}

describe("BACKLOG_ORDER", () => {
  it("is SPEC §6.9's order, which is the order a game moves through", () => {
    expect(BACKLOG_ORDER).toEqual(["TO_BE_PLAYED", "PLAYING", "COMPLETED", "DROPPED"]);
  });
});

describe("listName", () => {
  it("spells a status the way a person reads it", () => {
    expect(listName("TO_BE_PLAYED")).toBe("To Be Played");
    expect(listName("DROPPED")).toBe("Dropped");
  });
});

describe("activityVerb", () => {
  it("says what happened rather than naming the list", () => {
    // SPEC §6.11's own examples are sentences: "Sam completed Hades".
    expect(activityVerb("COMPLETED")).toBe("completed");
    expect(activityVerb("PLAYING")).toBe("started playing");
  });

  it("has a verb for every list, so no status renders as a blank", () => {
    for (const status of BACKLOG_ORDER) expect(activityVerb(status)).not.toBe("");
  });
});

describe("entriesOn", () => {
  it("picks one list out of the payload", () => {
    const body = lists([entry("PLAYING", "g1"), entry("COMPLETED", "g2")]);

    expect(entriesOn(body, "PLAYING").map((item) => item.game.id)).toEqual(["g1"]);
  });

  it("is empty for a list the response left out", () => {
    // What `?status=` returns: one list, and the other three simply absent.
    const narrowed: BacklogLists = { lists: [{ status: "PLAYING", items: [] }] };

    expect(entriesOn(narrowed, "COMPLETED")).toEqual([]);
  });
});

describe("emptyListMessage", () => {
  it("addresses the owner differently from a visitor", () => {
    expect(emptyListMessage("PLAYING", true)).toContain("yet");
    expect(emptyListMessage("PLAYING", false)).not.toContain("yet");
  });
});

describe("statusByGame", () => {
  it("flattens the four lists into what each game's control needs", () => {
    const body = lists([entry("PLAYING", "g1"), entry("DROPPED", "g2")]);

    const found = statusByGame(body);

    expect(found.get("g1")).toBe("PLAYING");
    expect(found.get("g2")).toBe("DROPPED");
    expect(found.has("g3")).toBe(false);
  });
});
