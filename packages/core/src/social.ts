/**
 * Presentation rules for the follow graph (SPEC §6.7).
 *
 * Same reason as `profile.ts` and `reviews.ts`: what a Follow button says, and
 * what pressing it does, is the interesting part, and it is worth testing
 * without rendering a tree to reach it.
 */
import type { FollowState, UserPublic } from "@sidequestd/api-types";

export const FOLLOW_REQUESTS_PATH = "/follow/requests";

/** One screenful of requests. There is no paging control on that screen yet. */
export const REQUESTS_PAGE_SIZE = 20;

/** The two sides of the follow graph, as the URL and the API both spell them. */
export type FollowDirection = "followers" | "following";

/** Where the profile's counts link to. */
export function followListPath(username: string, direction: FollowDirection): string {
  return `/profile/${encodeURIComponent(username)}/${direction}`;
}

/**
 * The API request for one page of either side.
 *
 * Keyed by user *id* rather than handle: the list endpoints take an id, while
 * the profile that sent the reader here is addressed by handle (SPEC §6.2), so
 * the id has to come from the profile payload.
 */
export function followListQuery(
  userId: string,
  direction: FollowDirection,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return `/users/${userId}/${direction}${query ? `?${query}` : ""}`;
}

/** The heading, and the tab. Kept here so the route and the switch cannot drift. */
export function followListLabel(direction: FollowDirection): string {
  return direction === "followers" ? "Followers" : "Following";
}

/**
 * What an empty list should say, which depends on whose it is and which side.
 *
 * Four sentences rather than one generic "No users": "You aren't following
 * anyone yet" is an invitation, and "Nobody follows ripley yet" is a fact about
 * someone else — collapsing them into one loses both.
 */
export function emptyFollowMessage(
  direction: FollowDirection,
  isViewer: boolean,
  username: string,
): string {
  if (direction === "followers") {
    return isViewer
      ? "Nobody follows you yet. Reviews are how people find you."
      : `Nobody follows @${username} yet.`;
  }
  return isViewer
    ? "You aren't following anyone yet. Find people from a review or from search."
    : `@${username} isn't following anyone yet.`;
}

/** What the button reads in each state (SPEC §6.2 names all three). */
export function followLabel(state: FollowState): string {
  switch (state) {
    case "FOLLOWING":
      return "Following";
    case "REQUESTED":
      return "Requested";
    default:
      return "Follow";
  }
}

/**
 * What pressing it would do, for a screen reader.
 *
 * The visible label is the *current* state, which is how Instagram-style follow
 * buttons read and what people expect — but a control whose name does not
 * describe its action is a trap for anyone who cannot see that it is filled in.
 */
export function followActionLabel(state: FollowState, username: string): string {
  switch (state) {
    case "FOLLOWING":
      return `Unfollow ${username}`;
    case "REQUESTED":
      return `Cancel your follow request to ${username}`;
    default:
      return `Follow ${username}`;
  }
}

/**
 * Whether pressing it removes the edge rather than creating one.
 *
 * Both "Following" and "Requested" are undone by the same call — one row, one
 * DELETE — which is why this is a boolean and not three cases.
 */
export function followUndoes(state: FollowState): boolean {
  return state !== "NONE";
}

/** The request this state's press should send. */
export function followRequest(
  state: FollowState,
  userId: string,
): { path: string; method: string } {
  return { path: `/follow/${userId}`, method: followUndoes(state) ? "DELETE" : "POST" };
}

/**
 * Where the button lands optimistically, before the server answers.
 *
 * `isPrivate` decides between the two forward states: SPEC §6.7 turns a follow
 * into a request when the target is private. The server decides for real — this
 * only avoids a frame of the button still reading "Follow" after a press.
 */
export function optimisticState(state: FollowState, isPrivate: boolean): FollowState {
  if (followUndoes(state)) return "NONE";
  return isPrivate ? "REQUESTED" : "FOLLOWING";
}

/**
 * How the follower count moves with it.
 *
 * A request is not a follower, so asking one moves nothing — and neither does
 * withdrawing it. Only crossing into or out of FOLLOWING counts.
 */
export function followerDelta(from: FollowState, to: FollowState): number {
  if (from === to) return 0;
  if (to === "FOLLOWING") return 1;
  if (from === "FOLLOWING") return -1;
  return 0;
}

/** "@ripley" — how a requester is named on the approval screen. */
export function handle(user: Pick<UserPublic, "username">): string {
  return `@${user.username}`;
}
