import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest } from "./api";

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("sends credentials so the httpOnly refresh cookie travels with the request", async () => {
    const fetchMock = mockFetch(200, { detail: "ok" });

    await apiRequest("/auth/refresh", { method: "POST", body: {} });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/refresh"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("attaches the bearer token only when one is supplied", async () => {
    const fetchMock = mockFetch(200, {});

    await apiRequest("/users/me", { accessToken: "token-123" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token-123");

    await apiRequest("/users/me");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBeUndefined();
  });

  it("surfaces the field name from a 409 so the form can mark the input", async () => {
    mockFetch(409, { detail: "That username is already taken.", field: "username" });

    const error = await apiRequest("/auth/register", { method: "POST", body: {} }).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
    expect((error as ApiError).field).toBe("username");
    expect((error as ApiError).message).toBe("That username is already taken.");
  });

  it("unwraps Pydantic's 422 array into one readable message and field", async () => {
    mockFetch(422, {
      detail: [
        {
          loc: ["body", "password"],
          msg: "Value error, Password must be at least 10 characters long.",
          type: "value_error",
        },
      ],
    });

    const error = (await apiRequest("/auth/register", { method: "POST", body: {} }).catch(
      (cause: unknown) => cause,
    )) as ApiError;

    expect(error.field).toBe("password");
    expect(error.message).toBe("Password must be at least 10 characters long.");
  });

  it("reports an unreachable API instead of leaking the raw network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = (await apiRequest("/health").catch((cause: unknown) => cause)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/Is the API running\?/);
  });
});
