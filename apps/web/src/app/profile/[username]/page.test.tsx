import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { settle } from "@/test-support";
import type {
  BacklogEntry,
  BacklogLists,
  BacklogStatus,
  GameSummary,
  ProfileStats,
  ReviewSummary,
  UserProfile,
} from "@sidequestd/api-types";

import ProfilePage from "./page";

const authedRequest = vi.fn();

// The shells render a theme control, which the root layout provides for in the
// real app. Stubbed rather than wrapped, matching how auth and notifications are
// handled just below; `importActual` keeps the module's constants real so a
// renamed export still breaks loudly.
vi.mock("@/lib/theme", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/theme")>()),
  useTheme: () => ({ theme: "system" as const, resolved: "dark" as const, setTheme: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/profile/ripley",
  useParams: () => ({ username: "ripley" }),
}));

let isLoading = false;
let viewer: { id: string; username: string; is_private: boolean } | null = null;

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ authedRequest, user: viewer, isLoading, logout: vi.fn(), syncUser: vi.fn() }),
}));

// The app shell carries an unread badge (SPEC §6.12). Stubbed so this file's
// `authedRequest` mock is never asked for a count it has no answer for, and so
// these tests do not depend on a provider none of them are about.
vi.mock("@/lib/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
}));

function stats(overrides: Partial<ProfileStats> = {}): ProfileStats {
  return {
    games_reviewed: 4,
    review_count: 4,
    average_rating: 8,
    total_playtime_minutes: 750,
    completed_count: 2,
    backlog_count: 3,
    rating_distribution: Array.from({ length: 10 }, (_, index) => ({
      rating: index + 1,
      count: index === 7 ? 4 : 0,
    })),
    member_since: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    username: "ripley",
    display_name: "Ellen Ripley",
    bio: "Warrant officer, USCSS Nostromo.",
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    follower_count: 1204,
    following_count: 87,
    is_viewer: false,
    can_view_content: true,
    viewer_follow_state: "NONE",
    follows_viewer: false,
    favorite_games: [],
    stats: stats(),
    ...overrides,
  };
}

function review(overrides: Partial<ReviewSummary> = {}): ReviewSummary {
  return {
    id: "r1",
    author: {
      id: "11111111-1111-1111-1111-111111111111",
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
      rating_count: 0,
    },
    rating: 9,
    review_text: null,
    playtime_minutes: null,
    created_at: "2026-02-01T00:00:00Z",
    updated_at: "2026-02-01T00:00:00Z",
    like_count: 0,
    comment_count: 0,
    viewer_has_liked: false,
    media_count: 0,
    thumbnail_url: null,
    stars: 4.5,
    ...overrides,
  };
}

function backlogEntry(status: BacklogStatus, game: GameSummary): BacklogEntry {
  return {
    id: `b-${game.id}`,
    game,
    status,
    position: 0,
    created_at: "2026-02-01T00:00:00Z",
    status_changed_at: "2026-02-01T00:00:00Z",
  };
}

/** The four lists as the API returns them: always all four, empty ones included. */
function backlog(entries: BacklogEntry[] = []): BacklogLists {
  const order: BacklogStatus[] = ["TO_BE_PLAYED", "PLAYING", "COMPLETED", "DROPPED"];
  return {
    lists: order.map((status) => ({
      status,
      items: entries.filter((entry) => entry.status === status),
    })),
  };
}

/**
 * The screen makes several calls — the profile, its reviews page, its backlog
 * lists, and whatever the Follow button sends — so the mock answers by path. A
 * single `mockResolvedValue` would hand a profile back as a review page and the
 * failure would look like a rendering bug.
 */
function respondWith(body: UserProfile, reviews: ReviewSummary[] = [], lists = backlog()) {
  authedRequest.mockImplementation((path: string) => {
    if (path.includes("/reviews")) {
      return Promise.resolve({ items: reviews, next_cursor: null });
    }
    if (path.includes("/backlog")) {
      return Promise.resolve(lists);
    }
    if (path.startsWith("/follow/") || path.startsWith("/followers/")) {
      return Promise.resolve({
        follower_id: viewer?.id,
        followee_id: body.id,
        state: "FOLLOWING",
        follower_count: body.follower_count + 1,
      });
    }
    return Promise.resolve(body);
  });
}

beforeEach(() => {
  isLoading = false;
  viewer = { id: "22222222-2222-2222-2222-222222222222", username: "hicks", is_private: false };
  respondWith(profile());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ProfilePage", () => {
  it("fetches the profile by handle", async () => {
    render(<ProfilePage />);

    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/users/ripley"));
  });

  it("renders the shell", async () => {
    render(<ProfilePage />);

    expect(await screen.findByRole("heading", { name: "ripley" })).toBeInTheDocument();
    expect(screen.getByText("Ellen Ripley")).toBeInTheDocument();
    expect(screen.getByText("Warrant officer, USCSS Nostromo.")).toBeInTheDocument();
    expect(screen.getByText("1,204")).toBeInTheDocument();
    expect(screen.getByText("87")).toBeInTheDocument();
  });

  it("shows the stats from SPEC §6.8", async () => {
    render(<ProfilePage />);

    expect(await screen.findByText("4.0 / 5")).toBeInTheDocument();
    expect(screen.getByText("12.5h")).toBeInTheDocument();
    expect(screen.getByLabelText("Rating distribution")).toBeInTheDocument();
  });

  it("shows favorite games in their pinned order", async () => {
    respondWith(
      profile({
        favorite_games: [
          {
            position: 0,
            game: {
              id: "g1",
              slug: "hades",
              title: "Hades",
              cover_url: null,
              release_date: "2020-09-17",
              release_year: 2020,
              platforms: [],
              rating_count: 0,
            },
          },
        ],
      }),
    );
    render(<ProfilePage />);

    expect(await screen.findByText("Hades")).toBeInTheDocument();
  });

  it("fills the grid with the author's reviews", async () => {
    respondWith(profile(), [review(), review({ id: "r2" })]);
    render(<ProfilePage />);

    const grid = await screen.findByLabelText("Reviews grid");
    expect(within(grid).getAllByRole("link")).toHaveLength(2);
    expect(within(grid).getAllByRole("link")[0]).toHaveAttribute("href", "/reviews/r1");
  });

  it("pages the grid separately from the profile", async () => {
    // The profile is one object; the grid is cursor-paginated (SPEC §6.2), so it
    // cannot ride along in the same response.
    respondWith(profile(), [review()]);
    render(<ProfilePage />);

    await screen.findByLabelText("Reviews grid");
    expect(authedRequest).toHaveBeenCalledWith("/users/ripley");
    expect(authedRequest).toHaveBeenCalledWith(
      "/users/11111111-1111-1111-1111-111111111111/reviews?limit=12",
    );
  });

  it("says so when there is nothing in the grid yet", async () => {
    render(<ProfilePage />);

    expect(await screen.findByText("ripley hasn't written a review yet.")).toBeInTheDocument();
  });

  it("draws all four lists, including the empty ones", async () => {
    // They are *system* lists (SPEC §6.9): hiding the empty ones would make a
    // profile with only a Completed list look like it had no backlog at all.
    render(<ProfilePage />);

    for (const name of ["To Be Played", "Playing", "Completed", "Dropped"]) {
      expect(await screen.findByRole("heading", { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it("puts each game under the list it is on", async () => {
    respondWith(
      profile(),
      [],
      backlog([
        backlogEntry("PLAYING", { ...review().game, id: "g1", title: "Hades" }),
        backlogEntry("COMPLETED", { ...review().game, id: "g2", title: "Celeste" }),
      ]),
    );
    render(<ProfilePage />);

    const playing = await screen.findByLabelText("Playing");
    expect(within(playing).getByText("Hades")).toBeInTheDocument();
    expect(within(playing).queryByText("Celeste")).not.toBeInTheDocument();
    expect(
      within(await screen.findByLabelText("Completed")).getByText("Celeste"),
    ).toBeInTheDocument();
  });

  it("says an empty list is empty rather than leaving a blank", async () => {
    render(<ProfilePage />);

    expect(await screen.findByText("Nothing on Dropped.")).toBeInTheDocument();
  });

  it("addresses the owner of an empty list differently", async () => {
    respondWith(profile({ is_viewer: true }));
    render(<ProfilePage />);

    expect(await screen.findByText("Nothing on Dropped yet.")).toBeInTheDocument();
  });

  it("offers a follow button on someone else's profile", async () => {
    render(<ProfilePage />);

    expect(await screen.findByRole("button", { name: "Follow ripley" })).toBeInTheDocument();
  });

  it("reflects a request already sent", async () => {
    respondWith(profile({ viewer_follow_state: "REQUESTED" }));
    render(<ProfilePage />);

    expect(await screen.findByRole("button", { name: /cancel/i })).toHaveTextContent("Requested");
  });

  it("has no follow button on your own profile", async () => {
    respondWith(profile({ is_viewer: true }));
    render(<ProfilePage />);

    await screen.findByRole("link", { name: "Edit profile" });
    expect(screen.queryByRole("button", { name: /follow/i })).not.toBeInTheDocument();
  });

  it("has nothing to press when signed out", async () => {
    // Following is an action by somebody; the nav's sign-in link is the way to
    // become one.
    viewer = null;
    render(<ProfilePage />);

    await screen.findByRole("heading", { name: "ripley" });
    expect(screen.queryByRole("button", { name: /follow/i })).not.toBeInTheDocument();
  });

  it("moves the follower count with the button", async () => {
    render(<ProfilePage />);

    await userEvent.click(await screen.findByRole("button", { name: "Follow ripley" }));

    expect(await screen.findByText("1,205")).toBeInTheDocument();
  });

  it("re-reads a private profile after a follow changes what it may show", async () => {
    // A public account shows the same things either way; a private one opens or
    // closes, and the reviews already on screen would otherwise stay there.
    respondWith(profile({ is_private: true, can_view_content: false, stats: null }));
    render(<ProfilePage />);

    await userEvent.click(await screen.findByRole("button", { name: "Follow ripley" }));

    await waitFor(() =>
      expect(authedRequest.mock.calls.filter(([path]) => path === "/users/ripley")).toHaveLength(2),
    );
  });

  it("offers to remove a follower who follows you", async () => {
    respondWith(profile({ follows_viewer: true }));
    render(<ProfilePage />);

    await userEvent.click(await screen.findByRole("button", { name: /remove ripley/i }));

    expect(authedRequest).toHaveBeenCalledWith("/followers/11111111-1111-1111-1111-111111111111", {
      method: "DELETE",
    });
  });

  it("locks a private profile instead of showing empty sections", async () => {
    // SPEC §6.7: the shell stays visible, everything behind it does not.
    respondWith(
      profile({ is_private: true, can_view_content: false, stats: null, favorite_games: [] }),
    );
    render(<ProfilePage />);

    expect(await screen.findByText("This account is private")).toBeInTheDocument();
    expect(screen.queryByLabelText("Reviews grid")).not.toBeInTheDocument();
    expect(screen.queryByText("Favorite games")).not.toBeInTheDocument();
    // SPEC §6.9: lists inherit account privacy, so they go behind the same gate.
    expect(screen.queryByText("Lists")).not.toBeInTheDocument();
  });

  it("does not ask for a private account's reviews at all", async () => {
    // The API would answer with 403; not asking keeps that off the console and
    // makes the gate obvious from the network tab.
    respondWith(profile({ is_private: true, can_view_content: false, stats: null }));
    render(<ProfilePage />);

    await screen.findByText("This account is private");
    await settle();
    expect(authedRequest.mock.calls.map(([path]) => path)).toEqual(["/users/ripley"]);
  });

  it("still shows a private account's follower counts", async () => {
    respondWith(profile({ is_private: true, can_view_content: false, stats: null }));
    render(<ProfilePage />);

    expect(await screen.findByText("1,204")).toBeInTheDocument();
  });

  it("offers an edit link only on your own profile", async () => {
    render(<ProfilePage />);
    expect(await screen.findByRole("heading", { name: "ripley" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Edit profile" })).not.toBeInTheDocument();

    cleanup();
    respondWith(profile({ is_viewer: true }));
    render(<ProfilePage />);

    expect(await screen.findByRole("link", { name: "Edit profile" })).toHaveAttribute(
      "href",
      "/settings/profile",
    );
  });

  it("waits for the session before fetching", async () => {
    // The endpoint answers signed-out callers with 200, so firing early would
    // quietly render the anonymous view of your own profile — no Edit link, and
    // a private account's own content hidden from its owner. There is no 401 to
    // trigger authedRequest's retry, so the request must not go out early.
    isLoading = true;
    render(<ProfilePage />);

    await settle();
    expect(authedRequest).not.toHaveBeenCalled();
  });

  it("explains a missing profile in its own words", async () => {
    authedRequest.mockRejectedValue(new ApiError("No such user.", 404));
    render(<ProfilePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("There's nobody here by that name.");
  });
});
