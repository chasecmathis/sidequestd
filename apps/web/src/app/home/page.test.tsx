import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { settle } from "@/test-support";
import type {
  FeedActivityItem,
  FeedItem,
  FeedSuggestions,
  RecommendationReason,
  ReviewSummary,
  UserMe,
} from "@sidequestd/api-types";

import HomePage from "./page";

const authedRequest = vi.fn();
const replace = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/home",
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
    playtime_minutes: null,
    created_at: "2026-03-01T12:00:00Z",
    updated_at: "2026-03-01T12:00:00Z",
    like_count: 0,
    comment_count: 0,
    viewer_has_liked: false,
    media_count: 0,
    thumbnail_url: null,
    ...overrides,
  };
}

function item(overrides: Partial<ReviewSummary> = {}): FeedItem {
  const body = review(overrides);
  return { type: "review", id: body.id, occurred_at: body.created_at, review: body };
}

function activity(overrides: Partial<FeedActivityItem> = {}): FeedItem {
  return {
    type: "backlog_activity",
    id: "b1",
    occurred_at: "2026-03-01T11:00:00Z",
    actor: {
      id: "u1",
      username: "ripley",
      display_name: "Ellen Ripley",
      bio: null,
      avatar_url: null,
      is_private: false,
      created_at: "2026-01-01T00:00:00Z",
    },
    game: review().game,
    status: "PLAYING",
    ...overrides,
  };
}

function recommended(
  reason: RecommendationReason = "recommended_game",
  overrides: Partial<ReviewSummary> = {},
): FeedItem {
  const body = review({ id: "r9", ...overrides });
  return {
    type: "recommended_review",
    id: body.id,
    occurred_at: body.created_at,
    review: body,
    reason,
  };
}

function suggestions(overrides: Partial<FeedSuggestions> = {}): FeedSuggestions {
  return {
    accounts: [
      {
        id: "u1",
        username: "ripley",
        display_name: "Ellen Ripley",
        bio: null,
        avatar_url: null,
        is_private: false,
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    trending: [
      {
        game: {
          id: "g9",
          slug: "hades-ii",
          title: "Hades II",
          cover_url: null,
          release_date: "2025-05-06",
          release_year: 2025,
          platforms: [],
        },
        score: 42,
        window: "7d",
      },
    ],
    ...overrides,
  };
}

/** The page reads the feed and, when it is empty, the suggestions. By path. */
function respondWith(
  pages: { items: FeedItem[]; next_cursor: string | null }[],
  empty = suggestions(),
) {
  const queue = [...pages];
  authedRequest.mockImplementation((path: string) => {
    if (path.startsWith("/feed/suggestions")) return Promise.resolve(empty);
    if (path.startsWith("/feed")) {
      return Promise.resolve(queue.shift() ?? { items: [], next_cursor: null });
    }
    return Promise.resolve(undefined);
  });
}

beforeEach(() => {
  currentUser = me();
  isLoading = false;
  respondWith([{ items: [item()], next_cursor: null }]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("HomePage", () => {
  it("asks for the first page of the feed", async () => {
    render(<HomePage />);

    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/feed?limit=10"));
  });

  it("renders a card per review", async () => {
    respondWith([
      {
        items: [item(), item({ id: "r2", game: { ...review().game, title: "Hades" } })],
        next_cursor: null,
      },
    ]);
    render(<HomePage />);

    const feed = await screen.findByLabelText("Feed");
    expect(within(feed).getAllByRole("article")).toHaveLength(2);
    expect(within(feed).getByText("Hades")).toBeInTheDocument();
  });

  it("skips a kind of item it has not been taught about", async () => {
    // Whatever SPEC §6.11 blends in next does this to a client built today:
    // leaves a gap, rather than crashing the middle of somebody's feed.
    const unknown = { type: "achievement", id: "a7", occurred_at: "2026-03-01T12:00:00Z" };
    respondWith([{ items: [item(), unknown as unknown as FeedItem], next_cursor: null }]);
    render(<HomePage />);

    const feed = await screen.findByLabelText("Feed");
    expect(within(feed).getAllByRole("article")).toHaveLength(1);
  });

  it("blends a backlog status change in with the reviews", async () => {
    respondWith([{ items: [item(), activity()], next_cursor: null }]);
    render(<HomePage />);

    const feed = await screen.findByLabelText("Feed");
    expect(within(feed).getAllByRole("article")).toHaveLength(2);
    expect(within(feed).getByText("started playing")).toBeInTheDocument();
  });

  it("keeps an activity line lighter than a review", async () => {
    // SPEC §6.11: reviews lead, activity is visually lighter-weight. Concretely,
    // there is nothing on an activity row to like — it is not a piece of writing.
    respondWith([{ items: [activity()], next_cursor: null }]);
    render(<HomePage />);

    await screen.findByLabelText("Feed");
    expect(screen.queryByRole("button", { name: /like/i })).not.toBeInTheDocument();
  });

  it("marks a recommended review as recommended", async () => {
    // SPEC §6.4: the blend must be "clearly distinguishable from pure follow
    // feed". A reader who cannot tell has been shown an advert.
    respondWith([{ items: [item(), recommended()], next_cursor: null }]);
    render(<HomePage />);

    const feed = await screen.findByLabelText("Feed");
    expect(within(feed).getByLabelText("Recommended for you")).toBeInTheDocument();
    expect(within(feed).getAllByRole("article")).toHaveLength(2);
  });

  it("says why a recommended review is there", async () => {
    respondWith([{ items: [recommended("suggested_account")], next_cursor: null }]);
    render(<HomePage />);

    expect(await screen.findByText(/rates like you/i)).toBeInTheDocument();
  });

  it("labels a follow item as nothing at all", async () => {
    // The distinction has to cut both ways, or it stops being one.
    render(<HomePage />);

    await screen.findByLabelText("Feed");
    expect(screen.queryByLabelText("Recommended for you")).not.toBeInTheDocument();
  });

  it("keeps a recommended review as interactive as any other row", async () => {
    // The API sends the identical review, and a card the reader cannot act on
    // would be a worse row than the ones around it.
    respondWith([{ items: [recommended()], next_cursor: null }]);
    render(<HomePage />);

    await screen.findByLabelText("Feed");
    expect(screen.getByRole("button", { name: /like/i })).toBeInTheDocument();
  });

  it("says when there is nothing left to load", async () => {
    render(<HomePage />);

    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("loads the next page with the cursor it was given", async () => {
    respondWith([
      { items: [item()], next_cursor: "page2" },
      { items: [item({ id: "r2" })], next_cursor: null },
    ]);
    render(<HomePage />);

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

    expect(authedRequest).toHaveBeenCalledWith("/feed?limit=10&cursor=page2");
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  });

  it("keeps what it already showed when a page is appended", async () => {
    respondWith([
      { items: [item({ id: "r1", review_text: "First." })], next_cursor: "page2" },
      { items: [item({ id: "r2", review_text: "Second." })], next_cursor: null },
    ]);
    render(<HomePage />);

    await userEvent.click(await screen.findByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getByText(/Second\./)).toBeInTheDocument());
    expect(screen.getByText(/First\./)).toBeInTheDocument();
  });

  it("does not fetch the same cursor twice when pressed twice", async () => {
    respondWith([
      { items: [item()], next_cursor: "page2" },
      { items: [item({ id: "r2" })], next_cursor: null },
    ]);
    render(<HomePage />);

    const button = await screen.findByRole("button", { name: "Load more" });
    await userEvent.click(button);
    await userEvent.click(button);

    const pageTwo = authedRequest.mock.calls.filter(([path]) => path.includes("cursor=page2"));
    expect(pageTwo).toHaveLength(1);
  });

  it("offers somewhere to go when the feed is empty", async () => {
    respondWith([{ items: [], next_cursor: null }]);
    render(<HomePage />);

    expect(await screen.findByText(/Your feed is quiet/)).toBeInTheDocument();
    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/feed/suggestions"));
  });

  it("suggests accounts to follow", async () => {
    respondWith([{ items: [], next_cursor: null }]);
    render(<HomePage />);

    const list = await screen.findByLabelText("Suggested accounts");
    expect(within(list).getByRole("link", { name: "Ellen Ripley" })).toHaveAttribute(
      "href",
      "/profile/ripley",
    );
    expect(within(list).getByRole("button", { name: /Follow/ })).toBeInTheDocument();
  });

  it("shows trending games alongside them", async () => {
    respondWith([{ items: [], next_cursor: null }]);
    render(<HomePage />);

    expect(await screen.findByText("Hades II")).toBeInTheDocument();
  });

  it("leaves out a section it has nothing for", async () => {
    // Trending is materialised (SPEC §6.11) and empty until the job has run. An
    // empty heading would read as something broken.
    respondWith([{ items: [], next_cursor: null }], suggestions({ trending: [] }));
    render(<HomePage />);

    await screen.findByText(/Your feed is quiet/);
    expect(screen.queryByText("Trending games")).not.toBeInTheDocument();
  });

  it("does not ask for suggestions when there is a feed to show", async () => {
    render(<HomePage />);

    await screen.findByLabelText("Feed");
    expect(authedRequest).not.toHaveBeenCalledWith("/feed/suggestions");
  });

  it("explains a feed that would not load", async () => {
    authedRequest.mockRejectedValue(new ApiError("Can't reach the server.", 0));
    render(<HomePage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  it("sends a signed-out visitor to sign in", async () => {
    currentUser = null;
    render(<HomePage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(authedRequest).not.toHaveBeenCalled();
  });

  it("does not bounce anyone to sign in while the session is still loading", async () => {
    // The refresh cookie may yet produce a user; redirecting first would sign
    // out everyone who arrived by typing the URL.
    currentUser = null;
    isLoading = true;
    render(<HomePage />);

    await settle();
    expect(replace).not.toHaveBeenCalled();
    expect(authedRequest).not.toHaveBeenCalled();
  });
});
