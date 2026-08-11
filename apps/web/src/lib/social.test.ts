import { describe, expect, it } from "vitest";

import {
  followActionLabel,
  followLabel,
  followRequest,
  followUndoes,
  followerDelta,
  handle,
  optimisticState,
} from "./social";

describe("followLabel", () => {
  it("names the three states from SPEC §6.2", () => {
    expect(followLabel("NONE")).toBe("Follow");
    expect(followLabel("REQUESTED")).toBe("Requested");
    expect(followLabel("FOLLOWING")).toBe("Following");
  });
});

describe("followActionLabel", () => {
  it("describes the action, not the state", () => {
    // The visible label says where you are; the accessible name has to say what
    // pressing it does, or the control is a trap.
    expect(followActionLabel("FOLLOWING", "ripley")).toBe("Unfollow ripley");
    expect(followActionLabel("NONE", "ripley")).toBe("Follow ripley");
  });

  it("calls withdrawing a request what it is", () => {
    expect(followActionLabel("REQUESTED", "newt")).toMatch(/cancel/i);
  });
});

describe("followRequest", () => {
  it("creates the edge when there isn't one", () => {
    expect(followRequest("NONE", "u1")).toEqual({ path: "/follow/u1", method: "POST" });
  });

  it("removes it with the same path either way", () => {
    // Unfollowing and cancelling a request are one row, so one call.
    expect(followRequest("FOLLOWING", "u1").method).toBe("DELETE");
    expect(followRequest("REQUESTED", "u1").method).toBe("DELETE");
  });
});

describe("followUndoes", () => {
  it("is true for both of the states that have an edge", () => {
    expect(followUndoes("FOLLOWING")).toBe(true);
    expect(followUndoes("REQUESTED")).toBe(true);
    expect(followUndoes("NONE")).toBe(false);
  });
});

describe("optimisticState", () => {
  it("asks a private account rather than following it", () => {
    // SPEC §6.7. The server decides for real; this stops the button reading
    // "Follow" for a frame after it was pressed.
    expect(optimisticState("NONE", true)).toBe("REQUESTED");
    expect(optimisticState("NONE", false)).toBe("FOLLOWING");
  });

  it("returns to nothing from either edge state", () => {
    expect(optimisticState("FOLLOWING", false)).toBe("NONE");
    expect(optimisticState("REQUESTED", true)).toBe("NONE");
  });
});

describe("followerDelta", () => {
  it("moves the count only when the follow itself does", () => {
    expect(followerDelta("NONE", "FOLLOWING")).toBe(1);
    expect(followerDelta("FOLLOWING", "NONE")).toBe(-1);
  });

  it("leaves it alone for a request", () => {
    // A pending request is not a follower — the API counts accepted edges only.
    expect(followerDelta("NONE", "REQUESTED")).toBe(0);
    expect(followerDelta("REQUESTED", "NONE")).toBe(0);
  });

  it("is zero when nothing changed", () => {
    expect(followerDelta("FOLLOWING", "FOLLOWING")).toBe(0);
  });
});

describe("handle", () => {
  it("prefixes the at-sign", () => {
    expect(handle({ username: "ripley" })).toBe("@ripley");
  });
});
