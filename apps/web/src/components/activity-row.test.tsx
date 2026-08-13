import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FeedActivityItem } from "@sidequestd/api-types";

import { ActivityRow } from "./activity-row";

function activity(overrides: Partial<FeedActivityItem> = {}): FeedActivityItem {
  return {
    type: "backlog_activity",
    id: "b1",
    occurred_at: "2026-03-01T12:00:00Z",
    actor: {
      id: "u1",
      username: "ripley",
      display_name: "Ellen Ripley",
      bio: null,
      avatar_url: null,
      is_private: false,
      created_at: "2026-01-01T00:00:00Z",
    },
    game: {
      id: "g1",
      slug: "hades",
      title: "Hades",
      cover_url: null,
      release_date: "2020-09-17",
      release_year: 2020,
      rating_count: 0,
      platforms: [],
    },
    status: "COMPLETED",
    ...overrides,
  };
}

describe("ActivityRow", () => {
  it("reads as a sentence about what somebody did", () => {
    render(<ActivityRow item={activity()} />);

    expect(screen.getByRole("link", { name: "Ellen Ripley" })).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Hades" })).toHaveAttribute("href", "/games/g1");
  });

  it("says what each list means without naming it", () => {
    render(<ActivityRow item={activity({ status: "TO_BE_PLAYED" })} />);

    expect(screen.getByText("wants to play")).toBeInTheDocument();
  });

  it("falls back to the handle when there is no display name", () => {
    render(<ActivityRow item={activity({ actor: { ...activity().actor, display_name: null } })} />);

    expect(screen.getByRole("link", { name: "ripley" })).toBeInTheDocument();
  });

  it("links the actor to their profile", () => {
    render(<ActivityRow item={activity()} />);

    expect(screen.getByRole("link", { name: "Ellen Ripley" })).toHaveAttribute(
      "href",
      "/profile/ripley",
    );
  });

  it("carries a machine-readable timestamp", () => {
    const { container } = render(<ActivityRow item={activity()} />);

    expect(container.querySelector("time")).toHaveAttribute("dateTime", "2026-03-01T12:00:00Z");
  });

  it("stays a line, not a card", () => {
    // SPEC §6.11: reviews lead and activity is lighter-weight. Nothing here is a
    // piece of writing, so there is nothing to like or comment on.
    render(<ActivityRow item={activity()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the cover art when the catalog has some", () => {
    render(<ActivityRow item={activity({ game: { ...activity().game, cover_url: "/c.jpg" } })} />);

    expect(screen.getByAltText("Hades cover art")).toBeInTheDocument();
  });

  it("does not leave a hole where a missing cover would go", () => {
    render(<ActivityRow item={activity()} />);

    expect(screen.queryByAltText("Hades cover art")).not.toBeInTheDocument();
  });
});
