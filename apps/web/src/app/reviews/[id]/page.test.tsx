import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { settle } from "@/test-support";
import type { ReviewDetail, ReviewMediaItem, UserMe } from "@sidequestd/api-types";

import ReviewDetailPage from "./page";

const authedRequest = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/reviews/r1",
  useParams: () => ({ id: "r1" }),
}));

let currentUser: UserMe | null = null;
let isLoading = false;

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    authedRequest,
    user: currentUser,
    isLoading,
    logout: vi.fn(),
    syncUser: vi.fn(),
  }),
}));

// The app shell carries an unread badge (SPEC §6.12). Stubbed so this file's
// `authedRequest` mock is never asked for a count it has no answer for, and so
// these tests do not depend on a provider none of them are about.
vi.mock("@/lib/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
}));

// The page offers "add to list" for the game being reviewed (SPEC §6.9). Stubbed
// so the store's own request does not arrive through this file's `authedRequest`
// mock, which answers everything with a review.
vi.mock("@/lib/backlog-store", () => ({
  useBacklog: () => ({
    statuses: new Map(),
    ensureLoaded: vi.fn(),
    setStatus: vi.fn(),
    clearStatus: vi.fn(),
  }),
}));

function media(overrides: Partial<ReviewMediaItem> = {}): ReviewMediaItem {
  return {
    id: "m1",
    type: "IMAGE",
    url: "http://localhost:9000/sidequestd-media/reviews/r1/a.png",
    thumbnail_url: "http://localhost:9000/sidequestd-media/reviews/r1/a_thumb.jpg",
    width: 800,
    height: 600,
    duration_seconds: null,
    alt_text: null,
    position: 0,
    processing_status: "READY",
    ...overrides,
  };
}

function viewer(id: string, username: string): UserMe {
  return {
    id,
    username,
    display_name: null,
    bio: null,
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    email: `${username}@example.com`,
    email_verified_at: null,
  };
}

function review(overrides: Partial<ReviewDetail> = {}): ReviewDetail {
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
      slug: "hades",
      title: "Hades",
      cover_url: null,
      release_date: "2020-09-17",
      release_year: 2020,
      platforms: [],
    },
    rating: 9,
    review_text: "One more run.",
    playtime_minutes: 930,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    like_count: 12,
    comment_count: 3,
    viewer_has_liked: false,
    media_count: 0,
    thumbnail_url: null,
    stars: 4.5,
    media: [],
    ...overrides,
  };
}

/**
 * The screen makes two calls — the review, and its comment thread — so the mock
 * answers by path. A single `mockResolvedValue` would hand a review back as a
 * page of comments, and the failure would look like a rendering bug.
 */
function respondWith(body: ReviewDetail | (() => ReviewDetail)) {
  authedRequest.mockImplementation((path: string) =>
    path.includes("/comments")
      ? Promise.resolve({ items: [], next_cursor: null })
      : Promise.resolve(typeof body === "function" ? body() : body),
  );
}

beforeEach(() => {
  currentUser = null;
  isLoading = false;
  respondWith(review());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ReviewDetailPage", () => {
  it("shows everything SPEC §6.3 lists on the screen", async () => {
    render(<ReviewDetailPage />);

    expect(await screen.findByRole("heading", { name: "Hades" })).toBeInTheDocument();
    expect(screen.getByText("Ellen Ripley")).toBeInTheDocument();
    expect(screen.getByText("One more run.")).toBeInTheDocument();
    expect(screen.getByText("4.5 / 5")).toBeInTheDocument();
    expect(screen.getByText("Played 15.5h")).toBeInTheDocument();
  });

  it("shows the like and comment counts", async () => {
    render(<ReviewDetailPage />);

    expect(await screen.findByText("12 likes")).toBeInTheDocument();
    expect(screen.getByText("3 comments")).toBeInTheDocument();
  });

  it("offers a working like button to a signed-in viewer", async () => {
    currentUser = viewer("u2", "hicks");
    render(<ReviewDetailPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Like this review" }));

    expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/like", { method: "POST" });
  });

  it("moves the like count with the button", async () => {
    currentUser = viewer("u2", "hicks");
    authedRequest.mockImplementation((path: string, options?: { method?: string }) => {
      if (path.includes("/comments")) {
        return Promise.resolve({ items: [], next_cursor: null });
      }
      if (options?.method === "POST") {
        return Promise.resolve({
          review_id: "r1",
          like_count: 13,
          comment_count: 3,
          viewer_has_liked: true,
        });
      }
      return Promise.resolve(review());
    });
    render(<ReviewDetailPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Like this review" }));

    expect(await screen.findByRole("button", { name: "Unlike this review" })).toHaveTextContent(
      "13 likes",
    );
  });

  it("renders the comment thread under the review", async () => {
    render(<ReviewDetailPage />);

    expect(await screen.findByRole("heading", { name: "Comments" })).toBeInTheDocument();
    expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/comments?limit=20");
  });

  it("leaves out the playtime when the author did not track it", async () => {
    respondWith(review({ playtime_minutes: null }));
    render(<ReviewDetailPage />);

    await screen.findByRole("heading", { name: "Hades" });
    expect(screen.queryByText(/Played/)).not.toBeInTheDocument();
  });

  it("renders the carousel when there is media", async () => {
    respondWith(review({ media: [media()], media_count: 1 }));
    render(<ReviewDetailPage />);

    expect(await screen.findByLabelText("Media carousel")).toBeInTheDocument();
  });

  it("has no empty carousel when there is none", async () => {
    render(<ReviewDetailPage />);

    await screen.findByRole("heading", { name: "Hades" });
    expect(screen.queryByLabelText("Media carousel")).not.toBeInTheDocument();
  });

  it("marks an item that is still being processed", async () => {
    // The upload succeeded and the file is there; only the thumbnail is missing.
    respondWith(review({ media: [media({ processing_status: "PENDING", thumbnail_url: null })] }));
    render(<ReviewDetailPage />);

    expect(await screen.findByText("Processing")).toBeInTheDocument();
  });

  it("offers an edit link only to the author", async () => {
    render(<ReviewDetailPage />);
    await screen.findByRole("heading", { name: "Hades" });
    expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();

    currentUser = viewer("u1", "ripley");
    render(<ReviewDetailPage />);

    expect(await screen.findByRole("link", { name: "Edit" })).toHaveAttribute(
      "href",
      "/reviews/r1/edit",
    );
  });

  it("waits for the session before fetching", async () => {
    // Same trap as the profile page: this endpoint answers signed-out callers
    // with 200, so firing early would render the anonymous view of your own
    // review — no Edit link — with no 401 for authedRequest's retry to catch.
    isLoading = true;
    render(<ReviewDetailPage />);

    await settle();
    expect(authedRequest).not.toHaveBeenCalled();
  });

  it("explains a deleted review in its own words", async () => {
    authedRequest.mockRejectedValue(new ApiError("That review does not exist.", 404));
    render(<ReviewDetailPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("That review no longer exists.");
  });

  it("explains a private author rather than showing a bare error", async () => {
    authedRequest.mockRejectedValue(new ApiError("This account is private.", 403));
    render(<ReviewDetailPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/private/i);
  });

  it("polls until the media is ready, then stops", async () => {
    // SPEC §6.3 processes in the background, so a review opened straight after
    // posting has thumbnails that do not exist yet.
    let ready = false;
    respondWith(() => {
      const body = review({
        media: [media({ processing_status: ready ? "READY" : "PENDING" })],
      });
      ready = true;
      return body;
    });
    render(<ReviewDetailPage />);

    await screen.findByText("Processing");
    await waitFor(() => expect(screen.queryByText("Processing")).not.toBeInTheDocument(), {
      timeout: 4000,
    });

    const settled = authedRequest.mock.calls.length;
    await settle(2500);
    expect(authedRequest).toHaveBeenCalledTimes(settled);
  }, 10000);
});
