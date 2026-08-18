/**
 * Friendly aliases over the generated OpenAPI schema.
 *
 * Hand-written on purpose: if a schema is renamed or removed in the API, these
 * lines stop compiling, which is exactly the signal we want. `schema.d.ts` is
 * generated — see the README.
 */
import type { components, paths } from "./schema.js";

export type { components, paths };

type Schemas = components["schemas"];

/** The authenticated user's own record, including their private email. */
export type UserMe = Schemas["UserMe"];

/** The profile shell anyone may see, private accounts included (SPEC §6.7). */
export type UserPublic = Schemas["UserPublic"];

/** Token pair plus user, returned by register / login / refresh. */
export type AuthSession = Schemas["AuthSession"];

export type RegisterRequest = Schemas["RegisterRequest"];
export type LoginRequest = Schemas["LoginRequest"];
export type RefreshRequest = Schemas["RefreshRequest"];
export type LogoutRequest = Schemas["LogoutRequest"];
export type PasswordResetRequest = Schemas["PasswordResetRequest"];
export type PasswordResetConfirm = Schemas["PasswordResetConfirm"];
export type MessageResponse = Schemas["MessageResponse"];
export type UsernameAvailability = Schemas["UsernameAvailability"];

// --- Games catalog, discover and search ------------------------------------

/** A game card: what browse, search and Discover sections render. */
export type GameSummary = Schemas["GameSummary"];
/** Everything the Game Detail screen needs. */
export type GameDetail = Schemas["GameDetail"];
export type GenreRef = Schemas["GenreRef"];
export type PlatformRef = Schemas["PlatformRef"];
/**
 * Where a game can be bought or launched. Detail-only — no card renders one.
 *
 * `url` is nullable: the API knows store ids it has no address template for, and
 * hands them over rather than dropping them. Filter those out before rendering
 * (`linkableStores` in `lib/catalog`).
 */
export type StoreLink = Schemas["StoreLink"];
export type GameSort = Schemas["GameSort"];
export type TrendingWindow = Schemas["TrendingWindow"];
export type TrendingGame = Schemas["TrendingGame"];
export type DiscoverResponse = Schemas["DiscoverResponse"];

/**
 * A user search card. `review_count` is null when the account is private and the
 * viewer is not an approved follower (SPEC §6.7).
 */
export type UserSearchResult = Schemas["UserSearchResult"];

/**
 * One page of a cursor-paginated list.
 *
 * FastAPI emits a concrete schema per instantiation (`CursorPage_GameSummary_`),
 * so this is written generically here and the shapes below pin the ones the
 * clients actually consume.
 */
export interface CursorPage<T> {
  items: T[];
  next_cursor: string | null;
}

export type GamePage = CursorPage<GameSummary>;
export type UserSearchPage = CursorPage<UserSearchResult>;
export type UserPage = CursorPage<UserPublic>;

// --- Profiles (SPEC §6.2, §6.8) --------------------------------------------

/**
 * A profile as one viewer sees it.
 *
 * `can_view_content` is the gate: when it is false the account is private and
 * the viewer has not been approved, so `stats` is null and `favorite_games` is
 * empty. The shell and the follower counts are populated either way.
 */
export type UserProfile = Schemas["UserProfile"];

/** Body for `PATCH /users/me`. An omitted key is untouched; null clears it. */
export type UserUpdate = Schemas["UserUpdate"];

export type ProfileStats = Schemas["ProfileStats"];
export type RatingBucket = Schemas["RatingBucket"];
export type FavoriteGameEntry = Schemas["FavoriteGameEntry"];
export type FavoriteCreate = Schemas["FavoriteCreate"];
export type FavoriteReorder = Schemas["FavoriteReorder"];

// --- Reviews (SPEC §6.3) ---------------------------------------------------

/**
 * A review as a grid tile or feed row shows it.
 *
 * `rating` is the stored 1-10 integer and `stars` the 0.5-5.0 value to render;
 * both come from the API so clients cannot disagree about the halving.
 * `thumbnail_url` is already resolved — the first media thumbnail, or the game's
 * cover art when there is none yet.
 */
export type ReviewSummary = Schemas["ReviewSummary"];

/** The summary plus the ordered media carousel. */
export type ReviewDetail = Schemas["ReviewDetail"];

/**
 * One slot in the carousel. An item arrives PENDING with only `url`; the worker
 * fills in `thumbnail_url` and the dimensions and flips it to READY. Video never
 * gains a thumbnail in this version.
 */
export type ReviewMediaItem = Schemas["ReviewMediaItem"];

export type MediaType = Schemas["MediaType"];
export type ProcessingStatus = Schemas["ProcessingStatus"];

export type ReviewCreate = Schemas["ReviewCreate"];
/** Body for `PATCH /reviews/{id}`. An omitted key is untouched; null clears it. */
export type ReviewUpdate = Schemas["ReviewUpdate"];

export type ReviewPage = CursorPage<ReviewSummary>;

// --- Interactions (SPEC §6.10) ---------------------------------------------

/**
 * A review's footer after a like or an unlike.
 *
 * The same three counters every review response already carries, on their own
 * so the like button can move its number without re-reading the review.
 */
export type ReviewInteractions = Schemas["ReviewInteractions"];

/**
 * One comment. `edited` is derived from the timestamps by the API, so clients
 * do not each pick a tolerance for what counts as changed.
 */
export type CommentItem = Schemas["CommentItem"];

/**
 * A top-level comment with its replies. Threading stops at one level (SPEC
 * §6.10), so `replies` is the whole subtree rather than its first page.
 */
export type CommentThread = Schemas["CommentThread"];

export type CommentCreate = Schemas["CommentCreate"];
/** Body for `PATCH /comments/{id}`. Text is all a comment has to change. */
export type CommentUpdate = Schemas["CommentUpdate"];

/** Pages of *threads*, not of comments — replies never spill onto page two. */
export type CommentPage = CursorPage<CommentThread>;

// --- Home feed (SPEC §6.4) -------------------------------------------------

/**
 * A review in the feed, in its envelope.
 *
 * `review` is the same `ReviewSummary` the profile grid renders, counters and
 * all, so a feed row is interactive on arrival.
 */
export type FeedReviewItem = Schemas["FeedReviewItem"];

/**
 * A backlog status change by someone you follow (SPEC §6.11).
 *
 * The lightweight half of the unified Home: "Alex added *Elden Ring* to
 * Playing". Only the current `status` is here — the event is derived from the
 * backlog row, which remembers where a game is and not the route it took.
 */
export type FeedActivityItem = Schemas["FeedActivityItem"];

/**
 * Why a recommended item is in the feed (SPEC §6.4, §6.5).
 *
 * `recommended_game` — the reader is likely to enjoy the game it is about.
 * `suggested_account` — the author rates the way the reader does.
 */
export type RecommendationReason = Schemas["RecommendationReason"];

/**
 * A review blended in from outside the follow graph (SPEC §6.4).
 *
 * Its own member rather than a flag on `FeedReviewItem`, because SPEC §6.4
 * requires the blend to be "clearly distinguishable from pure follow feed" and a
 * flag is what a client forgets to read. **Label it in the UI**: the reader did
 * not choose this author, and a recommended card rendered as though they had is
 * the one way this feature misleads.
 *
 * The `review` is the identical `ReviewSummary`, so the row is as interactive as
 * any other. Only how it got here is different.
 */
export type FeedRecommendedItem = Schemas["FeedRecommendedItem"];

/**
 * One item in the Home feed — a **discriminated union**.
 *
 * Always branch on `item.type`. The members share only the envelope (`type`,
 * `id`, `occurred_at`), so `item.review` exists on some of them and reaching for
 * it without narrowing is a crash on the first activity event. More kinds arrive
 * as more members, and only code that already narrowed keeps compiling.
 */
export type FeedItem = FeedReviewItem | FeedActivityItem | FeedRecommendedItem;

export type FeedPage = CursorPage<FeedItem>;

/** The empty state: who to follow, and what is hot while you decide. */
export type FeedSuggestions = Schemas["FeedSuggestions"];

// --- Backlog lists (SPEC §6.9) ---------------------------------------------

/** Which of the four lists a game is on. */
export type BacklogStatus = Schemas["BacklogStatus"];

/** One game on one list, with its position in the owner's order. */
export type BacklogEntry = Schemas["BacklogEntry"];

/** One status and everything on it. */
export type BacklogList = Schemas["BacklogList"];

/**
 * A whole backlog. `lists` holds all four statuses, empty ones included, unless
 * the request narrowed it with `?status=` — so a client can draw four headings
 * without checking whether each came back.
 */
export type BacklogLists = Schemas["BacklogLists"];

/** Body for `PUT /backlog/{gameId}` — an upsert; the move and the add are one. */
export type BacklogStatusUpdate = Schemas["BacklogStatusUpdate"];

/** Body for `PUT /backlog/order`. Must name every game currently on that list. */
export type BacklogReorder = Schemas["BacklogReorder"];

// --- Notifications (SPEC §6.12) --------------------------------------------

/** Which of the seven things happened. The client turns it into a sentence. */
export type NotificationType = Schemas["NotificationType"];

/**
 * One row of the Notifications tab.
 *
 * Deliberately *not* a discriminated union like `FeedItem`: every row renders
 * the same way — avatar, sentence, timestamp — and only the sentence differs, so
 * the targets are nullable fields and `type` says which of them to expect. A
 * like and a backlog-game-reviewed carry `review`; a comment or reply carries
 * both; a follow carries neither.
 */
export type NotificationItem = Schemas["NotificationItem"];

/** The review a notification is about, named by its game. */
export type NotificationReviewTarget = Schemas["NotificationReviewTarget"];

/** The comment a notification is about, with the review it lives on. */
export type NotificationCommentTarget = Schemas["NotificationCommentTarget"];

export type NotificationPage = CursorPage<NotificationItem>;

/** What the badge shows. Polled — delivery is in-app only in this version. */
export type UnreadCount = Schemas["UnreadCount"];

/**
 * Body for `POST /notifications/read`.
 *
 * Omit `ids` to mark everything read. An explicitly empty array marks *nothing*,
 * so a selection that computed to empty cannot clear the whole badge by accident.
 */
export type NotificationReadRequest = Schemas["NotificationReadRequest"];

/** `marked` is how many changed; `unread_count` is what the badge says now. */
export type NotificationReadResult = Schemas["NotificationReadResult"];

// --- Social graph (SPEC §6.7) ----------------------------------------------

/**
 * What a Follow button should say.
 *
 * Derived from the edge rather than stored: `NONE` means there isn't one.
 * `REQUESTED` only happens against a private account, which has to approve.
 */
export type FollowState = Schemas["FollowState"];

/**
 * The edge after a follow action, including the ones that removed it — `state`
 * is what to render next, and `follower_count` is the number beside the button,
 * already updated.
 */
export type FollowResult = Schemas["FollowResult"];

/** A pending request the signed-in user has received, for the approval screen. */
export type FollowRequest = Schemas["FollowRequest"];

export type FollowRequestPage = CursorPage<FollowRequest>;

// --- Linked platform accounts (SPEC §6.13) ---------------------------------

/** Which gaming platform a link is to. Steam is the only one so far. */
export type ConnectionProvider = Schemas["ConnectionProvider"];

/**
 * How the last library sync went. `PROFILE_PRIVATE` is deliberately not folded
 * into `FAILED`: it is the one outcome the member can fix themselves, by making
 * their Steam game details public, so the UI owes them a different message.
 */
export type PlatformSyncStatus = Schemas["PlatformSyncStatus"];

/** A linked account as its owner sees it on the settings screen. */
export type LinkedAccount = Schemas["LinkedAccount"];

/**
 * Every link the caller holds, plus whether the deployment can link at all —
 * `steam_available` is false when the API has no Steam key, and the client
 * should hide the button rather than offer one that always fails.
 */
export type ConnectionStatus = Schemas["ConnectionStatus"];

/** Where to send the browser to begin linking. */
export type ConnectionStart = Schemas["ConnectionStart"];

export type VisibilityUpdate = Schemas["VisibilityUpdate"];

/** A linked platform as it appears on somebody else's profile. */
export type PlatformShowcase = Schemas["PlatformShowcase"];

/** One game on that showcase. */
export type ShowcaseGame = Schemas["ShowcaseGame"];

/**
 * Playtime the platform published for a review's game.
 *
 * Distinct from `Review.playtime_minutes`, which is what the author typed: this
 * is evidence and that is a claim. Present only when the author's library
 * matched the game by store id and their link is visible.
 */
export type VerifiedPlaytime = Schemas["VerifiedPlaytime"];

/** The composer's prefill: the caller's own platform playtime for one game. */
export type PlaytimeSuggestion = Schemas["PlaytimeSuggestion"];

/** FastAPI's 422 body for request-validation failures. */
export type ValidationError = Schemas["HTTPValidationError"];

/**
 * Error body for a uniqueness conflict. `field` names the input to attach the
 * message to — see the ConflictError handler in the API.
 */
export interface ConflictErrorBody {
  detail: string;
  field: "username" | "email";
}

/** Every other error the API returns. */
export interface ErrorBody {
  detail: string;
}
