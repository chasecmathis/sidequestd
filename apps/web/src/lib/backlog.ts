/**
 * How the four lists read (SPEC §6.9, §6.11).
 *
 * The wire carries `TO_BE_PLAYED`; a person reads "To Be Played". Both spellings
 * of every status live here rather than in the components, because the profile,
 * the add-to-list control and the feed's activity line each need one of them and
 * three copies would eventually disagree about what `DROPPED` is called.
 */
import type { BacklogEntry, BacklogLists, BacklogStatus } from "@sidequestd/api-types";

/**
 * SPEC §6.9's order, which is also the order a game moves through them.
 *
 * The API returns its lists in this order already; this is for the places that
 * build a control rather than render a response — the status picker has no
 * payload to take its order from.
 */
export const BACKLOG_ORDER: BacklogStatus[] = ["TO_BE_PLAYED", "PLAYING", "COMPLETED", "DROPPED"];

const LIST_NAMES: Record<BacklogStatus, string> = {
  TO_BE_PLAYED: "To Be Played",
  PLAYING: "Playing",
  COMPLETED: "Completed",
  DROPPED: "Dropped",
};

/**
 * How an activity line says what happened (SPEC §6.11).
 *
 * A verb rather than "moved X to Y": the feed shows where a game landed, not the
 * route it took — the backlog row only remembers the former — and "Sam completed
 * Hades" is both shorter and the sentence SPEC §6.11 actually asks for.
 */
const ACTIVITY_VERBS: Record<BacklogStatus, string> = {
  TO_BE_PLAYED: "wants to play",
  PLAYING: "started playing",
  COMPLETED: "completed",
  DROPPED: "dropped",
};

export function listName(status: BacklogStatus): string {
  return LIST_NAMES[status];
}

export function activityVerb(status: BacklogStatus): string {
  return ACTIVITY_VERBS[status];
}

/** The entries on one list, or an empty array when the payload omitted it. */
export function entriesOn(lists: BacklogLists, status: BacklogStatus): BacklogEntry[] {
  return lists.lists.find((group) => group.status === status)?.items ?? [];
}

/** What an empty list says, which depends on whose profile it is. */
export function emptyListMessage(status: BacklogStatus, isViewer: boolean): string {
  return isViewer ? `Nothing on ${listName(status)} yet.` : `Nothing on ${listName(status)}.`;
}

/**
 * A flat lookup of what status each game is on, for the add-to-list controls.
 *
 * Search results and Game Detail need to know whether the game in front of them
 * is already somewhere, and asking per game would be a request per card.
 */
export function statusByGame(lists: BacklogLists): Map<string, BacklogStatus> {
  const found = new Map<string, BacklogStatus>();
  for (const group of lists.lists) {
    for (const entry of group.items) found.set(entry.game.id, group.status);
  }
  return found;
}
