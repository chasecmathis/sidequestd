import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserMe } from "@sidequestd/api-types";

import { UNREAD_POLL_MS } from "./notifications";
import { NotificationsProvider, useNotifications } from "./notifications-store";

const authedRequest = vi.fn();

let currentUser: UserMe | null = null;

vi.mock("./auth", () => ({
  useAuth: () => ({
    authedRequest,
    user: currentUser,
    isLoading: false,
    logout: vi.fn(),
    syncUser: vi.fn(),
  }),
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

/** A consumer that shows the count and can press the two actions. */
function Probe() {
  const { unreadCount, markRead, refresh } = useNotifications();
  return (
    <div>
      <output>{unreadCount}</output>
      <button type="button" onClick={() => void markRead()}>
        all
      </button>
      <button type="button" onClick={() => void markRead(["a"])}>
        one
      </button>
      <button type="button" onClick={refresh}>
        refresh
      </button>
    </div>
  );
}

function mount() {
  return render(
    <NotificationsProvider>
      <Probe />
    </NotificationsProvider>,
  );
}

function count(): string {
  return screen.getByRole("status").textContent ?? "";
}

beforeEach(() => {
  currentUser = me();
  authedRequest.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("NotificationsProvider", () => {
  it("asks for the count as soon as there is a session", async () => {
    authedRequest.mockResolvedValue({ count: 4 });

    mount();

    await waitFor(() => expect(count()).toBe("4"));
    expect(authedRequest).toHaveBeenCalledWith("/notifications/unread-count");
  });

  it("asks for nothing at all when signed out", () => {
    currentUser = null;

    mount();

    expect(authedRequest).not.toHaveBeenCalled();
    expect(count()).toBe("0");
  });

  it("keeps a failed count quiet rather than putting an error on the page", async () => {
    authedRequest.mockRejectedValue(new Error("offline"));

    mount();

    await waitFor(() => expect(authedRequest).toHaveBeenCalled());
    expect(count()).toBe("0");
  });

  it("polls, because in-app delivery has nothing to push the number down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    authedRequest.mockResolvedValue({ count: 1 });

    mount();
    await waitFor(() => expect(authedRequest).toHaveBeenCalledTimes(1));

    await act(async () => {
      vi.advanceTimersByTime(UNREAD_POLL_MS);
    });

    expect(authedRequest).toHaveBeenCalledTimes(2);
  });

  it("marks everything read with a null id list, which the API reads as 'all'", async () => {
    authedRequest.mockResolvedValueOnce({ count: 5 }).mockResolvedValueOnce({
      marked: 5,
      unread_count: 0,
    });

    mount();
    await waitFor(() => expect(count()).toBe("5"));
    await userEvent.click(screen.getByRole("button", { name: "all" }));

    expect(authedRequest).toHaveBeenLastCalledWith("/notifications/read", {
      method: "POST",
      // Never `[]`: an empty array means "none" to the API.
      body: { ids: null },
    });
    await waitFor(() => expect(count()).toBe("0"));
  });

  it("takes the new count from the server rather than subtracting one", async () => {
    // Something arrived between the page loading and the button being pressed,
    // so 5 - 1 would be wrong and the server's 6 is right.
    authedRequest.mockResolvedValueOnce({ count: 5 }).mockResolvedValueOnce({
      marked: 1,
      unread_count: 6,
    });

    mount();
    await waitFor(() => expect(count()).toBe("5"));
    await userEvent.click(screen.getByRole("button", { name: "one" }));

    await waitFor(() => expect(count()).toBe("6"));
  });

  it("clears the badge when the session ends", async () => {
    authedRequest.mockResolvedValue({ count: 3 });
    const view = mount();
    await waitFor(() => expect(count()).toBe("3"));

    currentUser = null;
    view.rerender(
      <NotificationsProvider>
        <Probe />
      </NotificationsProvider>,
    );

    // A number left over from the last session is a badge about somebody else.
    await waitFor(() => expect(count()).toBe("0"));
  });
});
