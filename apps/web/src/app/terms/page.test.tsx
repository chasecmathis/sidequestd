import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TermsPage from "./page";

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
  usePathname: () => "/terms",
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

describe("TermsPage", () => {
  it("renders the terms", () => {
    render(<TermsPage />);

    expect(screen.getByRole("heading", { name: "Terms of service", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/^Last updated /)).toBeInTheDocument();
  });

  it("states that members keep ownership of what they post", () => {
    render(<TermsPage />);

    const main = within(screen.getByRole("main"));
    expect(main.getByRole("heading", { name: "4. What you post stays yours" })).toBeInTheDocument();
    expect(
      main.getByText(/You keep full ownership of your reviews, comments, photos and clips\./i),
    ).toBeInTheDocument();
  });

  it("names a jurisdiction rather than a placeholder", () => {
    render(<TermsPage />);

    // This replaces a test that asserted the *placeholder* was still there, which
    // was how an unfilled governing-law clause was kept from shipping unnoticed.
    // It is filled in now, so the guard flips: the document must name a
    // jurisdiction, and must not have regained a blank.
    const main = within(screen.getByRole("main"));
    expect(main.getByText(/State of Minnesota, United States/)).toBeInTheDocument();
    expect(main.queryByText(/\[.*to be specified\]/i)).not.toBeInTheDocument();
  });

  it("carries a DMCA procedure rather than an informal one", () => {
    render(<TermsPage />);

    // Safe harbor under §512 needs all three of these. Any one of them going
    // missing forfeits it, and losing one to an edit would be silent otherwise.
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("heading", { name: "8. Copyright complaints" })).toBeInTheDocument();
    expect(main.getByText(/Digital Millennium Copyright Act/)).toBeInTheDocument();
    expect(main.getByRole("heading", { name: "Repeat infringers" })).toBeInTheDocument();
    expect(main.getByText(/counter-notice to the same address/i)).toBeInTheDocument();
  });

  it("keeps a forum open to individuals alongside the class-action waiver", () => {
    render(<TermsPage />);

    // The waiver is the point of §14, but shipping it *without* the small-claims
    // carve-out is the version that reads as leaving members no forum at all —
    // and is the more likely half to be lost in an edit.
    const main = within(screen.getByRole("main"));
    expect(main.getByText(/class, consolidated or\s+representative action/i)).toBeInTheDocument();
    expect(main.getByText(/Small claims court is still open to you\./)).toBeInTheDocument();
  });
});
