import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewSummary, UserMe } from "@sidequestd/api-types";

import { ReviewCard } from "./review-card";

const authedRequest = vi.fn();

let currentUser: UserMe | null = null;

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    authedRequest,
    user: currentUser,
    isLoading: false,
    logout: vi.fn(),
    syncUser: vi.fn(),
  }),
}));

function me(): UserMe {
  return {
    id: "u2",
    username: "hicks",
    display_name: null,
    bio: null,
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    email: "hicks@example.com",
    email_verified_at: null,
  };
}

function review(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    id: "r1",
    author: {
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
      slug: "alien-isolation",
      title: "Alien: Isolation",
      cover_url: null,
      release_date: "2014-10-07",
      release_year: 2014,
      platforms: [],
    },
    rating: 9,
    stars: 4.5,
    review_text: "One more run.",
    playtime_minutes: 930,
    created_at: "2026-03-01T12:00:00Z",
    updated_at: "2026-03-01T12:00:00Z",
    like_count: 3,
    comment_count: 2,
    viewer_has_liked: false,
    media_count: 0,
    thumbnail_url: null,
    ...overrides,
  };
}

beforeEach(() => {
  currentUser = me();
  authedRequest.mockResolvedValue({
    review_id: "r1",
    like_count: 4,
    comment_count: 2,
    viewer_has_liked: true,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReviewCard", () => {
  it("shows who reviewed what", () => {
    render(<ReviewCard review={review()} />);

    expect(screen.getByRole("link", { name: "Ellen Ripley" })).toHaveAttribute(
      "href",
      "/profile/ripley",
    );
    expect(screen.getByRole("link", { name: "Alien: Isolation" })).toHaveAttribute(
      "href",
      "/games/g1",
    );
  });

  it("shows the rating and the playtime", () => {
    render(<ReviewCard review={review()} />);

    expect(screen.getByText("4.5 / 5")).toBeInTheDocument();
    expect(screen.getByText("Played 15.5h")).toBeInTheDocument();
  });

  it("opens the review", () => {
    render(<ReviewCard review={review()} />);

    expect(screen.getByRole("link", { name: "Read review" })).toHaveAttribute(
      "href",
      "/reviews/r1",
    );
  });

  it("still offers a way in when there is nothing but a rating", () => {
    render(<ReviewCard review={review({ review_text: null })} />);

    expect(screen.getByRole("link", { name: "Open review" })).toHaveAttribute(
      "href",
      "/reviews/r1",
    );
  });

  it("points the comment shortcut at the thread", () => {
    render(<ReviewCard review={review()} />);

    expect(screen.getByRole("link", { name: "2 comments" })).toHaveAttribute(
      "href",
      "/reviews/r1#comments",
    );
  });

  it("likes without leaving the feed", async () => {
    render(<ReviewCard review={review()} />);

    await userEvent.click(screen.getByRole("button", { name: "Like this review" }));

    expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/like", { method: "POST" });
    expect(await screen.findByRole("button", { name: "Unlike this review" })).toHaveTextContent(
      "4 likes",
    );
  });

  it("keeps the comment count the like response reported", async () => {
    // Both counters ride on the same response, so a like is also the freshest
    // thing this card knows about its comments.
    authedRequest.mockResolvedValue({
      review_id: "r1",
      like_count: 4,
      comment_count: 7,
      viewer_has_liked: true,
    });
    render(<ReviewCard review={review()} />);

    await userEvent.click(screen.getByRole("button", { name: "Like this review" }));

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "7 comments" })).toBeInTheDocument(),
    );
  });

  it("counts the carousel when there is more than one item", () => {
    render(<ReviewCard review={review({ thumbnail_url: "/media/shot.jpg", media_count: 3 })} />);

    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("says nothing about a single photo", () => {
    render(<ReviewCard review={review({ thumbnail_url: "/media/shot.jpg", media_count: 1 })} />);

    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("shows what the reviewer attached", () => {
    render(<ReviewCard review={review({ thumbnail_url: "/media/shot.jpg", media_count: 1 })} />);

    expect(screen.getByAltText("Alien: Isolation — reviewed by ripley")).toBeInTheDocument();
  });

  it("does not pass the game's cover art off as the reviewer's photo", () => {
    // The API falls `thumbnail_url` back to the cover, which is right for a
    // square profile tile and wrong for a full-width card: it would read as a
    // screenshot the reviewer took. It goes below, small and upright, instead.
    render(<ReviewCard review={review({ thumbnail_url: "/covers/alien.jpg", media_count: 0 })} />);

    expect(screen.queryByAltText("Alien: Isolation — reviewed by ripley")).not.toBeInTheDocument();
  });

  it("still shows the game it is about", () => {
    render(
      <ReviewCard
        review={review({
          media_count: 0,
          game: { ...review().game, cover_url: "/covers/alien.jpg" },
        })}
      />,
    );

    expect(screen.getByAltText("Alien: Isolation cover art")).toBeInTheDocument();
  });

  it("shows a signed-out reader the count without a button", () => {
    currentUser = null;
    render(<ReviewCard review={review()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 likes")).toBeInTheDocument();
  });
});
