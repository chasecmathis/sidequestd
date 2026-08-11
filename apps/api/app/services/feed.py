"""The Home feed (SPEC §6.4, §8).

Home is **unified** (SPEC §6.4, §6.11): reviews from the accounts you follow are
the hero content, and lightweight activity events — "Alex added *Elden Ring* to
Playing" — sit inline between them, so the page still has a pulse on a day when
nobody wrote anything. Both come from the same follow graph and are ordered
together, newest first, under one cursor.

Two sources, one ordering, so the *keys* are paged and the payloads loaded after:
`_feed_keys` unions `(id, occurred_at, kind)` from reviews and from backlog rows,
`fetch_keyset_keys` seeks through that union exactly the way every other list
seeks, and `_hydrate` then fetches each kind in one query. Merging two separately
paged lists in Python would have been the obvious alternative and is wrong — the
cursor would have to remember a position in each, and any item that arrived
between two requests would land on the seam.

The review payload is not built here. It is still
`reviews.select_reviews()` + `reviews.with_stats` — the same projection the
profile grid uses, with the same eager loads and the same counters — so a like
written through `app.services.interactions` moves the number on a feed row
without this module knowing that likes exist. What changed when activity arrived
is which rows are selected and in what order, never what a review looks like.

**The follow edge is the privacy gate.** SPEC §6.7 makes a private account's
reviews, stats and lists visible to approved followers, and an ACCEPTED edge *is*
that approval — so the row that puts an item in the feed is the same row that
entitles the viewer to see it, for backlog activity (SPEC §6.9: lists inherit
account privacy) exactly as for reviews. There is deliberately no second
`require_content_access` call here: it could only ever agree, and a redundant
check is a check that can drift. Removing the follow removes both at once.

The recommended blend from SPEC §6.4 is the one thing in the feed that does *not*
arrive through a follow edge, so it is the one thing that needs the gate spelled
out. It carries `users.content_is_visible_to` in its WHERE — the same expression
the profile and search surfaces are built on, in the form that fits inside a
query — rather than a hand-written `is_private = false`. Which reviews qualify is
`app.services.recommendations`' answer, not this module's; what Home decides is
that they are shown to someone who is already reading a feed, and never instead
of the empty state SPEC §6.4 promises a viewer who follows nobody.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.backlog import BacklogItem
from app.models.enums import FollowStatus
from app.models.game import Game
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User
from app.schemas.feed import FeedItemType, RecommendationReason
from app.services import recommendations
from app.services import reviews as reviews_service
from app.services import users as users_service
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    fetch_keyset_keys,
)
from app.services.reviews import ReviewWithStats

# How many accounts the empty state offers. Enough to be a choice, few enough to
# stay a prompt — SPEC §6.4 wants a way out of an empty Home, not a directory.
SUGGESTED_ACCOUNT_LIMIT = 5
TRENDING_SUGGESTION_LIMIT = 6

# How deep the taste ranking is read before the accounts that cannot be suggested
# — private, already followed, already asked — are filtered out of it.
SUGGESTED_ACCOUNT_POOL = 25

# How far back activity events reach. Reviews are the archive and stay forever;
# an activity event is news, and "Sam moved a game to Playing" stops being news
# long before the review under it does. Scrolling past the window leaves a feed
# of pure reviews, which is what Home was before this slice.
ACTIVITY_WINDOW = timedelta(days=14)

# How many games the blend draws from, and how far back it reaches for reviews of
# them. Both are caps on how much of Home can be something the reader did not ask
# for: reviews are the archive, so an unbounded blend would thread every review
# ever written of a dozen popular games through a feed that is supposed to be
# about the people you follow.
RECOMMENDED_GAME_LIMIT = 12
RECOMMENDATION_WINDOW = timedelta(days=30)


@dataclass(frozen=True, slots=True)
class RecommendedReview:
    """A review the viewer does not follow the author of (SPEC §6.4).

    A wrapper and not a flag on `ReviewWithStats`, for the same reason the wire
    shape is a union member: the two are the same review and a different kind of
    row, and something has to make the router branch rather than remember.
    """

    entry: ReviewWithStats
    reason: RecommendationReason


# A feed row is a review with its counters, a backlog row, or a review from
# outside the follow graph. The router tells them apart by type rather than by a
# flag, so a new kind of item cannot be added without every consumer being asked
# what to do with it.
type FeedEntry = ReviewWithStats | BacklogItem | RecommendedReview


@dataclass(frozen=True, slots=True)
class Blend:
    """What one viewer's recommended items are drawn from, for one request.

    Computed once and handed to both halves of the read: the keys query needs it
    to select the rows, and hydration needs it to say why each one is there.
    Recomputing it between the two would be two chances to disagree.
    """

    games: frozenset[uuid.UUID]
    accounts: frozenset[uuid.UUID]

    def __bool__(self) -> bool:
        return bool(self.games or self.accounts)

    def reason(self, review: Review) -> RecommendationReason:
        """The game leads when a review qualifies both ways — it is the more
        specific claim, and the one the reader can check against the card."""
        if review.game_id in self.games:
            return RecommendationReason.RECOMMENDED_GAME
        return RecommendationReason.SUGGESTED_ACCOUNT


def _followed_authors(viewer_id: uuid.UUID) -> sa.ScalarSelect[uuid.UUID]:
    """The accounts whose activity belongs in this viewer's Home.

    ACCEPTED edges only. A pending request to a private account is not a follow —
    the point of the approval in SPEC §6.7 is that nothing is visible until it is
    given — and a feed is the surface where the difference would be most obvious.

    Deactivated accounts are filtered out here rather than at each source, so an
    account that goes away goes away from both halves of the feed at once.

    The viewer is not in this set: SPEC §6.4 defines Home as the accounts you
    follow, and `no_self_follow` means there is no edge to yourself to find. Your
    own reviews and lists are on your profile.
    """
    return (
        sa.select(User.id)
        .join(Follow, Follow.followee_id == User.id)
        .where(
            Follow.follower_id == viewer_id,
            Follow.status == FollowStatus.ACCEPTED,
            User.is_active.is_(True),
        )
        .scalar_subquery()
    )


def _recommended_keys(viewer_id: uuid.UUID, blend: Blend) -> sa.Select[Any]:
    """Reviews to blend in from outside the follow graph (SPEC §6.4).

    Everything the follow arms get from an ACCEPTED edge has to be stated here
    instead, because there is no edge:

    * `content_is_visible_to` is the privacy gate. Combined with the two
      exclusions below it can only ever resolve to "this account is public", but
      it is written as the shared expression rather than as that conclusion, so a
      change to what SPEC §6.7 means reaches this arm too.
    * Authors the viewer already follows are excluded, or their reviews would
      arrive twice — once as a follow item and once as a recommendation — and the
      second copy would be labelled as coming from a stranger.
    * The viewer's own reviews are excluded. Home is other people (SPEC §6.4),
      and being recommended your own review is worse than being recommended your
      own favorite game.
    """
    return (
        sa.select(
            Review.id.label("id"),
            Review.created_at.label("occurred_at"),
            sa.cast(sa.literal(FeedItemType.RECOMMENDED_REVIEW.value), sa.String).label("kind"),
        )
        .select_from(Review)
        .join(User, User.id == Review.user_id)
        .where(
            sa.or_(
                Review.game_id.in_(blend.games),
                Review.user_id.in_(blend.accounts),
            ),
            Review.user_id.not_in(_followed_authors(viewer_id)),
            Review.user_id != viewer_id,
            Review.created_at >= datetime.now(UTC) - RECOMMENDATION_WINDOW,
            User.is_active.is_(True),
            users_service.content_is_visible_to(viewer_id),
        )
    )


def _feed_keys(
    viewer_id: uuid.UUID, blend: Blend
) -> tuple[sa.Select[tuple[uuid.UUID, datetime]], KeysetSort]:
    """The id, timestamp and kind of everything in this viewer's feed.

    A UNION rather than separate queries because the kinds interleave: one
    ordering over all of them is the only way a cursor can mean a single position
    in the feed. The kinds are cast to text explicitly — Postgres will not infer
    the type of a bare parameter across a UNION arm.

    The recommended arm is part of the same union for that reason and not as a
    convenience. Merging a separately-fetched list of recommendations into an
    already-paged one in Python would put the blend outside the cursor, and an
    item outside the cursor either repeats on the next page or falls down the gap
    between two — which is precisely the failure the union was chosen to avoid
    when activity arrived.

    The sort is built here, against this statement's own columns, rather than
    reused from `reviews.NEWEST_FIRST`: the ordering belongs to the union, not to
    the reviews table. The cursor it encodes is the same shape as before — a
    timestamp and a uuid — so cursors handed out by earlier versions of the feed
    are still valid.
    """
    followed = _followed_authors(viewer_id)

    reviews = sa.select(
        Review.id.label("id"),
        Review.created_at.label("occurred_at"),
        sa.cast(sa.literal(FeedItemType.REVIEW.value), sa.String).label("kind"),
    ).where(Review.user_id.in_(followed))

    # One row per game, because that is all the backlog table holds. Somebody who
    # adds thirty games in a sitting therefore contributes thirty lines, which is
    # the one place this shape is thin: collapsing a run of events by the same
    # actor into "Alex added 30 games to To Be Played" is a grouping the client
    # can do over a page, and worth doing once real backlogs exist to look at.
    activity = sa.select(
        BacklogItem.id.label("id"),
        BacklogItem.status_changed_at.label("occurred_at"),
        sa.cast(sa.literal(FeedItemType.BACKLOG_ACTIVITY.value), sa.String).label("kind"),
    ).where(
        BacklogItem.user_id.in_(followed),
        BacklogItem.status_changed_at >= datetime.now(UTC) - ACTIVITY_WINDOW,
    )

    arms = [reviews, activity]
    if blend:
        arms.append(_recommended_keys(viewer_id, blend))

    combined = sa.union_all(*arms).subquery("feed")
    statement = sa.select(combined.c.id, combined.c.occurred_at, combined.c.kind)
    sort = KeysetSort(
        expression=combined.c.occurred_at,
        id_column=combined.c.id,
        bind_type=sa.DateTime(timezone=True),
        parse=datetime.fromisoformat,
        descending=True,
    )
    return statement, sort


async def _hydrate(
    db: AsyncSession, rows: Sequence[sa.Row[Any]], viewer_id: uuid.UUID, blend: Blend
) -> list[FeedEntry]:
    """Load a page of keys into the things they name, keeping the page's order.

    Two queries for a mixed page, not one per row. A key whose row has since been
    deleted is dropped rather than rendered as a hole: the page is a snapshot of
    an ordering, and the alternative is a card with nothing in it.

    Both kinds of review are fetched together and split afterwards. They are the
    same projection with the same counters — only the envelope differs — and
    fetching them separately would be a second query to say the same thing.
    """
    review_kinds = (FeedItemType.REVIEW, FeedItemType.RECOMMENDED_REVIEW)
    review_ids = [row.id for row in rows if row.kind in review_kinds]
    activity_ids = [row.id for row in rows if row.kind == FeedItemType.BACKLOG_ACTIVITY]

    reviews: dict[uuid.UUID, FeedEntry] = {}
    if review_ids:
        found = await db.execute(reviews_service.select_reviews().where(Review.id.in_(review_ids)))
        entries = await reviews_service.with_stats(db, [row[0] for row in found.all()], viewer_id)
        by_review = {entry.review.id: entry for entry in entries}
        reviews = {
            row.id: (
                RecommendedReview(entry=entry, reason=blend.reason(entry.review))
                if row.kind == FeedItemType.RECOMMENDED_REVIEW
                else entry
            )
            for row in rows
            if (entry := by_review.get(row.id)) is not None and row.kind in review_kinds
        }

    activity: dict[uuid.UUID, FeedEntry] = {}
    if activity_ids:
        found_items = await db.execute(
            sa.select(BacklogItem)
            .where(BacklogItem.id.in_(activity_ids))
            # The actor as well as the game: an activity line names who moved it,
            # which a backlog list on someone's own profile never has to say.
            .options(
                selectinload(BacklogItem.user),
                selectinload(BacklogItem.game).selectinload(Game.platforms),
            )
        )
        activity = {item.id: item for item in found_items.scalars().all()}

    by_id = {**reviews, **activity}
    return [by_id[row.id] for row in rows if row.id in by_id]


async def _follows_anyone(db: AsyncSession, viewer_id: uuid.UUID) -> bool:
    return (
        await db.scalar(
            sa.select(sa.literal(1))
            .select_from(Follow)
            .where(Follow.follower_id == viewer_id, Follow.status == FollowStatus.ACCEPTED)
            .limit(1)
        )
    ) is not None


async def _blend_for(db: AsyncSession, viewer_id: uuid.UUID) -> Blend:
    """What SPEC §6.4's blend draws from for this viewer — or nothing at all.

    Nothing at all for a viewer who follows nobody. SPEC §6.4 promises that
    reader a specific empty state, suggested accounts and trending, and filling
    their Home with recommendations instead would quietly delete it: the one
    screen that exists to get somebody started would become a second Discover
    tab, and the follow graph would stop being what Home is about. A blend is
    something mixed into a feed; on its own it is not one.

    The games come from the same ranking Discover shows, so "recommended" means
    one thing across the app. The accounts are the *taste-matched* half of the
    suggestions and not the whole list: the most-followed fallback exists so an
    empty Home always has somebody to offer, and threading the five accounts
    everybody already follows through everybody's feed would make one Home look
    much like another — which is the opposite of a personalised blend.
    """
    if not await _follows_anyone(db, viewer_id):
        return Blend(games=frozenset(), accounts=frozenset())

    games = await recommendations.recommended_game_ids(db, viewer_id, limit=RECOMMENDED_GAME_LIMIT)
    accounts = await taste_matched_accounts(db, viewer_id, limit=SUGGESTED_ACCOUNT_LIMIT)
    return Blend(games=frozenset(games), accounts=frozenset(user.id for user in accounts))


async def list_feed(
    db: AsyncSession,
    viewer_id: uuid.UUID,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[FeedEntry]:
    """One page of Home, newest first (SPEC §6.4).

    The blend is computed per request rather than per first page. It has to be:
    the union it feeds is what the cursor is a position *in*, so a later page
    built from a different blend would be seeking through a different feed, and
    rows would repeat or vanish at the seam. Deterministic scoring is what makes
    that safe — the same data gives the same union on every page.
    """
    blend = await _blend_for(db, viewer_id)
    statement, sort = _feed_keys(viewer_id, blend)
    page = await fetch_keyset_keys(db, statement, sort, cursor=cursor, limit=limit)

    return KeysetPage(
        items=await _hydrate(db, page.items, viewer_id, blend),
        next_cursor=page.next_cursor,
    )


def _eligible_accounts(viewer_id: uuid.UUID) -> sa.Select[tuple[User]]:
    """Who may be suggested at all, before any ranking has an opinion.

    Public only: an account whose reviews are behind an approval is a poor first
    thing to be shown. Anyone the viewer already has an edge to is excluded,
    accepted *or* pending — suggesting someone whose approval you are waiting on
    reads as though the request never went through.

    One definition, applied to both halves of the ranking below, so a taste match
    can never smuggle in somebody the fallback would have refused.
    """
    already_asked = (
        sa.select(sa.literal(1))
        .where(Follow.follower_id == viewer_id, Follow.followee_id == User.id)
        .exists()
    )
    return sa.select(User).where(
        User.is_active.is_(True),
        User.is_private.is_(False),
        User.id != viewer_id,
        ~already_asked,
    )


async def _most_followed(
    db: AsyncSession, viewer_id: uuid.UUID, *, exclude: Sequence[uuid.UUID], limit: int
) -> Sequence[User]:
    """The fallback ordering: whoever the most people have chosen to follow."""
    followers = (
        sa.select(Follow.followee_id.label("user_id"), sa.func.count().label("followers"))
        .where(Follow.status == FollowStatus.ACCEPTED)
        .group_by(Follow.followee_id)
        .subquery()
    )
    statement = (
        _eligible_accounts(viewer_id)
        .outerjoin(followers, followers.c.user_id == User.id)
        .where(User.id.not_in(exclude))
        # Newest account breaks a tie, so a brand-new instance where nobody has
        # any followers still shows somebody rather than the same arbitrary row.
        .order_by(
            sa.func.coalesce(followers.c.followers, 0).desc(),
            User.created_at.desc(),
            User.id.desc(),
        )
        .limit(limit)
    )
    return (await db.execute(statement)).scalars().all()


async def taste_matched_accounts(
    db: AsyncSession, viewer_id: uuid.UUID, *, limit: int
) -> Sequence[User]:
    """Accounts this viewer rates like, in the order they are alike.

    The ranking is `app.services.recommendations`' — the same neighbourhood that
    decides what Discover recommends, so the two surfaces cannot come to
    different conclusions about who this reader is like.

    Empty is the ordinary answer for somebody who has not rated anything, and the
    two callers want different things from that: the empty state below tops it up
    with whoever is most followed, because it has to show *something*; the feed
    blend leaves it empty, because it does not.
    """
    ranked = await recommendations.similar_users(db, viewer_id, limit=SUGGESTED_ACCOUNT_POOL)
    if not ranked:
        return []

    eligible = await db.scalars(_eligible_accounts(viewer_id).where(User.id.in_(ranked)))
    by_id = {user.id: user for user in eligible.all()}
    # `IN` hands back no order of its own; the ranking is the order.
    return [by_id[user_id] for user_id in ranked if user_id in by_id][:limit]


async def suggested_accounts(
    db: AsyncSession, viewer_id: uuid.UUID, *, limit: int = SUGGESTED_ACCOUNT_LIMIT
) -> Sequence[User]:
    """Public accounts to offer a viewer whose feed is empty (SPEC §6.4).

    Taste first, most-followed for the rest. A viewer who has rated nothing has
    no neighbours, and before somebody has told us anything, "who a lot of people
    chose to follow" is the only honest answer to "who should I follow?". It tops
    up a short taste list rather than replacing it, so the two orderings never
    compete for the same slot.
    """
    chosen = list(await taste_matched_accounts(db, viewer_id, limit=limit))

    if len(chosen) < limit:
        chosen += await _most_followed(
            db,
            viewer_id,
            exclude=[user.id for user in chosen],
            limit=limit - len(chosen),
        )
    return chosen
