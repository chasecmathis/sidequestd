/**
 * What Sidequestd is, for someone who arrived without being told.
 *
 * Shared for a weaker reason than `policy.ts` is, and the difference is worth
 * naming: a policy that says two things is *wrong* on one of the clients, where
 * an About page that says two things is merely embarrassing. What actually earns
 * this module is the five-step band — it is a list of what the product does, it
 * gets edited whenever the product changes, and a five-item list that exists
 * twice is one that gets updated once.
 *
 * Which is also why this is five named sections rather than one flat block list.
 * Both clients say the same sentences and neither is told how to arrange them:
 * the web sets the band as a numbered editorial list against a wide measure and
 * puts the two-scores illustration in a two-column card, and the phone stacks
 * both. Only `intro`, `dataSource` and `contact` are prose all the way through.
 */
import { a, mail, p, type Block } from "./prose";
import { CONTACT_EMAIL, IGDB_URL, SITE_NAME } from "./site";

export const ABOUT_TITLE = `What ${SITE_NAME} is`;

export const ABOUT_DESCRIPTION =
  "A place to write down every game you play, and to see what the people you follow are playing.";

/** The opening argument: why a record of what you played is worth keeping. */
export const ABOUT_INTRO: Block[] = [
  p(
    "You put eighty hours into a game, and a year later all that is left is a vague sense that it was good. The screenshots are in a folder you never open. The opinion you actually had — the sharp, specific one, the week you finished it — is gone.",
  ),
  p(
    `${SITE_NAME} is the record. You rate a game, you write down what you thought, you attach the screenshots you took at the time, and it stays. The rating is the cheap part; the sentence you wrote the week you finished something is the part you will be glad about later.`,
  ),
  p(
    "And it is social, because playing is. What you see is the people you chose to follow, in the order they posted, with their own screenshots — not press assets, not key art, not a stranger's take promoted into your day.",
  ),
];

/** The five things the product does, as a numbered band. */
export interface AboutStep {
  /** Two digits, and they are set as type rather than generated — "01", not "1". */
  n: string;
  title: string;
  body: string;
}

export const HOW_IT_WORKS: AboutStep[] = [
  {
    n: "01",
    title: "Log it",
    body: "Rate out of five with half stars, write as much or as little as you want, and attach the screenshots you actually took. One review per game, editable forever — the record is meant to be revised when you change your mind.",
  },
  {
    n: "02",
    title: "Follow it",
    body: "A feed of the people you follow: their reviews first, their backlog moves woven in between, newest at the top. No ranking, no suggested posts from strangers.",
  },
  {
    n: "03",
    title: "Track it",
    body: "Four lists that do not need managing — to be played, playing, completed, dropped. A game sits on exactly one of them, so moving it is the whole interaction.",
  },
  {
    n: "04",
    title: "Find it",
    body: "Trending is computed from real activity over a rolling seven-day window, not from what a publisher paid for. Browse by genre and platform, or take the recommendations built from the games you called favourites.",
  },
  {
    n: "05",
    title: "Keep it to yourself",
    body: "Accounts can be private. Then your reviews, stats and lists are visible only to followers you approved, and that is enforced on the server for every request — not hidden in the interface.",
  },
];

/**
 * The two-scores explainer.
 *
 * `EXAMPLE_STARS` is on the stored 1–10 scale that `StarRating` and
 * `formatStars` both take, not the 0–5 a reader sees — 5 renders as 2.5. Picked
 * to disagree loudly with the IGDB figure beside it, because a pair that agreed
 * would illustrate nothing.
 *
 * Both clients draw this from their own real `StarRating` and `igdbMeterFill`
 * rather than from a mock-up that approximates them. An explainer that renders
 * something subtly unlike the thing it is explaining teaches the wrong picture,
 * and it would drift the first time either was restyled.
 */
export const EXAMPLE_STARS = 5;
export const EXAMPLE_IGDB = 87;

export const TWO_SCORES_LEAD = `Every game page shows two numbers, and they measure different things. The stars are the ${SITE_NAME} average — what members here rated it, out of five. The 0–100 meter is IGDB's, aggregated from a much larger and much broader pool.`;

export const TWO_SCORES_OURS = "Members here, out of five. A smaller and more opinionated group.";
export const TWO_SCORES_THEIRS = "Everyone, out of a hundred. Broader, and slower to move.";

export const TWO_SCORES_CAVEAT = `An example, not a real game. The two disagree often, and that is the point of showing both — a game the wider world rates ${EXAMPLE_IGDB} and the people you follow rate two stars is telling you something neither number would on its own.`;

/** Where the catalog comes from, and the affiliation disclaimer that has to go with it. */
export const ABOUT_DATA_SOURCE: Block[] = [
  p(
    "Titles, cover art, release dates, genres, platforms and the 0–100 rating all come from ",
    a("IGDB", IGDB_URL),
    ", the games database. The catalog is synced on a schedule and cached here so that browsing does not depend on a live third-party call, and trending is recomputed from activity on this site rather than fetched.",
  ),
  p(
    "Cover images are served directly from IGDB's own image CDN. Ratings are shown as IGDB reports them and are not adjusted.",
  ),
  p(`${SITE_NAME} is not affiliated with, endorsed by, or sponsored by IGDB or Twitch.`),
];

export const ABOUT_CONTACT: Block[] = [
  p(
    `${SITE_NAME} is an independent project, not a company. Bugs, requests, and anything about your account or your data go to `,
    mail(CONTACT_EMAIL),
    ".",
  ),
];

/**
 * The affiliation line is the last paragraph of `ABOUT_DATA_SOURCE` and is set
 * one step dimmer than the two above it on both clients — it is a disclaimer
 * rather than an explanation. Named here so neither client has to reach for
 * `.at(-1)` and hope the order holds.
 */
export const ABOUT_DISCLAIMER_INDEX = ABOUT_DATA_SOURCE.length - 1;
