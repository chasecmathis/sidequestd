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
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname.replace("/api/v1", "");
    calls.push(path);
    const handler = handlers[path];
    if (!handler) throw new Error(`Unexpected request to ${path}`);
    const { status, body } = handler();
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function Probe() {
  const { user, isLoading, login, authedRequest } = useAuth();
  return (
    <div>
      <span data-testid="state">
        {isLoading ? "loading" : user ? `signed-in:${user.username}` : "signed-out"}
      </span>
      <button onClick={() => void login("ripley", "correct-horse-battery-staple")}>sign in</button>
      <button onClick={() => void authedRequest("/users/me").catch(() => {})}>fetch me</button>
    </div>
  );
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
    const calls = stubApi({
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
    expect(calls).toEqual(["/auth/refresh", "/users/me", "/auth/refresh", "/users/me"]);
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
});
