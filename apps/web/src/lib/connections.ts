/**
 * Linked platform accounts, on the client side.
 *
 * Pure functions only, like the rest of `lib/` — the components below decide how
 * a sync state looks, this decides what it *is*.
 *
 * The interesting piece is `syncNotice`. Steam has one failure that is not
 * really a failure: a member whose "Game details" privacy is not public gets an
 * empty library and a 200. The API separates that case out as
 * `PROFILE_PRIVATE`, and the only reason it goes to that trouble is so this
 * function can hand back instructions instead of an apology. It is the single
 * most valuable string in the feature — the one message that turns a dead end
 * into a thing somebody can go and fix.
 */
import { formatPlaytime } from "@/lib/reviews";
import type { ConnectionProvider, LinkedAccount, PlatformSyncStatus } from "@sidequestd/api-types";

export const CONNECTIONS_PATH = "/settings/connections";

/** Where the callback sends the browser back to, as a query code. */
export type CallbackResult =
  "connected" | "state" | "verification" | "profile" | "taken" | "unavailable";

export const PROVIDER_LABELS: Record<ConnectionProvider, string> = {
  STEAM: "Steam",
};

export function providerLabel(provider: ConnectionProvider): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Hours, in the app's one playtime format.
 *
 * Deliberately `formatPlaytime` from `lib/reviews` rather than a second
 * implementation: a library that said "2,832 minutes" beside a review that said
 * "47.2h" would read as two different measurements of two different things.
 */
export function formatLibraryPlaytime(minutes: number): string {
  return formatPlaytime(minutes) ?? "0h";
}

/**
 * Total hours across a library, rounded to something a person would say.
 *
 * A showcase total runs to thousands, where `formatPlaytime`'s one decimal is
 * noise — "1,284h" is the fact, "1,284.3h" is a false precision on a number
 * that moves every time somebody plays anything.
 */
export function formatTotalPlaytime(minutes: number): string {
  const hours = Math.round(minutes / 60);
  return `${hours.toLocaleString()}h`;
}

export function formatGameCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "game" : "games"}`;
}

// The generated schema spells an optional nullable field as `T | null |
// undefined`, so the readers below take both spellings of "absent" rather than
// making every call site normalise one into the other.
/** "2 hours ago" is `timeAgo`'s job; this is the settings screen's flat form. */
export function formatSyncedAt(iso: string | null | undefined): string {
  if (!iso) return "Not synced yet";
  return `Synced ${new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
}

export interface SyncNotice {
  tone: "error" | "success";
  title: string;
  /** What the member can actually do. Empty when there is nothing to do. */
  steps: string[];
}

/**
 * What to tell somebody about their last sync, if anything.
 *
 * Null for the healthy cases — a screen that congratulates you on a sync working
 * every time you open it is noise, and the "Synced <time>" line already says it.
 */
export function syncNotice(status: PlatformSyncStatus | null | undefined): SyncNotice | null {
  switch (status) {
    case "PROFILE_PRIVATE":
      return {
        tone: "error",
        title: "Steam is hiding your game details, so we can't read your library.",
        steps: [
          "Open Steam and go to your profile.",
          "Choose Edit Profile, then Privacy Settings.",
          'Set "Game details" to Public.',
          "Come back here and press Sync now.",
        ],
      };
    case "FAILED":
      return {
        tone: "error",
        title: "The last sync didn't finish. Steam may have been unavailable.",
        steps: [],
      };
    default:
      return null;
  }
}

/** The one-line result of a link attempt, keyed by the callback's query code. */
export function callbackMessage(code: string | null): SyncNotice | null {
  switch (code as CallbackResult | null) {
    case "connected":
      return { tone: "success", title: "Steam connected. Your library is syncing now.", steps: [] };
    case "taken":
      return {
        tone: "error",
        title: "That Steam account is already linked to another Sidequestd profile.",
        steps: ["Unlink it there first, or sign in through Steam as a different account."],
      };
    case "state":
      return {
        tone: "error",
        title: "That link attempt expired before it finished.",
        steps: ["Press Connect Steam and complete the sign-in within a few minutes."],
      };
    case "verification":
      return {
        tone: "error",
        title: "Steam didn't confirm that sign-in.",
        steps: ["If you cancelled on Steam's page, press Connect Steam to try again."],
      };
    case "profile":
      return {
        tone: "error",
        title: "Steam signed you in but wouldn't share that profile.",
        steps: [],
      };
    case "unavailable":
      return { tone: "error", title: "Steam is unreachable right now.", steps: [] };
    default:
      return null;
  }
}

/** Whether the manual re-sync button should be pressable. */
export function canSyncNow(account: LinkedAccount): boolean {
  return account.sync_cooldown_minutes === 0;
}

export function cooldownLabel(account: LinkedAccount): string {
  const minutes = account.sync_cooldown_minutes;
  if (minutes === 0) return "Sync now";
  if (minutes === 1) return "Sync again in a minute";
  return `Sync again in ${minutes} minutes`;
}

/**
 * Platform minutes as the composer's hours field wants them.
 *
 * The inverse of `playtimeToMinutes`, and it has to round the same way or a
 * member who accepts the suggestion and saves without touching it would store a
 * figure that differs from the one they were shown.
 */
export function playtimeSuggestionValue(minutes: number): string {
  return String(Math.round((minutes / 60) * 10) / 10);
}

/**
 * How much of a library the catalog actually recognises.
 *
 * Shown because the gap is large and confusing otherwise: a real Steam library
 * is full of tools, soundtracks, demos and betas that are not games anybody
 * reviews, and a member who sees "412 games" beside six cards deserves to know
 * why rather than assuming the sync half-failed.
 */
export function matchedLabel(account: LinkedAccount): string | null {
  if (account.total_games === 0) return null;
  return `${account.matched_games.toLocaleString()} of ${account.total_games.toLocaleString()} matched to the catalog`;
}
