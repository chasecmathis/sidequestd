/**
 * Thin fetch wrapper around the Sidequestd API.
 *
 * `credentials: "include"` on every call is what carries the httpOnly refresh
 * cookie; the access token is passed explicitly by the caller because it lives
 * in React state, never in storage a script could read.
 */
import type { ConflictErrorBody, ValidationError } from "@sidequestd/api-types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const API_PREFIX = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  /** Present on 409s: the form input that caused the conflict. */
  readonly field?: string;

  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.field = field;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  accessToken?: string | null;
  signal?: AbortSignal;
}

/** Turn FastAPI's several error shapes into one readable sentence. */
function readErrorMessage(status: number, payload: unknown): { message: string; field?: string } {
  if (typeof payload !== "object" || payload === null) {
    return { message: `Request failed (${status}).` };
  }

  const body = payload as Partial<ConflictErrorBody> & Partial<ValidationError>;

  // 422 from Pydantic: an array of per-field errors.
  if (Array.isArray(body.detail)) {
    const first = body.detail[0];
    if (first) {
      const field = first.loc?.filter((part) => part !== "body").join(".");
      return { message: first.msg.replace(/^Value error, /, ""), field };
    }
  }

  if (typeof body.detail === "string") {
    return { message: body.detail, field: body.field };
  }

  return { message: `Request failed (${status}).` };
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, accessToken, signal } = options;

  // FormData is passed through untouched: the browser has to set the
  // Content-Type itself so it can append the multipart boundary.
  const isMultipart = typeof FormData !== "undefined" && body instanceof FormData;

  const headers: Record<string, string> = {};
  if (body !== undefined && !isMultipart) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isMultipart ? body : JSON.stringify(body),
      credentials: "include",
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError("Can't reach the server. Is the API running?", 0);
  }

  if (response.status === 204) return undefined as T;

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const { message, field } = readErrorMessage(response.status, payload);
    throw new ApiError(message, response.status, field);
  }

  return payload as T;
}
