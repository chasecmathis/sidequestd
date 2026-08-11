import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { GameSummary, NotificationItem, UserMe } from "@sidequestd/api-types";

import NotificationsPage from "./page";

const authedRequest = vi.fn();
const markRead = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/notifications",
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

// The store owns the badge and the write; this file is about the page. Stubbing
// it keeps "which rows did the page ask to mark" a direct assertion rather than
// something inferred from a request body.
let unreadCount = 0;

vi.mock("@/lib/notifications-store", () => ({
  useNotifications: () => ({ unreadCount, markRead, refresh: vi.fn() }),
}));

function me(): UserMe {
  return {
    id: "me",
    username: "ripley",
    display_name: null,
    bio: null,
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    email: "ripley@example.com",
    email_verified_at: null,
  };
}

function game(title = "Hades"): GameSummary {
  return {
    id: "g1",
    slug: title.toLowerCase(),
    title,
    cover_url: null,
    release_date: "2020-09-17",
    release_year: 2020,
    platforms: [],
  };
}

function notification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: "n1",
    type: "NEW_FOLLOWER",
    actor: {
      id: "u1",
      username: "hicks",
      display_name: "Dwayne Hicks",
      bio: null,
      avatar_url: null,
      is_private: false,
      created_at: "2026-01-01T00:00:00Z",
    },
    review: null,
    comment: null,
    is_read: false,
    created_at: "2026-02-01T00:00:00Z",
    ...overrides,
  };
}

function respondWith(...items: NotificationItem[]) {
  authedRequest.mockImplementation((path: string) =>
    path.startsWith("/notifications?")
      ? Promise.resolve({ items, next_cursor: null })
      : Promise.resolve(undefined),
  );
}

beforeEach(() => {
  currentUser = me();
  isLoading = false;
  unreadCount = 0;
  markRead.mockResolvedValue(undefined);
  respondWith();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("NotificationsPage", () => {
  it("sends a signed-out visitor to sign in", async () => {
    currentUser = null;

    render(<NotificationsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("waits for the session before fetching", () => {
    currentUser = null;
    isLoading = true;

    render(<NotificationsPage />);

    expect(authedRequest).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("writes each notification as a sentence about who did it", async () => {
    respondWith(notification({ type: "NEW_FOLLOWER" }));

    render(<NotificationsPage />);

    const row = await screen.findByRole("listitem");
    expect(within(row).getByText("Dwayne Hicks")).toBeInTheDocument();
    expect(row).toHaveTextContent("started following you");
  });

  it("names the game when the notification is about a review", async () => {
    respondWith(
      notification({ id: "n2", type: "REVIEW_LIKED", review: { id: "r1", game: game() } }),
    );

    render(<NotificationsPage />);

    expect(await screen.findByText(/liked your review of Hades/)).toBeInTheDocument();
  });

  it("links a review notification to the review", async () => {
    respondWith(
      notification({ id: "n2", type: "REVIEW_LIKED", review: { id: "r1", game: game() } }),
    );

    render(<NotificationsPage />);

    const row = await screen.findByRole("listitem");
    const links = within(row).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toContain("/reviews/r1");
  });

  it("quotes the comment a reply notification is about", async () => {
    respondWith(
      notification({
        id: "n3",
        type: "COMMENT_REPLIED",
        review: { id: "r1", game: game() },
        comment: { id: "c1", review_id: "r1", text: "One more run." },
      }),
    );

    render(<NotificationsPage />);

    expect(await screen.findByText(/One more run\./)).toBeInTheDocument();
  });

  it("does not mark anything read just because the tab was opened", async () => {
    unreadCount = 2;
    respondWith(notification({ id: "a" }), notification({ id: "b" }));

    render(<NotificationsPage />);
    await screen.findAllByRole("listitem");

    expect(markRead).not.toHaveBeenCalled();
    expect(screen.getByText(/2 unread/)).toBeInTheDocument();
  });

  it("offers a mark-read button only on the unread rows", async () => {
    respondWith(
      notification({ id: "a", is_read: false }),
      notification({ id: "b", is_read: true }),
    );

    render(<NotificationsPage />);
    await screen.findAllByRole("listitem");

    expect(screen.getAllByRole("button", { name: /^Mark as read/ })).toHaveLength(1);
  });

  it("marks one row and leaves the rest alone", async () => {
    respondWith(notification({ id: "a" }), notification({ id: "b" }));

    render(<NotificationsPage />);
    const buttons = await screen.findAllByRole("button", { name: /^Mark as read/ });
    await userEvent.click(buttons[0]);

    expect(markRead).toHaveBeenCalledWith(["a"]);
    // The pressed row loses its button; the other one keeps it.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /^Mark as read/ })).toHaveLength(1),
    );
  });

  it("marks everything with no ids at all, which is what the API calls 'all'", async () => {
    respondWith(notification({ id: "a" }), notification({ id: "b" }));

    render(<NotificationsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Mark all read" }));

    // Not `[]` — an empty array means "none" to the API.
    expect(markRead).toHaveBeenCalledWith(undefined);
  });

  it("hides mark-all once there is nothing unread on the page", async () => {
    respondWith(notification({ id: "a", is_read: true }));

    render(<NotificationsPage />);
    await screen.findByRole("listitem");

    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
  });

  it("says what an empty inbox means rather than showing an empty list", async () => {
    render(<NotificationsPage />);

    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Notifications" })).not.toBeInTheDocument();
  });

  it("explains a failed load instead of showing a blank tab", async () => {
    authedRequest.mockRejectedValue(new ApiError("Server exploded.", 500));

    render(<NotificationsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Server exploded.");
  });

  it("keeps the row when marking it fails, so nothing is lost silently", async () => {
    respondWith(notification({ id: "a" }));
    markRead.mockRejectedValue(new ApiError("Nope.", 500));

    render(<NotificationsPage />);
    await userEvent.click(await screen.findByRole("button", { name: /^Mark as read/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Nope.");
    expect(screen.getByRole("button", { name: /^Mark as read/ })).toBeInTheDocument();
  });
});
