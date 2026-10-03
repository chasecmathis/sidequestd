import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameSummary, UserSearchResult } from "@sidequestd/api-types";

import SearchPage from "./page";

const authedRequest = vi.fn();

// The shells render a theme control, which the root layout provides for in the
// real app. Stubbed rather than wrapped, matching how auth and notifications are
// handled just below; `importActual` keeps the module's constants real so a
// renamed export still breaks loudly.
vi.mock("@sidequestd/core/theme", async (importActual) => ({
  ...(await importActual<typeof import("@sidequestd/core/theme")>()),
  useTheme: () => ({ theme: "system" as const, resolved: "dark" as const, setTheme: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/search",
}));

vi.mock("@sidequestd/core/auth", () => ({
  useAuth: () => ({ authedRequest, user: null, logout: vi.fn() }),
}));

// The app shell carries an unread badge (SPEC §6.12). Stubbed so this file's
// `authedRequest` mock is never asked for a count it has no answer for, and so
// these tests do not depend on a provider none of them are about.
vi.mock("@sidequestd/core/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
}));

// Results carry an add-to-list control (SPEC §6.9), which reads the viewer's own
// backlog from a provider this page's tests do not mount. Stubbed rather than
// wrapped: what the control does has its own tests, and a real store here would
// answer `/users/me/lists` out of the search mock.
vi.mock("@sidequestd/core/backlog-store", () => ({
  useBacklog: () => ({
    statuses: new Map(),
    ensureLoaded: vi.fn(),
    setStatus: vi.fn(),
    clearStatus: vi.fn(),
  }),
}));

let gameId = 0;

function game(title: string): GameSummary {
  gameId += 1;
  return {
    id: `33333333-3333-3333-3333-${String(gameId).padStart(12, "0")}`,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    title,
    cover_url: null,
    release_date: "2022-02-25",
    release_year: 2022,
    rating_count: 0,
    platforms: [{ id: "p1", name: "PlayStation 5", slug: "playstation-5" }],
  };
}

function user(overrides: Partial<UserSearchResult>): UserSearchResult {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    username: "ripley",
    display_name: "Ellen Ripley",
    avatar_url: null,
    is_private: false,
    review_count: 3,
    ...overrides,
  };
}

beforeEach(() => {
  authedRequest.mockResolvedValue({ items: [], next_cursor: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("SearchPage", () => {
  it("prompts before anything is typed instead of firing a request", async () => {
    render(<SearchPage />);

    expect(screen.getByText("Search the catalog by title.")).toBeInTheDocument();
    expect(authedRequest).not.toHaveBeenCalled();
  });

  it("searches games by title", async () => {
    authedRequest.mockResolvedValue({
      items: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          slug: "elden-ring",
          title: "Elden Ring",
          cover_url: null,
          release_date: "2022-02-25",
          release_year: 2022,
          rating_count: 0,
          platforms: [{ id: "p1", name: "PlayStation 5", slug: "playstation-5" }],
        },
      ],
      next_cursor: null,
    });
    render(<SearchPage />);

    await userEvent.type(screen.getByLabelText("Search games"), "elden");

    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/search/games?q=elden"));
    expect(await screen.findByText("Elden Ring")).toBeInTheDocument();
  });

  it("switches to the user endpoint on the users tab", async () => {
    render(<SearchPage />);

    await userEvent.type(screen.getByLabelText("Search games"), "ripley");
    await userEvent.click(screen.getByRole("tab", { name: "users" }));

    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/search/users?q=ripley"));
  });

  it("shows a private account's review count as gated, not as zero", async () => {
    // SPEC §6.7: null means withheld. Rendering "0 reviews" would misstate it.
    authedRequest.mockResolvedValue({
      items: [user({ username: "newt", is_private: true, review_count: null })],
      next_cursor: null,
    });
    render(<SearchPage />);

    await userEvent.click(screen.getByRole("tab", { name: "users" }));
    await userEvent.type(screen.getByLabelText("Search users"), "newt");

    expect(await screen.findByText("Private account")).toBeInTheDocument();
    expect(screen.queryByText(/0 reviews/)).not.toBeInTheDocument();
  });

  it("shows the review count when the API supplied one", async () => {
    authedRequest.mockResolvedValue({ items: [user({ review_count: 3 })], next_cursor: null });
    render(<SearchPage />);

    await userEvent.click(screen.getByRole("tab", { name: "users" }));
    await userEvent.type(screen.getByLabelText("Search users"), "ripley");

    expect(await screen.findByText("3 reviews")).toBeInTheDocument();
  });

  it("surfaces a failed search", async () => {
    authedRequest.mockRejectedValue(new Error("Can't reach the server."));
    render(<SearchPage />);

    await userEvent.type(screen.getByLabelText("Search games"), "elden");

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  describe("paging", () => {
    it("offers no way to page a result set the API says is complete", async () => {
      authedRequest.mockResolvedValue({ items: [game("Mario Kart")], next_cursor: null });
      render(<SearchPage />);

      await userEvent.type(screen.getByLabelText("Search games"), "m");

      expect(await screen.findByText("Mario Kart")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("offers Load more when the API returned a cursor", async () => {
      // A vague term is the case this exists for: the reader gets the top hits
      // and no signal at all that the list was cut off.
      authedRequest.mockResolvedValue({ items: [game("Mario Kart")], next_cursor: "page-two" });
      render(<SearchPage />);

      await userEvent.type(screen.getByLabelText("Search games"), "m");

      expect(await screen.findByRole("button", { name: "Load more" })).toBeInTheDocument();
    });

    it("appends the next page rather than replacing what is on screen", async () => {
      authedRequest.mockResolvedValue({ items: [game("Mario Kart")], next_cursor: "page-two" });
      render(<SearchPage />);
      await userEvent.type(screen.getByLabelText("Search games"), "m");
      // Page one has to have landed before the mock is swapped, or the swap
      // races the debounce and page one answers with the page-two body.
      await screen.findByText("Mario Kart");

      authedRequest.mockResolvedValue({ items: [game("Metroid Dread")], next_cursor: null });
      await userEvent.click(screen.getByRole("button", { name: "Load more" }));

      expect(authedRequest).toHaveBeenCalledWith("/search/games?q=m&cursor=page-two");
      expect(await screen.findByText("Metroid Dread")).toBeInTheDocument();
      expect(screen.getByText("Mario Kart")).toBeInTheDocument();
      // The API said that was the last page, so the control retires.
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    });

    it("pages the tab that is open, not the one the page opened on", async () => {
      authedRequest.mockResolvedValue({ items: [user({})], next_cursor: "page-two" });
      render(<SearchPage />);

      await userEvent.click(screen.getByRole("tab", { name: "users" }));
      await userEvent.type(screen.getByLabelText("Search users"), "ripley");
      await screen.findByText("@ripley");

      authedRequest.mockResolvedValue({
        items: [user({ id: "44444444-4444-4444-4444-444444444444", username: "newt" })],
        next_cursor: null,
      });
      await userEvent.click(screen.getByRole("button", { name: "Load more" }));

      expect(authedRequest).toHaveBeenCalledWith("/search/users?q=ripley&cursor=page-two");
    });

    it("drops a page that arrives after the reader has typed something else", async () => {
      // The debounced effect knows nothing about an in-flight `loadMore`, so
      // without the staleness guard the tail of "m" lands under the results
      // for "mario".
      authedRequest.mockResolvedValue({ items: [game("Mario Kart")], next_cursor: "page-two" });
      render(<SearchPage />);
      const field = screen.getByLabelText("Search games");
      await userEvent.type(field, "m");
      await screen.findByRole("button", { name: "Load more" });

      // Page two never settles until the term has already moved on.
      let releasePageTwo: (value: unknown) => void = () => {};
      authedRequest.mockReturnValueOnce(
        new Promise((resolve) => {
          releasePageTwo = resolve;
        }),
      );
      await userEvent.click(screen.getByRole("button", { name: "Load more" }));

      authedRequest.mockResolvedValue({ items: [game("Mario Odyssey")], next_cursor: null });
      await userEvent.type(field, "ario");
      expect(await screen.findByText("Mario Odyssey")).toBeInTheDocument();

      releasePageTwo({ items: [game("Metroid Dread")], next_cursor: null });
      await waitFor(() => expect(screen.queryByText("Metroid Dread")).not.toBeInTheDocument());
      expect(screen.getByText("Mario Odyssey")).toBeInTheDocument();
    });
  });
});
