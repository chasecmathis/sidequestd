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
