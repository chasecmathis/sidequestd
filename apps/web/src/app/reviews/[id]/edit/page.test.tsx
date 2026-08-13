import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { ReviewDetail, ReviewMediaItem, UserMe } from "@sidequestd/api-types";

import EditReviewPage from "./page";

const authedRequest = vi.fn();
const push = vi.fn();
const replace = vi.fn();

let currentUser: UserMe | null = null;
let isLoading = false;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/reviews/r1/edit",
  useParams: () => ({ id: "r1" }),
}));

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

function review(overrides: Partial<ReviewDetail> = {}): ReviewDetail {
  return {
    id: "r1",
    author: {
      id: "u1",
      username: "ripley",
      display_name: null,
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
    rating: 8,
    review_text: "Solid.",
    playtime_minutes: 120,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    like_count: 0,
    comment_count: 0,
    viewer_has_liked: false,
    media_count: 0,
    thumbnail_url: null,
    stars: 4,
    media: [],
    ...overrides,
  };
}

beforeEach(() => {
  isLoading = false;
  currentUser = {
    id: "u1",
    username: "ripley",
    display_name: null,
    bio: null,
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    email: "ripley@example.com",
    email_verified_at: null,
  };
  authedRequest.mockResolvedValue(review());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("EditReviewPage", () => {
  it("seeds the form from the review", async () => {
    render(<EditReviewPage />);

    expect(await screen.findByLabelText("Review")).toHaveValue("Solid.");
    // Stored as 120 minutes, edited as 2 hours.
    expect(screen.getByLabelText("Playtime")).toHaveValue(2);
    expect(screen.getByRole("radio", { name: "4 out of 5 stars" })).toBeChecked();
  });

  it("leaves the playtime blank when there was none", async () => {
    authedRequest.mockResolvedValue(review({ playtime_minutes: null }));
    render(<EditReviewPage />);

    await screen.findByLabelText("Review");
    expect(screen.getByLabelText("Playtime")).toHaveValue(null);
  });

  it("sends a signed-out visitor to sign in", async () => {
    currentUser = null;
    render(<EditReviewPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("saves the edited fields", async () => {
    render(<EditReviewPage />);
    await screen.findByLabelText("Review");

    await userEvent.click(screen.getByRole("radio", { name: "2 out of 5 stars" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/reviews/r1", {
        method: "PATCH",
        body: { rating: 4, review_text: "Solid.", playtime_minutes: 120 },
      }),
    );
  });

  it("sends the edited hours back as minutes", async () => {
    render(<EditReviewPage />);
    await screen.findByLabelText("Review");

    const playtime = screen.getByLabelText("Playtime");
    await userEvent.clear(playtime);
    await userEvent.type(playtime, "15.5");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith(
        "/reviews/r1",
        expect.objectContaining({ body: expect.objectContaining({ playtime_minutes: 930 }) }),
      ),
    );
  });

  it("clears the playtime when the field is emptied", async () => {
    render(<EditReviewPage />);
    await screen.findByLabelText("Review");

    await userEvent.clear(screen.getByLabelText("Playtime"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith(
        "/reviews/r1",
        expect.objectContaining({ body: expect.objectContaining({ playtime_minutes: null }) }),
      ),
    );
  });

  it("clears an emptied review with null, not an empty string", async () => {
    render(<EditReviewPage />);
    await userEvent.clear(await screen.findByLabelText("Review"));

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith(
        "/reviews/r1",
        expect.objectContaining({ body: expect.objectContaining({ review_text: null }) }),
      ),
    );
  });

  it("confirms a successful save", async () => {
    render(<EditReviewPage />);
    await screen.findByLabelText("Review");

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Review saved.");
  });

  it("reports a failed save against the form", async () => {
    render(<EditReviewPage />);
    await screen.findByLabelText("Review");
    authedRequest.mockRejectedValue(new ApiError("You can only edit your own reviews.", 403));

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You can only edit your own reviews.",
    );
  });

  it("uploads a new file straight away", async () => {
    // The review already exists here, so there is nothing to stage.
    render(<EditReviewPage />);
    await screen.findByLabelText("Review");
    authedRequest.mockResolvedValue(media({ id: "m2" }));

    await userEvent.upload(
      screen.getByLabelText("Add files"),
      new File(["x"], "shot.png", { type: "image/png" }),
    );

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith(
        "/reviews/r1/media",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("reports an upload failure against the picker, not the form", async () => {
    render(<EditReviewPage />);
    await screen.findByLabelText("Review");
    authedRequest.mockRejectedValue(
      new ApiError("That file is too large. The limit is 15 MB.", 413),
    );

    await userEvent.upload(
      screen.getByLabelText("Add files"),
      new File(["x"], "big.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("too large");
  });

  it("shows what is already attached", async () => {
    authedRequest.mockResolvedValue(review({ media: [media()], media_count: 1 }));
    render(<EditReviewPage />);

    expect(await screen.findByLabelText("Attached media")).toBeInTheDocument();
  });

  it("takes the remaining carousel from the delete response", async () => {
    // The API renumbers on removal, so trusting its answer beats patching the
    // local list and guessing what the positions became.
    authedRequest.mockResolvedValue(review({ media: [media(), media({ id: "m2", position: 1 })] }));
    render(<EditReviewPage />);
    await screen.findByLabelText("Attached media");

    authedRequest.mockResolvedValue([media({ id: "m2", position: 0 })]);
    await userEvent.click(screen.getAllByRole("button", { name: "Remove this file" })[0]!);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Remove this file" })).toHaveLength(1),
    );
    expect(authedRequest).toHaveBeenCalledWith("/reviews/r1/media/m1", { method: "DELETE" });
  });

  it("deletes the review and returns to the profile", async () => {
    render(<EditReviewPage />);
    await screen.findByLabelText("Review");

    await userEvent.click(screen.getByRole("button", { name: "Delete review" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/reviews/r1", { method: "DELETE" }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/profile/ripley"));
  });

  it("explains a review that is already gone", async () => {
    authedRequest.mockRejectedValue(new ApiError("That review does not exist.", 404));
    render(<EditReviewPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("That review no longer exists.");
  });
});
