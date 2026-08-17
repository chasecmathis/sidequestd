import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscoverResponse, GameSummary, UserMe } from "@sidequestd/api-types";

import DiscoverPage from "./page";

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
  usePathname: () => "/discover",
}));

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

// The app shell carries an unread badge (SPEC §6.12). Stubbed so this file's
// `authedRequest` mock is never asked for a count it has no answer for, and so
// these tests do not depend on a provider none of them are about.
vi.mock("@/lib/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
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

function game(id: string, title: string): GameSummary {
  return {
    id,
    slug: title.toLowerCase().replace(/\W+/g, "-"),
    title,
    cover_url: null,
    release_date: "2020-09-17",
    release_year: 2020,
    platforms: [],
    rating_count: 0,
  };
}

function discover(overrides: Partial<DiscoverResponse> = {}): DiscoverResponse {
  return {
    trending: [],
    new_releases: [],
    recommended: [],
    genres: [],
    platforms: [],
    ...overrides,
  };
}

function respondWith(body: DiscoverResponse) {
  authedRequest.mockImplementation((path: string) =>
    path.startsWith("/games/discover")
      ? Promise.resolve(body)
      : Promise.resolve({ items: [], next_cursor: null }),
  );
}

/** The section headed `title`, whichever order the page renders them in. */
function section(title: string): HTMLElement {
  return screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
}

beforeEach(() => {
  currentUser = me();
  respondWith(discover());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DiscoverPage recommendations", () => {
  it("shows the games the API picked for this reader", async () => {
    respondWith(discover({ recommended: [game("g1", "Hades"), game("g2", "Celeste")] }));

    render(<DiscoverPage />);

    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/games/discover"));
    const recommended = section("Recommended for you");
    expect(within(recommended).getByText("Hades")).toBeInTheDocument();
    expect(within(recommended).getByText("Celeste")).toBeInTheDocument();
  });

  it("keeps the API's order, because the order is the recommendation", async () => {
    respondWith(discover({ recommended: [game("g1", "Hades"), game("g2", "Celeste")] }));

    render(<DiscoverPage />);

    const recommended = section("Recommended for you");
    await within(recommended).findByText("Hades");
    const titles = within(recommended)
      .getAllByRole("heading", { level: 3 })
      .map((heading) => heading.textContent);
    expect(titles).toEqual(["Hades", "Celeste"]);
  });

  it("tells a signed-in reader what the picks are based on", async () => {
    render(<DiscoverPage />);

    expect(await screen.findByText(/genres you rate highly/i)).toBeInTheDocument();
  });

  it("does not claim to be personal for a visitor who has not signed in", async () => {
    // The section is still there and still useful — it is just popular, not
    // theirs, and saying otherwise would be a lie about a signed-out request.
    currentUser = null;

    render(<DiscoverPage />);

    expect(await screen.findByText(/Sign in to see picks/i)).toBeInTheDocument();
    expect(screen.queryByText(/genres you rate highly/i)).not.toBeInTheDocument();
  });

  it("says why the section is empty rather than showing a bare heading", async () => {
    render(<DiscoverPage />);

    const recommended = section("Recommended for you");
    await waitFor(() => expect(within(recommended).getByText(/Nothing to recommend/i)));
  });

  it("asks again once the session resolves, because the picks depend on who asks", async () => {
    // First paint happens before the session is known, and that request comes
    // back with what is popular rather than with this reader's own list.
    currentUser = null;
    const view = render(<DiscoverPage />);
    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/games/discover"));
    const before = authedRequest.mock.calls.filter((call) => call[0] === "/games/discover").length;

    currentUser = me();
    view.rerender(<DiscoverPage />);

    await waitFor(() => {
      const after = authedRequest.mock.calls.filter((call) => call[0] === "/games/discover").length;
      expect(after).toBeGreaterThan(before);
    });
  });
});

describe("DiscoverPage facets", () => {
  /** `count` genres named Genre 1…n — the API returns the catalog's whole list. */
  const genres = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `genre-${index + 1}`,
      name: `Genre ${index + 1}`,
      slug: `genre-${index + 1}`,
    }));

  it("shows a short list whole, with no toggle to press", async () => {
    respondWith(discover({ genres: genres(4) }));
    render(<DiscoverPage />);

    expect(await screen.findByRole("button", { name: "Genre 4" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Show all/ })).not.toBeInTheDocument();
  });

  it("collapses a long list behind a count", async () => {
    // The catalog's genres and platforms come back uncapped, so a real import
    // would otherwise push the results themselves off the screen.
    respondWith(discover({ genres: genres(20) }));
    render(<DiscoverPage />);

    expect(await screen.findByRole("button", { name: "Genre 8" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Genre 9" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all 20" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("reveals the rest when the toggle is pressed, and hides them again", async () => {
    respondWith(discover({ genres: genres(20) }));
    render(<DiscoverPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Show all 20" }));

    expect(screen.getByRole("button", { name: "Genre 20" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByRole("button", { name: "Genre 20" })).not.toBeInTheDocument();
  });

  it("keeps a selected chip visible after the list collapses again", async () => {
    // The whole reason collapsing is safe: a chip that is filtering the results
    // can never be the one hidden behind "Show all".
    respondWith(discover({ genres: genres(20) }));
    render(<DiscoverPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Show all 20" }));
    await userEvent.click(screen.getByRole("button", { name: "Genre 20" }));
    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));

    expect(screen.getByRole("button", { name: "Genre 20" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("clears a whole facet in one press", async () => {
    respondWith(discover({ genres: genres(20) }));
    render(<DiscoverPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Genre 1" }));
    await userEvent.click(await screen.findByRole("button", { name: "Genre 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear genre" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Genre 1" })).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    expect(screen.queryByRole("button", { name: "Clear genre" })).not.toBeInTheDocument();
  });

  it("asks the API for only the selected facets", async () => {
    respondWith(discover({ genres: genres(20) }));
    render(<DiscoverPage />);

    await userEvent.click(await screen.findByRole("button", { name: "Genre 3" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/games?genre=genre-3&sort=title&limit=10"),
    );
  });
});
