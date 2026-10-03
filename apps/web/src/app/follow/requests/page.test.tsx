import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@sidequestd/core";
import { settle } from "@/test-support";
import type { FollowRequest, UserMe } from "@sidequestd/api-types";

import FollowRequestsPage from "./page";

const authedRequest = vi.fn();
const replace = vi.fn();

// The shells render a theme control, which the root layout provides for in the
// real app. Stubbed rather than wrapped, matching how auth and notifications are
// handled just below; `importActual` keeps the module's constants real so a
// renamed export still breaks loudly.
vi.mock("@sidequestd/core/theme", async (importActual) => ({
  ...(await importActual<typeof import("@sidequestd/core/theme")>()),
  useTheme: () => ({ theme: "system" as const, resolved: "dark" as const, setTheme: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/follow/requests",
}));

let currentUser: UserMe | null = null;
let isLoading = false;

vi.mock("@sidequestd/core/auth", () => ({
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
vi.mock("@sidequestd/core/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
}));

function me(overrides: Partial<UserMe> = {}): UserMe {
  return {
    id: "me",
    username: "newt",
    display_name: null,
    bio: null,
    avatar_url: null,
    is_private: true,
    created_at: "2026-01-01T00:00:00Z",
    email: "newt@example.com",
    email_verified_at: null,
    ...overrides,
  };
}

function request(overrides: Partial<FollowRequest["user"]> = {}): FollowRequest {
  return {
    user: {
      id: "u1",
      username: "hicks",
      display_name: "Dwayne Hicks",
      bio: null,
      avatar_url: null,
      is_private: false,
      created_at: "2026-01-01T00:00:00Z",
      ...overrides,
    },
    requested_at: "2026-02-01T00:00:00Z",
  };
}

function respondWith(...items: FollowRequest[]) {
  authedRequest.mockImplementation((path: string) =>
    path.startsWith("/follow/requests?")
      ? Promise.resolve({ items, next_cursor: null })
      : Promise.resolve(undefined),
  );
}

beforeEach(() => {
  currentUser = me();
  isLoading = false;
  respondWith();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("FollowRequestsPage", () => {
  it("lists who is waiting", async () => {
    respondWith(request(), request({ id: "u2", username: "bishop", display_name: null }));
    render(<FollowRequestsPage />);

    const list = await screen.findByLabelText("Follow requests");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Dwayne Hicks")).toBeInTheDocument();
  });

  it("approves a request", async () => {
    respondWith(request());
    render(<FollowRequestsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /approve/i }));

    expect(authedRequest).toHaveBeenCalledWith("/follow/requests/u1/accept", { method: "POST" });
  });

  it("declines a request", async () => {
    respondWith(request());
    render(<FollowRequestsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /decline/i }));

    expect(authedRequest).toHaveBeenCalledWith("/follow/requests/u1/decline", { method: "POST" });
  });

  it("drops the row once it is answered", async () => {
    // Leaving it in place invites a second press on a request that no longer
    // exists, which the API answers with a 404 that reads like a bug.
    respondWith(request());
    render(<FollowRequestsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.queryByText("hicks")).not.toBeInTheDocument());
    expect(screen.getByText("No requests waiting.")).toBeInTheDocument();
  });

  it("only removes the row that was answered", async () => {
    respondWith(request(), request({ id: "u2", username: "bishop" }));
    render(<FollowRequestsPage />);

    const list = await screen.findByLabelText("Follow requests");
    await userEvent.click(within(list).getAllByRole("button", { name: /approve/i })[0]);

    await waitFor(() => expect(screen.queryByText("hicks")).not.toBeInTheDocument());
    expect(screen.getByText("bishop")).toBeInTheDocument();
  });

  it("keeps the row and explains itself when answering fails", async () => {
    respondWith(request());
    authedRequest.mockImplementation((path: string) =>
      path.endsWith("/accept")
        ? Promise.reject(new ApiError("There is no pending follow request from that user.", 404))
        : Promise.resolve({ items: [request()], next_cursor: null }),
    );
    render(<FollowRequestsPage />);

    await userEvent.click(await screen.findByRole("button", { name: /approve/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no pending follow request");
    expect(screen.getByText("hicks")).toBeInTheDocument();
  });

  it("says why a public account has nothing here", async () => {
    // A public account is followed without being asked (SPEC §6.7), so "empty"
    // would look like a bug rather than the design.
    currentUser = me({ is_private: false });
    render(<FollowRequestsPage />);

    expect(
      await screen.findByText("Your account is public, so people follow you without asking."),
    ).toBeInTheDocument();
  });

  it("sends a signed-out visitor to sign in", async () => {
    currentUser = null;
    render(<FollowRequestsPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(authedRequest).not.toHaveBeenCalled();
  });

  it("waits for the session before asking", async () => {
    isLoading = true;
    currentUser = null;
    render(<FollowRequestsPage />);

    await settle();
    expect(replace).not.toHaveBeenCalled();
    expect(authedRequest).not.toHaveBeenCalled();
  });

  it("explains a failed load rather than spinning", async () => {
    authedRequest.mockRejectedValue(new ApiError("Can't reach the server.", 0));
    render(<FollowRequestsPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
