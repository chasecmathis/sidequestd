import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthProvider, useAuth } from "./auth";

const USER = {
  id: "0f1f2c9a-7f1f-4f1f-8f1f-9f1f0f1f2f3f",
  username: "ripley",
  display_name: "Ellen Ripley",
  bio: null,
  avatar_url: null,
  is_private: false,
  created_at: "2026-01-01T00:00:00Z",
  email: "ripley@example.com",
  email_verified_at: null,
};

function session(accessToken: string) {
  return {
    access_token: accessToken,
    refresh_token: "refresh-token",
    token_type: "bearer",
    expires_in: 900,
    user: USER,
  };
}

/** One route handler per path, so tests describe responses rather than call order. */
function stubApi(handlers: Record<string, () => { status: number; body: unknown }>) {
  const paths: string[] = [];
  /** What was sent, parsed, in the order it was sent. Empty bodies included. */
  const sent: { path: string; body: unknown }[] = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname.replace("/api/v1", "");
    paths.push(path);
    sent.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const handler = handlers[path];
    if (!handler) throw new Error(`Unexpected request to ${path}`);
    const { status, body } = handler();
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return { paths, sent };
}

/** The last body sent to a path — the assertion the native store tests make. */
function bodyFor(sent: { path: string; body: unknown }[], path: string): unknown {
  const match = sent.filter((request) => request.path === path).at(-1);
  if (!match) throw new Error(`No request was made to ${path}`);
  return match.body;
}

function Probe() {
  const { user, isLoading, login, logout, authedRequest } = useAuth();
  return (
    <div>
      <span data-testid="state">
        {isLoading ? "loading" : user ? `signed-in:${user.username}` : "signed-out"}
      </span>
      <button onClick={() => void login("ripley", "correct-horse-battery-staple")}>sign in</button>
      <button onClick={() => void logout()}>sign out</button>
      <button onClick={() => void authedRequest("/users/me").catch(() => {})}>fetch me</button>
    </div>
  );
}

/**
 * A `SessionStore` that keeps the token in a variable — the shape of the native
 * one, without the Keychain. `token` is read after the fact to assert on what
 * was persisted, which is the half of the seam the web can never exercise.
 */
function memoryStore(initial: string | null = null) {
  const state = { token: initial };
  return {
    state,
    store: {
      read: async () => state.token,
      write: async (next: string | null) => {
        state.token = next;
      },
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AuthProvider", () => {
  it("restores a session from the refresh cookie on mount", async () => {
    stubApi({ "/auth/refresh": () => ({ status: 200, body: session("access-1") }) });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in:ripley"));
  });

  it("settles to signed-out when there is no valid cookie", async () => {
    stubApi({ "/auth/refresh": () => ({ status: 401, body: { detail: "expired" } }) });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));
  });

  it("signs in through /auth/login", async () => {
    stubApi({
      "/auth/refresh": () => ({ status: 401, body: { detail: "expired" } }),
      "/auth/login": () => ({ status: 200, body: session("access-1") }),
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "sign in" }));
    });

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in:ripley"));
  });

  it("refreshes once and retries when a request 401s on an expired access token", async () => {
    let meCalls = 0;
    let refreshCalls = 0;
    const { paths } = stubApi({
      "/auth/refresh": () => {
        refreshCalls += 1;
        return { status: 200, body: session(`access-${refreshCalls}`) };
      },
      "/users/me": () => {
        meCalls += 1;
        // First call hits an expired token; the retry succeeds.
        return meCalls === 1
          ? { status: 401, body: { detail: "Not authenticated." } }
          : { status: 200, body: USER };
      },
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in:ripley"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "fetch me" }));
    });

    await waitFor(() => expect(meCalls).toBe(2));
    expect(paths).toEqual(["/auth/refresh", "/users/me", "/auth/refresh", "/users/me"]);
  });

  it("gives up and signs out when the retry refresh also fails", async () => {
    let refreshCalls = 0;
    stubApi({
      "/auth/refresh": () => {
        refreshCalls += 1;
        return refreshCalls === 1
          ? { status: 200, body: session("access-1") }
          : { status: 401, body: { detail: "expired" } };
      },
      "/users/me": () => ({ status: 401, body: { detail: "Not authenticated." } }),
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in:ripley"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "fetch me" }));
    });

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));
  });

  it("sends an empty refresh body when the store has nothing to say", async () => {
    // The web's whole contract in one assertion: `cookieSessionStore.read`
    // resolves null, and the request must go out as `{}` rather than
    // `{ refresh_token: null }`, which the API's schema rejects.
    const { sent } = stubApi({ "/auth/refresh": () => ({ status: 200, body: session("a") }) });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in:ripley"));

    expect(bodyFor(sent, "/auth/refresh")).toEqual({});
  });
});

describe("AuthProvider with a native SessionStore", () => {
  it("restores a session from the stored token", async () => {
    const { store } = memoryStore("token-from-the-keychain");
    const { sent } = stubApi({ "/auth/refresh": () => ({ status: 200, body: session("a") }) });

    render(
      <AuthProvider store={store}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in:ripley"));
    // This is the cold start: nothing but the stored token distinguishes it from
    // a first launch, so it has to be what the request carries.
    expect(bodyFor(sent, "/auth/refresh")).toEqual({ refresh_token: "token-from-the-keychain" });
  });

  it("stores the rotated token, not just the one from login", async () => {
    const { store, state } = memoryStore();
    stubApi({
      "/auth/refresh": () => ({ status: 401, body: { detail: "expired" } }),
      "/auth/login": () => ({ status: 200, body: session("access-1") }),
    });

    render(
      <AuthProvider store={store}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "sign in" }));
    });

    await waitFor(() => expect(state.token).toBe("refresh-token"));
  });

  it("drops the stored token when the refresh is rejected", async () => {
    // A revoked or expired token must not survive the launch that failed on it,
    // or every subsequent launch re-presents it — and the API treats a replayed
    // token as a leak and revokes the whole family.
    const { store, state } = memoryStore("stale-token");
    stubApi({ "/auth/refresh": () => ({ status: 401, body: { detail: "expired" } }) });

    render(
      <AuthProvider store={store}>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));
    expect(state.token).toBeNull();
  });

  it("revokes the stored token on sign out, then clears it", async () => {
    const { store, state } = memoryStore("token-from-the-keychain");
    const { sent } = stubApi({
      "/auth/refresh": () => ({ status: 200, body: session("access-1") }),
      "/auth/logout": () => ({ status: 200, body: { detail: "Signed out." } }),
    });

    render(
      <AuthProvider store={store}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in:ripley"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "sign out" }));
    });

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));
    // The token the mount's refresh rotated in, not the one it started with.
    expect(bodyFor(sent, "/auth/logout")).toEqual({ refresh_token: "refresh-token" });
    expect(state.token).toBeNull();
  });

  it("clears the stored token even when the logout request fails", async () => {
    const { store, state } = memoryStore("token-from-the-keychain");
    stubApi({
      "/auth/refresh": () => ({ status: 200, body: session("access-1") }),
      "/auth/logout": () => ({ status: 500, body: { detail: "boom" } }),
    });

    render(
      <AuthProvider store={store}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-in:ripley"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "sign out" }));
    });

    // The reader asked to leave. A server that cannot be told is not a reason to
    // keep them signed in on the device — and `logout()` resolves rather than
    // rejecting, so the caller's navigation to the signed-out screen still runs.
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("signed-out"));
    expect(state.token).toBeNull();
  });
});
