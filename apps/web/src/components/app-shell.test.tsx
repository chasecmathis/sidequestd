import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UserMe } from "@sidequestd/api-types";

import { AppShell } from "./app-shell";

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
  usePathname: () => "/home",
}));

let currentUser: UserMe | null = null;

vi.mock("@sidequestd/core/auth", () => ({
  useAuth: () => ({
    user: currentUser,
    isLoading: false,
    authedRequest: vi.fn(),
    logout: vi.fn(),
    syncUser: vi.fn(),
  }),
}));

let unreadCount = 0;

vi.mock("@sidequestd/core/notifications-store", () => ({
  useNotifications: () => ({ unreadCount, markRead: vi.fn(), refresh: vi.fn() }),
}));

function me(overrides: Partial<UserMe> = {}): UserMe {
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
    ...overrides,
  };
}

beforeEach(() => {
  currentUser = me();
  unreadCount = 0;
});

describe("AppShell notifications tab", () => {
  it("offers the tab to a signed-in user", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute(
      "href",
      "/notifications",
    );
  });

  it("hides it when signed out, because there is no inbox to look at", () => {
    currentUser = null;

    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.queryByRole("link", { name: /Notifications/ })).not.toBeInTheDocument();
  });

  it("shows the unread count on the tab", () => {
    unreadCount = 3;

    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    // The number is in the accessible name rather than beside it, so a screen
    // reader is told what the 3 counts instead of just hearing "Notifications 3".
    const tab = screen.getByRole("link", { name: "Notifications, 3 unread" });
    expect(tab).toHaveTextContent("3");
  });

  it("shows no badge at all when nothing is unread", () => {
    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "Notifications" })).toHaveTextContent(
      /^Notifications$/,
    );
  });

  it("caps a large count so it still fits on the tab", () => {
    unreadCount = 250;

    render(
      <AppShell>
        <p>content</p>
      </AppShell>,
    );

    const tab = screen.getByRole("link", { name: "Notifications, 250 unread" });
    expect(tab).toHaveTextContent("99+");
  });
});
