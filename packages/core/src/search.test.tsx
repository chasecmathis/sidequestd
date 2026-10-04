import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameSummary } from "@sidequestd/api-types";

import { noSearchMatches, useSearch } from "./search";

const authedRequest = vi.fn();

vi.mock("./auth", () => ({
  useAuth: () => ({ authedRequest }),
}));

function game(title: string): GameSummary {
  return { id: title, title } as GameSummary;
}

function page(items: GameSummary[], next_cursor: string | null = null) {
  return { items, next_cursor };
}

/** Lets a request stay in flight until the test says otherwise. */
function deferred() {
  let resolve: (value: unknown) => void = () => {};
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

beforeEach(() => {
  authedRequest.mockResolvedValue(page([]));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSearch", () => {
  it("sends nothing for a blank term", async () => {
    const { result } = renderHook(() => useSearch("games", "   ", { debounceMs: 0 }));

    await pause(10);

    expect(authedRequest).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
    expect(result.current.searching).toBe(false);
  });

  it("waits for a pause in typing and asks once, for the final term", async () => {
    const { rerender } = renderHook(({ term }) => useSearch("games", term, { debounceMs: 30 }), {
      initialProps: { term: "m" },
    });
    rerender({ term: "ma" });
    rerender({ term: "mar" });

    await waitFor(() => expect(authedRequest).toHaveBeenCalledTimes(1));
    expect(authedRequest).toHaveBeenCalledWith("/search/games?q=mar");
  });

  it("asks the API for the page size it was given", async () => {
    renderHook(() => useSearch("games", "hades", { debounceMs: 0, limit: 6 }));

    await waitFor(() =>
      expect(authedRequest).toHaveBeenCalledWith("/search/games?q=hades&limit=6"),
    );
  });

  it("searches people on the user endpoint", async () => {
    renderHook(() => useSearch("users", "ripley", { debounceMs: 0 }));

    await waitFor(() => expect(authedRequest).toHaveBeenCalledWith("/search/users?q=ripley"));
  });

  it("ignores the answer to a term the caller has moved past", async () => {
    const first = deferred();
    authedRequest.mockReturnValueOnce(first.promise);
    const { result, rerender } = renderHook(
      ({ term }) => useSearch("games", term, { debounceMs: 0 }),
      { initialProps: { term: "ma" } },
    );
    await waitFor(() => expect(authedRequest).toHaveBeenCalledTimes(1));

    authedRequest.mockResolvedValueOnce(page([game("Mario Odyssey")]));
    rerender({ term: "mario" });
    await waitFor(() => expect(result.current.items).toEqual([game("Mario Odyssey")]));

    await act(async () => first.resolve(page([game("Mass Effect")])));

    expect(result.current.items).toEqual([game("Mario Odyssey")]);
  });

  it("appends the next page and retires the cursor on the last one", async () => {
    authedRequest.mockResolvedValueOnce(page([game("Mario Kart")], "page-two"));
    const { result } = renderHook(() => useSearch("games", "m", { debounceMs: 0 }));
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    authedRequest.mockResolvedValueOnce(page([game("Metroid Dread")]));
    await act(() => result.current.loadMore());

    expect(authedRequest).toHaveBeenLastCalledWith("/search/games?q=m&cursor=page-two");
    expect(result.current.items).toEqual([game("Mario Kart"), game("Metroid Dread")]);
    expect(result.current.hasMore).toBe(false);
  });

  it("drops a next page that lands after the term changed", async () => {
    // The debounced request knows nothing of an in-flight loadMore, so without
    // the guard the tail of "m" would land under the results for "mario".
    authedRequest.mockResolvedValueOnce(page([game("Mario Kart")], "page-two"));
    const { result, rerender } = renderHook(
      ({ term }) => useSearch("games", term, { debounceMs: 0 }),
      { initialProps: { term: "m" } },
    );
    await waitFor(() => expect(result.current.hasMore).toBe(true));

    const pageTwo = deferred();
    authedRequest.mockReturnValueOnce(pageTwo.promise);
    let loading: Promise<void> = Promise.resolve();
    act(() => {
      loading = result.current.loadMore();
    });

    authedRequest.mockResolvedValueOnce(page([game("Mario Odyssey")]));
    rerender({ term: "mario" });
    await waitFor(() => expect(result.current.items).toEqual([game("Mario Odyssey")]));

    await act(async () => {
      pageTwo.resolve(page([game("Metroid Dread")]));
      await loading;
    });

    expect(result.current.items).toEqual([game("Mario Odyssey")]);
  });

  it("surfaces a failure and clears results that answered an older term", async () => {
    authedRequest.mockResolvedValueOnce(page([game("Elden Ring")]));
    const { result, rerender } = renderHook(
      ({ term }) => useSearch("games", term, { debounceMs: 0 }),
      { initialProps: { term: "elden" } },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    authedRequest.mockRejectedValueOnce(new Error("Can't reach the server."));
    rerender({ term: "elden r" });

    await waitFor(() => expect(result.current.error).toBe("Can't reach the server."));
    expect(result.current.items).toEqual([]);
  });

  it("behaves like a blank term while disabled", async () => {
    const { result } = renderHook(() =>
      useSearch("games", "hades", { debounceMs: 0, enabled: false }),
    );

    await pause(10);

    expect(authedRequest).not.toHaveBeenCalled();
    expect(result.current.items).toEqual([]);
  });
});

describe("noSearchMatches", () => {
  it("names what was searched for, trimmed", () => {
    expect(noSearchMatches("games", "  zelda ")).toBe("No games match “zelda”.");
  });
});
