import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserProfile, UserPublic } from "@sidequestd/api-types";

import FollowersPage from "./page";
import FollowingPage from "../following/page";

const authedRequest = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/profile/ripley/followers",
  useParams: () => ({ username: "ripley" }),
}));

let isLoading = false;
let viewer: { id: string; username: string; is_private: boolean } | null = null;

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ authedRequest, user: viewer, isLoading, logout: vi.fn(), syncUser: vi.fn() }),
}));

vi.mock("@/lib/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
}));

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "owner-1",
    username: "ripley",
    display_name: "Ellen Ripley",
    bio: null,
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    follower_count: 3,
    following_count: 2,
    is_viewer: false,
    can_view_content: true,
    viewer_follow_state: "NONE",
    follows_viewer: false,
    favorite_games: [],
    stats: null,
    ...overrides,
  };
}

function person(overrides: Partial<UserPublic> = {}): UserPublic {
  return {
    id: "u1",
    username: "newt",
    display_name: "Rebecca Jorden",
    bio: null,
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Profile first, then the list — the screen makes those two requests in order. */
function respondWith(
  body: UserProfile,
  people: UserPublic[] = [],
  nextCursor: string | null = null,
) {
  authedRequest.mockImplementation((path: string) => {
    if (path === "/users/ripley") return Promise.resolve(body);
    if (path.includes("/followers") || path.includes("/following")) {
      return Promise.resolve({ items: people, next_cursor: nextCursor });
    }
    return Promise.resolve({ items: [], next_cursor: null });
  });
}

beforeEach(() => {
  isLoading = false;
  viewer = null;
  respondWith(profile());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("follow lists", () => {
  it("asks the right endpoint for each side", async () => {
    render(<FollowersPage />);
    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/users/owner-1/followers"));

    cleanup();
    render(<FollowingPage />);
    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/users/owner-1/following"));
  });

  it("lists the people it was given", async () => {
    respondWith(profile(), [person(), person({ id: "u2", username: "hicks" })]);
    render(<FollowersPage />);

    expect(await screen.findByText("@newt")).toBeInTheDocument();
    expect(screen.getByText("@hicks")).toBeInTheDocument();
  });

  it("offers both sides with their counts", async () => {
    render(<FollowersPage />);

    const followers = await screen.findByRole("link", { name: /Followers/ });
    expect(followers).toHaveAttribute("href", "/profile/ripley/followers");
    expect(followers).toHaveAttribute("aria-current", "page");

    const following = screen.getByRole("link", { name: /Following/ });
    expect(following).toHaveAttribute("href", "/profile/ripley/following");
    expect(following).not.toHaveAttribute("aria-current");
  });

  it("says an empty list is empty in its own words", async () => {
    respondWith(profile(), []);
    render(<FollowersPage />);

    expect(await screen.findByText("Nobody follows @ripley yet.")).toBeInTheDocument();
  });

  it("addresses the owner of an empty list differently", async () => {
    viewer = { id: "owner-1", username: "ripley", is_private: false };
    respondWith(profile({ is_viewer: true }), []);
    render(<FollowingPage />);

    expect(await screen.findByText(/^You aren't following anyone yet/)).toBeInTheDocument();
  });

  it("locks a private account's list instead of showing it empty", async () => {
    respondWith(profile({ is_private: true, can_view_content: false }));
    render(<FollowersPage />);

    expect(await screen.findByText("This account is private")).toBeInTheDocument();
    // The gate is the point: asking would only have been a 403.
    expect(authedRequest).not.toHaveBeenCalledWith(expect.stringContaining("/followers"));
  });

  it("explains a handle that does not exist", async () => {
    authedRequest.mockRejectedValue(new Error("Request failed."));
    render(<FollowersPage />);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });

  describe("actions", () => {
    it("offers Unfollow on your own following list", async () => {
      viewer = { id: "owner-1", username: "ripley", is_private: false };
      respondWith(profile({ is_viewer: true }), [person()]);
      render(<FollowingPage />);

      expect(await screen.findByRole("button", { name: "Unfollow newt" })).toBeInTheDocument();
    });

    it("offers Remove on your own followers list", async () => {
      viewer = { id: "owner-1", username: "ripley", is_private: false };
      respondWith(profile({ is_viewer: true }), [person()]);
      render(<FollowersPage />);

      expect(
        await screen.findByRole("button", { name: "Remove newt from your followers" }),
      ).toBeInTheDocument();
    });

    it("offers nothing on somebody else's list, because the payload cannot say", async () => {
      viewer = { id: "someone-else", username: "hicks", is_private: false };
      respondWith(profile({ is_viewer: false }), [person()]);
      render(<FollowersPage />);

      await screen.findByText("@newt");
      expect(screen.queryByRole("button", { name: /Unfollow|Remove/ })).not.toBeInTheDocument();
    });

    it("takes a removed follower out of the list, because that is not undoable here", async () => {
      viewer = { id: "owner-1", username: "ripley", is_private: false };
      respondWith(profile({ is_viewer: true }), [
        person(),
        person({ id: "u2", username: "hicks" }),
      ]);
      render(<FollowersPage />);

      await userEvent.click(
        await screen.findByRole("button", { name: "Remove newt from your followers" }),
      );

      await waitFor(() => expect(screen.queryByText("@newt")).not.toBeInTheDocument());
      expect(screen.getByText("@hicks")).toBeInTheDocument();
    });

    it("keeps an unfollowed row in place, so the press can be undone", async () => {
      viewer = { id: "owner-1", username: "ripley", is_private: false };
      respondWith(profile({ is_viewer: true }), [person()]);
      authedRequest.mockImplementation((path: string, init?: { method?: string }) => {
        if (path === "/users/ripley") return Promise.resolve(profile({ is_viewer: true }));
        if (path === "/follow/u1" && init?.method === "DELETE") {
          return Promise.resolve({ state: "NONE", follower_count: 0 });
        }
        return Promise.resolve({ items: [person()], next_cursor: null });
      });
      render(<FollowingPage />);

      await userEvent.click(await screen.findByRole("button", { name: "Unfollow newt" }));

      // Still listed, and the button has turned back into the way to undo it.
      expect(await screen.findByRole("button", { name: "Follow newt" })).toBeInTheDocument();
      expect(screen.getByText("@newt")).toBeInTheDocument();
    });
  });

  describe("paging", () => {
    it("offers no control when the API says the list is complete", async () => {
      respondWith(profile(), [person()], null);
      render(<FollowersPage />);

      await screen.findByText("@newt");
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("appends the next page", async () => {
      respondWith(profile(), [person()], "page-two");
      render(<FollowersPage />);
      await screen.findByText("@newt");

      authedRequest.mockImplementation((path: string) => {
        if (path === "/users/ripley") return Promise.resolve(profile());
        return Promise.resolve({
          items: [person({ id: "u2", username: "hicks" })],
          next_cursor: null,
        });
      });
      await userEvent.click(screen.getByRole("button", { name: "Load more" }));

      expect(await screen.findByText("@hicks")).toBeInTheDocument();
      expect(screen.getByText("@newt")).toBeInTheDocument();
    });

    it("sends the cursor it was handed", async () => {
      respondWith(profile(), [person()], "page-two");
      render(<FollowersPage />);
      await screen.findByText("@newt");

      authedRequest.mockImplementation((path: string) => {
        if (path === "/users/ripley") return Promise.resolve(profile());
        return Promise.resolve({
          items: [person({ id: "u2", username: "hicks" })],
          next_cursor: null,
        });
      });
      await userEvent.click(screen.getByRole("button", { name: "Load more" }));

      await waitFor(() =>
        expect(authedRequest).toHaveBeenCalledWith("/users/owner-1/followers?cursor=page-two"),
      );
    });
  });

  it("names the list for a screen reader", async () => {
    respondWith(profile(), [person()]);
    render(<FollowersPage />);

    const list = await screen.findByRole("list", { name: "Followers of @ripley" });
    expect(within(list).getByText("@newt")).toBeInTheDocument();
  });
});
