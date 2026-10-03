/**
 * Thin fetch wrapper around the Sidequestd API.
 *
 * The access token is passed explicitly by the caller, on both platforms,
 * because it lives in React state and never in storage a script could read.
 *
 * What differs between the clients is how the *refresh* token travels, and it
 * is the only thing this module is configurable about. The web is issued an
 * httpOnly cookie at login, so it sends `credentials: "include"` and never sees
 * the token at all. A native app has no cookie jar worth relying on, so it
 * reads the refresh token out of the response body, keeps it in the Keychain,
 * and sends `credentials: "omit"` — a fetch that quietly attached cookies there
 * would be carrying nothing and hiding the fact.
 *
 * Hence `configureApi`. Neither client should be reaching for a global, but the
 * alternative — threading a config object through all forty call sites in both
 * apps — buys nothing: there is exactly one API per running process.
 */
import type { ConflictErrorBody, ValidationError } from "@sidequestd/api-types";

export const API_PREFIX = "/api/v1";

export interface ApiConfig {
  /** Origin only, no path: "https://api.sidequestd.app". */
  baseUrl: string;
  /**
   * Whether fetch attaches the refresh cookie.
   *
   * `"include"` on web, `"omit"` on native. There is no third sensible value —
   * `"same-origin"` would mean the API and the client share an origin, which
   * neither deployment does.
   */
  credentials: RequestCredentials;
}

/**
 * Defaults that suit local development, so a test or a script that forgets to
 * configure hits the dev API rather than throwing somewhere confusing.
 */
let config: ApiConfig = {
  baseUrl: "http://localhost:8000",
  credentials: "include",
};

/** Call once, at the top of each client's entry point. */
export function configureApi(next: Partial<ApiConfig>): void {
  config = { ...config, ...next };
}

/** Where requests are going. Exported for the "API: …" line on debug screens. */
export function apiUrl(): string {
  return config.baseUrl;
}

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

/**
 * Was `cause instanceof DOMException`, which is a browser assumption and threw
 * on the client that has no DOM: Hermes has no `DOMException` binding at all, so
 * naming it raised `Property 'DOMException' doesn't exist` — *inside the catch
 * block for a failed request*. Every network error on the phone surfaced as that
 * instead of as "Can't reach the server", which is the one message that would
 * have explained it.
 *
 * The name is what carries the meaning anyway, on both platforms: the browser
 * aborts with a `DOMException` named "AbortError", React Native with an `Error`
 * named the same. Duck-typing it rather than reaching for either constructor is
 * what makes this module honestly platform-agnostic instead of nearly so.
 */
function isAbort(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && (cause as Error).name === "AbortError";
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
    response = await fetch(`${config.baseUrl}${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isMultipart ? body : JSON.stringify(body),
      credentials: config.credentials,
      signal,
    });
  } catch (cause) {
    // An abort is the caller's own doing — a screen that navigated away, a
    // search that retyped — so it is rethrown as-is rather than dressed up as a
    // connection failure the reader would see a message about.
    if (isAbort(cause)) throw cause;
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
