import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AboutPage from "./page";

// The page itself is a server component, but it is a plain synchronous function
// returning JSX, so it renders here directly. What it renders — `AppShell` — is
// the part that needs the app's providers, and these are the same stubs the
// other route tests use.
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
  usePathname: () => "/about",
}));

vi.mock("@sidequestd/core/auth", () => ({
  useAuth: () => ({
    authedRequest: vi.fn(),
    user: null,
    isLoading: false,
    logout: vi.fn(),
    syncUser: vi.fn(),
  }),
}));

vi.mock("@sidequestd/core/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
}));

/**
 * Everything asserted below is scoped to `main`.
 *
 * The shell now renders a footer that carries its own Privacy, Terms and IGDB
 * links, so an unscoped `getByRole("link", { name: "Privacy" })` matches two
 * elements and throws. Scoping says which one the test is actually about.
 */
function main() {
  return within(screen.getByRole("main"));
}

describe("AboutPage", () => {
  it("renders for a signed-out visitor", () => {
    render(<AboutPage />);

    expect(
      screen.getByRole("heading", { name: "What Sidequestd is", level: 1 }),
    ).toBeInTheDocument();
  });

  it("credits IGDB as the source of the game data", () => {
    render(<AboutPage />);

    expect(
      main().getByRole("heading", { name: "Where the game data comes from" }),
    ).toBeInTheDocument();
    expect(
      main().getByText(/not affiliated with, endorsed by, or sponsored by IGDB/i),
    ).toBeInTheDocument();
  });

  it("explains why a game carries two different ratings", () => {
    render(<AboutPage />);

    expect(main().getByRole("heading", { name: "Two scores, not one" })).toBeInTheDocument();
  });

  it("offers a way to get in touch and reach the policies", () => {
    render(<AboutPage />);

    expect(main().getByRole("link", { name: "hello@sidequestd.app" })).toHaveAttribute(
      "href",
      "mailto:hello@sidequestd.app",
    );
    expect(main().getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
    expect(main().getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });
});
