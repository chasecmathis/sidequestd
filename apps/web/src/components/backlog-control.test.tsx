import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UserMe } from "@sidequestd/api-types";

import { BacklogProvider } from "@/lib/backlog-store";

import { BacklogControl } from "./backlog-control";

const authedRequest = vi.fn();

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

const game = { id: "g1", title: "Hades" };

/**
 * The real provider, given a backlog through the mocked `authedRequest`.
 *
 * Wrapping rather than stubbing the store: what is worth testing here is the
 * round trip — the control shows what the store loaded, and a choice reaches
 * `PUT /backlog/{id}` and comes back as the new value.
 */
function mount(lists: unknown = { lists: [] }) {
  authedRequest.mockImplementation((path: string, options?: { method?: string }) => {
    if (path === "/users/me/lists") return Promise.resolve(lists);
    if (options?.method === "PUT") return Promise.resolve({ status: "PLAYING" });
    return Promise.resolve(undefined);
  });

  render(
    <BacklogProvider>
      <BacklogControl game={game} />
    </BacklogProvider>,
  );
}

beforeEach(() => {
  currentUser = me();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("BacklogControl", () => {
  it("offers all four lists", async () => {
    mount();

    const select = await screen.findByLabelText("Backlog list for Hades");
    expect([...select.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
      "Add to list",
      "To Be Played",
      "Playing",
      "Completed",
      "Dropped",
    ]);
  });

  it("starts on the prompt when the game is on no list", async () => {
    mount();

    const select = await screen.findByLabelText<HTMLSelectElement>("Backlog list for Hades");
    expect(select.value).toBe("");
  });

  it("shows the list a game is already on", async () => {
    mount({
      lists: [
        {
          status: "COMPLETED",
          items: [
            {
              id: "b1",
              game: { ...game, slug: "hades", cover_url: null, release_date: null, platforms: [] },
              status: "COMPLETED",
              position: 0,
              created_at: "2026-02-01T00:00:00Z",
              status_changed_at: "2026-02-01T00:00:00Z",
            },
          ],
        },
      ],
    });

    const select = await screen.findByLabelText<HTMLSelectElement>("Backlog list for Hades");
    await waitFor(() => expect(select.value).toBe("COMPLETED"));
  });

  it("sends the chosen status", async () => {
    mount();

    const select = await screen.findByLabelText("Backlog list for Hades");
    await userEvent.selectOptions(select, "PLAYING");

    expect(authedRequest).toHaveBeenCalledWith("/backlog/g1", {
      method: "PUT",
      body: { status: "PLAYING" },
    });
  });

  it("keeps the status the server confirmed", async () => {
    mount();

    const select = await screen.findByLabelText<HTMLSelectElement>("Backlog list for Hades");
    await userEvent.selectOptions(select, "COMPLETED");

    // The mock answers PLAYING whatever was asked for: the control takes the
    // server's word, so a status the API declined to set does not stick on screen.
    await waitFor(() => expect(select.value).toBe("PLAYING"));
  });

  it("only offers removal once a game is on a list", async () => {
    mount();

    const select = await screen.findByLabelText("Backlog list for Hades");
    expect(select.querySelector('option[value="__remove"]')).toBeNull();

    await userEvent.selectOptions(select, "PLAYING");

    await waitFor(() => expect(select.querySelector('option[value="__remove"]')).not.toBeNull());
  });

  it("takes a game off the backlog", async () => {
    mount();

    const select = await screen.findByLabelText<HTMLSelectElement>("Backlog list for Hades");
    await userEvent.selectOptions(select, "PLAYING");
    await waitFor(() => expect(select.value).toBe("PLAYING"));

    await userEvent.selectOptions(select, "__remove");

    expect(authedRequest).toHaveBeenCalledWith("/backlog/g1", { method: "DELETE" });
    await waitFor(() => expect(select.value).toBe(""));
  });

  it("says so when a change did not go through", async () => {
    mount();
    const select = await screen.findByLabelText("Backlog list for Hades");
    authedRequest.mockRejectedValueOnce(new Error("Can't reach the server."));

    await userEvent.selectOptions(select, "PLAYING");

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  it("shows nothing to a signed-out reader", async () => {
    currentUser = null;
    mount();

    expect(screen.queryByLabelText("Backlog list for Hades")).not.toBeInTheDocument();
  });

  it("does not fetch a backlog for a signed-out reader", async () => {
    currentUser = null;
    mount();

    expect(authedRequest).not.toHaveBeenCalled();
  });
});
