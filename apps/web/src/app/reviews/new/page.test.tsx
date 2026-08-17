import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { UserMe } from "@sidequestd/api-types";

import NewReviewPage from "./page";

const authedRequest = vi.fn();
const push = vi.fn();
const replace = vi.fn();

let searchParams = new URLSearchParams();
let currentUser: UserMe | null = null;
let isLoading = false;

// The shells render a theme control, which the root layout provides for in the
// real app. Stubbed rather than wrapped, matching how auth and notifications are
// handled just below; `importActual` keeps the module's constants real so a
// renamed export still breaks loudly.
vi.mock("@/lib/theme", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/theme")>()),
  useTheme: () => ({ theme: "system" as const, resolved: "dark" as const, setTheme: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => "/reviews/new",
  useSearchParams: () => searchParams,
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

const HADES = {
  id: "g1",
  slug: "hades",
  title: "Hades",
  cover_url: null,
  release_date: "2020-09-17",
  release_year: 2020,
  platforms: [],
  rating_count: 0,
};

function png(name = "shot.png"): File {
  return new File(["x"], name, { type: "image/png" });
}

function mp4(name = "clip.mp4"): File {
  return new File(["x"], name, { type: "video/mp4" });
}

beforeEach(() => {
  searchParams = new URLSearchParams();
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
  // jsdom has no object-URL implementation, and the previews depend on one.
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => `blob:${Math.random()}`),
    writable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), writable: true });
  authedRequest.mockResolvedValue({ items: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Drive the screen to the point where it will accept a submit. */
async function pickPreselectedGame() {
  searchParams = new URLSearchParams({ game: "g1" });
  authedRequest.mockResolvedValue(HADES);
  render(<NewReviewPage />);
  await screen.findByText("Hades");
}

describe("NewReviewPage", () => {
  it("sends a signed-out visitor to sign in", async () => {
    currentUser = null;
    render(<NewReviewPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("starts with the game already chosen when one was passed in", async () => {
    // The "Write a review" button on Game Detail links here with ?game=.
    await pickPreselectedGame();

    expect(screen.getByText("Hades")).toBeInTheDocument();
    expect(screen.queryByLabelText("Game")).not.toBeInTheDocument();
  });

  it("falls back to the picker when the game in the URL is not usable", async () => {
    searchParams = new URLSearchParams({ game: "nope" });
    authedRequest.mockRejectedValue(new ApiError("No such game.", 404));
    render(<NewReviewPage />);

    expect(await screen.findByLabelText("Game")).toBeInTheDocument();
  });

  it("will not submit before a game and a rating are chosen", async () => {
    render(<NewReviewPage />);

    expect(screen.getByRole("button", { name: "Pick a game first" })).toBeDisabled();
  });

  it("asks for a rating once a game is chosen", async () => {
    await pickPreselectedGame();

    expect(screen.getByRole("button", { name: "Add a rating" })).toBeDisabled();
  });

  it("posts the review and opens it", async () => {
    await pickPreselectedGame();
    authedRequest.mockResolvedValue({ id: "r1" });

    await userEvent.click(screen.getByRole("radio", { name: "4.5 out of 5 stars" }));
    await userEvent.type(screen.getByLabelText("Review"), "One more run.");
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/reviews", {
        method: "POST",
        body: {
          game_id: "g1",
          rating: 9,
          review_text: "One more run.",
          playtime_minutes: null,
        },
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reviews/r1"));
  });

  it("posts the playtime as minutes, having asked for hours", async () => {
    await pickPreselectedGame();
    authedRequest.mockResolvedValue({ id: "r1" });

    await userEvent.click(screen.getByRole("radio", { name: "4.5 out of 5 stars" }));
    await userEvent.type(screen.getByLabelText("Playtime"), "15.5");
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith(
        "/reviews",
        expect.objectContaining({ body: expect.objectContaining({ playtime_minutes: 930 }) }),
      ),
    );
  });

  it("sends an empty review as null rather than an empty string", async () => {
    // The API's minimum-length rule rejects "", and "no text" is what null means.
    await pickPreselectedGame();
    authedRequest.mockResolvedValue({ id: "r1" });

    await userEvent.click(screen.getByRole("radio", { name: "3 out of 5 stars" }));
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith(
        "/reviews",
        expect.objectContaining({ body: expect.objectContaining({ review_text: null }) }),
      ),
    );
  });

  it("previews chosen files before anything is uploaded", async () => {
    await pickPreselectedGame();

    await userEvent.upload(screen.getByLabelText("Add files"), [png(), png("second.png")]);

    expect(screen.getAllByRole("listitem", { hidden: true }).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Selected media")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove shot.png" })).toBeInTheDocument();
  });

  it("uploads the files after the review exists", async () => {
    // Media hangs off `/reviews/{id}/media`, so the review has to be posted first.
    await pickPreselectedGame();
    await userEvent.upload(screen.getByLabelText("Add files"), [png()]);

    authedRequest.mockResolvedValue({ id: "r1" });
    await userEvent.click(screen.getByRole("radio", { name: "5 out of 5 stars" }));
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith(
        "/reviews/r1/media",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const [path] = authedRequest.mock.calls.at(-1) ?? [];
    expect(path).toBe("/reviews/r1/media");
  });

  it("refuses a second clip before it reaches the network", async () => {
    // SPEC §6.3 allows one video per review; saying so here beats a 409.
    await pickPreselectedGame();

    await userEvent.upload(screen.getByLabelText("Add files"), [mp4("a.mp4"), mp4("b.mp4")]);

    expect(await screen.findByRole("alert")).toHaveTextContent(/one video clip/i);
    expect(screen.queryByRole("button", { name: "Remove b.mp4" })).not.toBeInTheDocument();
  });

  it("does not post the review twice when an upload fails", async () => {
    // The review is already saved at that point; a retry should only finish the
    // uploads, not create a second review and hit the one-per-game conflict.
    await pickPreselectedGame();
    await userEvent.upload(screen.getByLabelText("Add files"), [png()]);
    await userEvent.click(screen.getByRole("radio", { name: "5 out of 5 stars" }));

    authedRequest.mockImplementation((path: string) =>
      path === "/reviews"
        ? Promise.resolve({ id: "r1" })
        : Promise.reject(new ApiError("File storage is unavailable right now.", 503)),
    );
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    await screen.findByText(/File storage is unavailable/);

    authedRequest.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));

    await waitFor(() => expect(authedRequest).toHaveBeenCalled());
    expect(authedRequest.mock.calls.map(([path]) => path)).not.toContain("/reviews");
  });

  it("links to the saved review while the uploads are unfinished", async () => {
    await pickPreselectedGame();
    await userEvent.upload(screen.getByLabelText("Add files"), [png()]);
    await userEvent.click(screen.getByRole("radio", { name: "5 out of 5 stars" }));

    authedRequest.mockImplementation((path: string) =>
      path === "/reviews"
        ? Promise.resolve({ id: "r1" })
        : Promise.reject(new ApiError("Storage down.", 503)),
    );
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));

    expect(await screen.findByRole("link", { name: "view it now" })).toHaveAttribute(
      "href",
      "/reviews/r1",
    );
  });
});
