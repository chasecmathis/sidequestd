import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FavoriteGameEntry, GameSummary } from "@sidequestd/api-types";

import { FavoriteGames } from "./favorite-games";

const authedRequest = vi.fn();

vi.mock("@sidequestd/core/auth", () => ({
  useAuth: () => ({ authedRequest, user: null, isLoading: false, logout: vi.fn() }),
}));

function game(id: string, title: string): GameSummary {
  return {
    id,
    slug: title.toLowerCase().replace(/\W+/g, "-"),
    title,
    cover_url: null,
    release_date: "2020-09-17",
    release_year: 2020,
    rating_count: 0,
    platforms: [],
  };
}

/** The API returns the whole list from every mutation, in pinned order. */
function entriesOf(...games: GameSummary[]): FavoriteGameEntry[] {
  return games.map((entry, index) => ({ position: index, game: entry }));
}

const hades = game("g1", "Hades");
const celeste = game("g2", "Celeste");
const tunic = game("g3", "Tunic");

beforeEach(() => {
  authedRequest.mockResolvedValue(entriesOf(hades, celeste));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FavoriteGames", () => {
  it("shows the pinned games in order, numbered", async () => {
    render(
      <FavoriteGames entries={entriesOf(hades, celeste)} isViewer={false} username="ripley" />,
    );

    expect(screen.getByText("Hades")).toBeInTheDocument();
    expect(screen.getByText("Celeste")).toBeInTheDocument();
    expect(screen.getByText("01")).toBeInTheDocument();
    expect(screen.getByText("02")).toBeInTheDocument();
  });

  it("gives a visitor no way to edit somebody else's pins", () => {
    render(<FavoriteGames entries={entriesOf(hades)} isViewer={false} username="ripley" />);

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Unpin/ })).not.toBeInTheDocument();
  });

  it("names the other person when their list is empty", () => {
    render(<FavoriteGames entries={[]} isViewer={false} username="ripley" />);

    expect(screen.getByText("@ripley hasn't pinned any games yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pin a game" })).not.toBeInTheDocument();
  });

  it("invites the owner to fill an empty list", () => {
    render(<FavoriteGames entries={[]} isViewer={true} username="ripley" />);

    expect(screen.getByRole("button", { name: "Pin a game" })).toBeInTheDocument();
  });

  describe("editing", () => {
    async function enterEditMode(entries: FavoriteGameEntry[]) {
      render(<FavoriteGames entries={entries} isViewer={true} username="ripley" />);
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    }

    it("draws every remaining slot, so the cap is visible before it is hit", async () => {
      await enterEditMode(entriesOf(hades, celeste));

      // Six slots in total: two filled, four offering to be filled.
      expect(screen.getAllByRole("button", { name: /^Pin a game to slot/ })).toHaveLength(4);
      expect(screen.getByText("06")).toBeInTheDocument();
    });

    it("says so when all six are taken", async () => {
      const six = entriesOf(
        hades,
        celeste,
        tunic,
        game("g4", "Braid"),
        game("g5", "Inside"),
        game("g6", "Journey"),
      );
      await enterEditMode(six);

      expect(screen.getByText(/All 6 slots are full/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Pin a game to slot/ })).not.toBeInTheDocument();
    });

    it("unpins a game and takes the API's resulting list", async () => {
      await enterEditMode(entriesOf(hades, celeste));
      authedRequest.mockResolvedValue(entriesOf(celeste));

      await userEvent.click(screen.getByRole("button", { name: "Unpin Hades" }));

      expect(authedRequest).toHaveBeenCalledWith("/users/me/favorites/g1", { method: "DELETE" });
      await waitFor(() => expect(screen.queryByText("Hades")).not.toBeInTheDocument());
      expect(screen.getByText("Celeste")).toBeInTheDocument();
    });

    it("reorders by sending the whole permutation", async () => {
      await enterEditMode(entriesOf(hades, celeste));
      authedRequest.mockResolvedValue(entriesOf(celeste, hades));

      await userEvent.click(screen.getByRole("button", { name: "Move Celeste earlier" }));

      // The object, not a JSON string: `authedRequest` serialises it itself, and
      // pre-stringifying sends the API a string where it wants a mapping.
      expect(authedRequest).toHaveBeenCalledWith("/users/me/favorites", {
        method: "PUT",
        body: { game_ids: ["g2", "g1"] },
      });
    });

    it("cannot move the ends off the list", async () => {
      await enterEditMode(entriesOf(hades, celeste));

      expect(screen.getByRole("button", { name: "Move Hades earlier" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Celeste later" })).toBeDisabled();
    });

    it("puts the list back when a reorder is rejected", async () => {
      await enterEditMode(entriesOf(hades, celeste));
      authedRequest.mockRejectedValue(new Error("Not a permutation of the current list"));

      await userEvent.click(screen.getByRole("button", { name: "Move Celeste earlier" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Not a permutation");
      // Hades is back in slot 01 rather than left where the optimistic move put it.
      const slots = screen.getAllByRole("listitem");
      expect(within(slots[0]).getByText("Hades")).toBeInTheDocument();
    });
  });

  describe("the picker", () => {
    /**
     * Type into the picker and wait for the row.
     *
     * Scoped to the dialog rather than the document: the grid behind it also
     * has buttons carrying these titles ("Unpin Hades", "Move Hades earlier"),
     * so an unscoped `byRole("button", {name: /Hades/})` is ambiguous by design.
     */
    async function findResult(term: string, name: RegExp) {
      const dialog = await screen.findByRole("dialog");

      // `fireEvent.change` rather than `userEvent.type`: the panel animates in,
      // and userEvent re-checks that the field is interactable per keystroke —
      // against the entrance that race is lost silently, the keystrokes land
      // nowhere and the field stays empty. What this test is about is what the
      // picker does with a term, not the mechanics of typing one.
      fireEvent.change(within(dialog).getByLabelText("Search games to pin"), {
        target: { value: term },
      });

      // Past the default second: the picker debounces 250ms before it asks.
      return within(dialog).findByRole("button", { name }, { timeout: 3000 });
    }

    it("searches the catalog and pins what was chosen", async () => {
      render(<FavoriteGames entries={[]} isViewer={true} username="ripley" />);
      await userEvent.click(screen.getByRole("button", { name: "Pin a game" }));

      authedRequest.mockResolvedValue({ items: [tunic], next_cursor: null });
      const result = await findResult("tunic", /Tunic/);

      authedRequest.mockResolvedValue(entriesOf(tunic));
      await userEvent.click(result);

      expect(authedRequest).toHaveBeenCalledWith("/users/me/favorites", {
        method: "POST",
        body: { game_id: "g3" },
      });
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("will not let an already-pinned game be pinned twice", async () => {
      render(<FavoriteGames entries={entriesOf(hades)} isViewer={true} username="ripley" />);
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
      await userEvent.click(screen.getAllByRole("button", { name: /^Pin a game to slot/ })[0]);

      authedRequest.mockResolvedValue({ items: [hades], next_cursor: null });

      // Still listed — hiding it would send the reader hunting for a game they
      // already own — but pressing it is the 409 this avoids.
      const result = await findResult("hades", /Hades/);
      expect(result).toBeDisabled();
      expect(within(result).getByText("Pinned")).toBeInTheDocument();
    });

    it("keeps the games already pinned when a pin is rejected", async () => {
      // A rejected pin must not disturb the pins that succeeded. Note this does
      // *not* reproduce the stale-snapshot restore seen once in the browser —
      // it passes against that version too — so it documents the contract
      // rather than guarding that particular failure.
      render(<FavoriteGames entries={[]} isViewer={true} username="ripley" />);
      await userEvent.click(screen.getByRole("button", { name: "Pin a game" }));

      authedRequest.mockResolvedValue({ items: [tunic, hades], next_cursor: null });
      authedRequest.mockResolvedValueOnce({ items: [tunic, hades], next_cursor: null });
      const first = await findResult("a", /Tunic/);
      authedRequest.mockResolvedValue(entriesOf(tunic));
      await userEvent.click(first);
      expect(await screen.findByText("Tunic")).toBeInTheDocument();

      // Now a second pin that the server refuses.
      await userEvent.click(screen.getByRole("button", { name: "Edit" }));
      await userEvent.click(screen.getAllByRole("button", { name: /^Pin a game to slot/ })[0]);
      authedRequest.mockResolvedValue({ items: [hades], next_cursor: null });
      const second = await findResult("h", /Hades/);
      authedRequest.mockRejectedValue(new Error("That game is already one of your favorites."));
      await userEvent.click(second);

      expect(await screen.findByRole("alert")).toHaveTextContent("already one of your favorites");
      // Tunic is still pinned. It never stopped being pinned.
      expect(screen.getByText("Tunic")).toBeInTheDocument();
    });

    it("closes on Escape and hands focus back", async () => {
      render(<FavoriteGames entries={[]} isViewer={true} username="ripley" />);
      const opener = screen.getByRole("button", { name: "Pin a game" });
      await userEvent.click(opener);

      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      await userEvent.keyboard("{Escape}");

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(opener).toHaveFocus();
    });
  });
});
