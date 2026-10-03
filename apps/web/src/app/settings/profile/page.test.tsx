import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@sidequestd/core";
import type { UserMe } from "@sidequestd/api-types";

import EditProfilePage from "./page";

const authedRequest = vi.fn();
const syncUser = vi.fn();
const replace = vi.fn();

function me(overrides: Partial<UserMe> = {}): UserMe {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    username: "ripley",
    display_name: "Ellen Ripley",
    bio: "Warrant officer.",
    avatar_url: null,
    is_private: false,
    created_at: "2026-01-01T00:00:00Z",
    email: "ripley@example.com",
    email_verified_at: null,
    ...overrides,
  };
}

let currentUser: UserMe | null = me();
let isLoading = false;

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
  usePathname: () => "/settings/profile",
}));

vi.mock("@sidequestd/core/auth", () => ({
  useAuth: () => ({
    authedRequest,
    syncUser,
    user: currentUser,
    isLoading,
    logout: vi.fn(),
  }),
}));

// The app shell carries an unread badge (SPEC §6.12). Stubbed so this file's
// `authedRequest` mock is never asked for a count it has no answer for, and so
// these tests do not depend on a provider none of them are about.
vi.mock("@sidequestd/core/notifications-store", () => ({
  useNotifications: () => ({ unreadCount: 0, markRead: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => {
  currentUser = me();
  isLoading = false;
  authedRequest.mockResolvedValue(me());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("EditProfilePage", () => {
  it("seeds the form from the signed-in record", () => {
    render(<EditProfilePage />);

    expect(screen.getByLabelText("Display name")).toHaveValue("Ellen Ripley");
    expect(screen.getByLabelText("Bio")).toHaveValue("Warrant officer.");
    expect(screen.getByRole("checkbox", { name: /Private account/ })).not.toBeChecked();
  });

  it("does not let the handle be edited here", () => {
    render(<EditProfilePage />);

    expect(screen.getByLabelText("Username")).toBeDisabled();
  });

  it("saves the edited fields with PATCH", async () => {
    render(<EditProfilePage />);

    await userEvent.clear(screen.getByLabelText("Bio"));
    await userEvent.type(screen.getByLabelText("Bio"), "Last survivor.");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/users/me", {
        method: "PATCH",
        body: {
          display_name: "Ellen Ripley",
          bio: "Last survivor.",
          is_private: false,
        },
      }),
    );
  });

  it("sends null rather than an empty string when a field is cleared", async () => {
    // The API rejects "" for display_name; null is how you clear it.
    render(<EditProfilePage />);

    await userEvent.clear(screen.getByLabelText("Display name"));
    await userEvent.clear(screen.getByLabelText("Bio"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/users/me", {
        method: "PATCH",
        body: { display_name: null, bio: null, is_private: false },
      }),
    );
  });

  it("toggles the private-account setting", async () => {
    render(<EditProfilePage />);

    await userEvent.click(screen.getByRole("checkbox", { name: /Private account/ }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith(
        "/users/me",
        expect.objectContaining({ body: expect.objectContaining({ is_private: true }) }),
      ),
    );
  });

  it("pushes the saved record back into the session", async () => {
    // Otherwise the nav and the profile page keep rendering the stale name.
    const updated = me({ display_name: "Ripley" });
    authedRequest.mockResolvedValue(updated);
    render(<EditProfilePage />);

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(syncUser).toHaveBeenCalledWith(updated));
    expect(await screen.findByText("Profile saved.")).toBeInTheDocument();
  });

  it("surfaces a failed save", async () => {
    authedRequest.mockRejectedValue(new ApiError("Can't reach the server.", 0));
    render(<EditProfilePage />);

    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  it("uploads a chosen picture as multipart", async () => {
    render(<EditProfilePage />);
    const file = new File(["\x89PNG"], "me.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("Change picture"), file);

    await waitFor(() => expect(authedRequest).toHaveBeenCalled());
    const [path, options] = authedRequest.mock.calls[0];
    expect(path).toBe("/users/me/avatar");
    expect(options.method).toBe("PUT");
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get("file")).toBe(file);
  });

  it("reports a rejected upload against the picture, not the form", async () => {
    // A real ApiError, because that is the only thing apiRequest ever throws and
    // the handler deliberately trusts nothing else to carry a user-safe message.
    authedRequest.mockRejectedValue(
      new ApiError("That file is too large. The limit is 5 MB.", 413),
    );
    render(<EditProfilePage />);

    await userEvent.upload(
      screen.getByLabelText("Change picture"),
      new File(["x"], "me.png", { type: "image/png" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/too large/);
  });

  it("offers Remove only when there is a picture to remove", async () => {
    render(<EditProfilePage />);
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();

    currentUser = me({ avatar_url: "http://localhost:9000/sidequestd-media/avatars/x/y.png" });
    render(<EditProfilePage />);

    await userEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]);

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/users/me/avatar", { method: "DELETE" }),
    );
  });

  it("sends an unauthenticated visitor to sign in", () => {
    currentUser = null;
    render(<EditProfilePage />);

    expect(replace).toHaveBeenCalledWith("/login");
  });
});
