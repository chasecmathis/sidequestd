/**
 * Everything both clients agree about.
 *
 * The rule for what belongs here is "would the answer differ on a phone?" — if
 * not, it lives in this package and neither app owns a copy. That covers the
 * API transport, every presentation and validation rule, and the four providers
 * that hold session, backlog, notification and theme state.
 *
 * What is deliberately *not* here: anything that renders. A `<ReviewCard>` is a
 * `<div>` on one platform and a `<View>` on the other, and the shared part of it
 * — `excerpt`, `formatStars`, `timeAgo`, `releaseYearLabel` — is already below.
 * Pushing the markup into a cross-platform abstraction as well would cost more
 * than the duplication it saves.
 *
 * The three places a platform has to declare itself are all named: `configureApi`
 * for how the refresh token travels, `SessionStore` for where it is kept, and
 * `ThemeStorage` for where a colour preference is kept.
 */

/* Transport. */
export {
  API_PREFIX,
  ApiError,
  apiRequest,
  apiUrl,
  configureApi,
  type ApiConfig,
} from "./api";

/* Session. */
export {
  AuthProvider,
  cookieSessionStore,
  useAuth,
  type SessionStore,
} from "./auth";

/* Theme. */
export {
  browserThemeStorage,
  DARK_QUERY,
  THEME_STORAGE_KEY,
  ThemeProvider,
  useTheme,
  type ResolvedTheme,
  type ThemeChoice,
  type ThemeStorage,
} from "./theme";

/* The feed, and what its rows are. */
export {
  commentsPath,
  excerpt,
  FEED_PAGE_SIZE,
  FEED_PREFETCH_MARGIN,
  feedItemKey,
  feedQuery,
  isActivityItem,
  isRecommendedItem,
  isReviewItem,
  RECOMMENDATION_LABELS,
  recommendationLabel,
} from "./feed";

/* The games catalog. */
export {
  browseQuery,
  formatGameRating,
  formatIgdbRating,
  IGDB_MAX_RATING,
  igdbMeterFill,
  linkableStores,
  orderFacetOptions,
  ratingCountLabel,
  releaseYearLabel,
  searchQuery,
  STORE_MARK_PATHS,
  storeLinkLabel,
  storeMarkPath,
  toggleFacet,
  visibleFacetOptions,
  type BrowseFilters,
  type LinkableStore,
} from "./catalog";

/* Search: the hook both clients' search fields run on. */
export {
  noSearchMatches,
  SEARCH_DEBOUNCE_MS,
  SEARCH_PROMPTS,
  useSearch,
  type SearchKind,
  type SearchOptions,
  type SearchResult,
  type SearchState,
} from "./search";

/* Reviews: presentation, and the limits a client checks before uploading. */
export {
  ACCEPTED_MEDIA,
  formatPlaytime,
  formatStars,
  isProcessing,
  isVideo,
  MAX_IMAGE_BYTES,
  MAX_MEDIA_PER_REVIEW,
  MAX_RATING,
  MAX_VIDEO_BYTES,
  MIN_RATING,
  minutesToPlaytimeInput,
  playtimeToMinutes,
  rejectMedia,
  REVIEW_TEXT_MAX_LENGTH,
  reviewPath,
  STAR_PATH,
  starFill,
  tally,
  tileImage,
  toStars,
  type MediaCandidate,
} from "./reviews";

/* Profiles and their stats.
 *
 * Listed rather than `export *`, unlike the modules below, for one reason:
 * `profile.ts` has a `formatPlaytime` of its own — the profile stat block wants
 * a plain string where a review wants `null` for "not tracked" — and a star
 * export would collide with the one from `reviews.ts`. It has no callers
 * outside its own module, so it simply does not appear here. */
export {
  avatarInitial,
  distributionHeights,
  formatAverageRating,
  formatCount,
  MAX_FAVORITE_GAMES,
  moveFavorite,
  profilePath,
  slotLabel,
  statTiles,
  type StatTile,
} from "./profile";

/* Following, followers, and requests. */
export * from "./social";

/* Likes, comments, timestamps. */
export * from "./interactions";

/* The backlog: statuses, ordering, and the store that holds one account's. */
export * from "./backlog";
export { BacklogProvider, useBacklog } from "./backlog-store";

/* Notifications: phrasing, targets, and the unread badge. */
export * from "./notifications";
export { NotificationsProvider, useNotifications } from "./notifications-store";

/* Linked platform accounts. */
export * from "./connections";

/* The product's own strings, and the long-form copy built out of them.
 *
 * These are the one group here that is not logic at all — it is words. They live
 * in this package for the reason `prose.ts` opens with: the privacy policy and
 * the terms are documents where two clients disagreeing is a broken promise
 * rather than an inconsistency, and neither client may own a private copy. */
export * from "./site";
export * from "./prose";
export * from "./policy";
export * from "./about";
