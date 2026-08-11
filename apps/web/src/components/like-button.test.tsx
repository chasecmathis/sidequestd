import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { ReviewInteractions, UserMe } from "@sidequestd/api-types";

import { LikeButton } from "./like-button";

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

function interactions(overrides: Partial<ReviewInteractions> = {}): ReviewInteractions {
  return {
    review_id: "r1",
    like_count: 3,
    comment_count: 0,
    viewer_has_liked: false,
    ...overrides,
  };
}

beforeEach(() => {
  currentUser = me();
  authedRequest.mockResolvedValue(interactions({ like_count: 4, viewer_has_liked: true }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LikeButton", () => {
  it("shows the current count", async () => {
    render(<LikeButton interactions={interactions()} />);

    expect(screen.getByRole("button", { name: "Like this review" })).toHaveTextContent("3 likes");
  });

  it("likes a review that is not liked yet", async () => {
    render(<LikeButton interactions={interactions()} />);

    await userEvent.click(screen.getByRole("button", { name: "Like this review" }));

    expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/like", { method: "POST" });
  });

  it("unlikes one that is", async () => {
    authedRequest.mockResolvedValue(interactions({ like_count: 2, viewer_has_liked: false }));
    render(<LikeButton interactions={interactions({ viewer_has_liked: true })} />);

    await userEvent.click(screen.getByRole("button", { name: "Unlike this review" }));

    expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/like", { method: "DELETE" });
  });

  it("takes the server's count rather than its own guess", async () => {
    // Other people have been liking it too; the response knows and the optimistic
    // increment does not.
    authedRequest.mockResolvedValue(interactions({ like_count: 41, viewer_has_liked: true }));
    render(<LikeButton interactions={interactions()} />);

    await userEvent.click(screen.getByRole("button", { name: "Like this review" }));

    expect(await screen.findByRole("button", { name: "Unlike this review" })).toHaveTextContent(
      "41 likes",
    );
  });

  it("reports the new state to its owner", async () => {
    const onChange = vi.fn();
    render(<LikeButton interactions={interactions()} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Like this review" }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ like_count: 4, viewer_has_liked: true }),
      ),
    );
  });

  it("puts the heart back when the request fails", async () => {
    // Leaving it filled would tell the user they liked something they did not.
    authedRequest.mockRejectedValue(new ApiError("Can't reach the server.", 0));
    render(<LikeButton interactions={interactions()} />);

    await userEvent.click(screen.getByRole("button", { name: "Like this review" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
    expect(screen.getByRole("button", { name: "Like this review" })).toHaveTextContent("3 likes");
  });

  it("is announced as pressed once it is", async () => {
    render(<LikeButton interactions={interactions({ viewer_has_liked: true })} />);

    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("has nothing to press when signed out", async () => {
    // A heart that only ever says "sign in first" is a worse invitation than the
    // link already in the nav.
    currentUser = null;
    render(<LikeButton interactions={interactions()} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("3 likes")).toBeInTheDocument();
  });

  it("follows the review it is given", async () => {
    // Navigating between two reviews must not leave the previous answer on screen.
    const { rerender } = render(<LikeButton interactions={interactions()} />);
    rerender(<LikeButton interactions={interactions({ review_id: "r2", like_count: 9 })} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Like this review" })).toHaveTextContent("9 likes"),
    );
  });
});
