"""The Home feed — SPEC §6.4, §8.

Both endpoints require a caller: a feed is a view of *your* follow graph, so
there is no anonymous version of it to serve. That is the one thing here that
differs from the review endpoints, which are readable signed-out.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.api.v1.games import trending_payload
from app.api.v1.reviews import summary_payload
from app.models.backlog import BacklogItem
from app.schemas.feed import (
    FeedActivityItem,
    FeedItem,
    FeedItemType,
    FeedRecommendedItem,
    FeedReviewItem,
    FeedSuggestions,
)
from app.schemas.game import GameSummary
from app.schemas.pagination import CursorPage
from app.schemas.user import UserPublic
from app.services import feed as feed_service
from app.services import trending as trending_service
from app.services.feed import FeedEntry, RecommendedReview
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.services.reviews import ReviewWithStats

router = APIRouter(prefix="/feed", tags=["feed"])

PageLimit = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Results per page")]
Cursor = Annotated[str | None, Query(description="From a previous page")]


def review_item(entry: ReviewWithStats) -> FeedReviewItem:
    """Wrap a review in its feed envelope.

    `summary_payload` is the reviews router's, not a copy: a feed row and a
    profile tile are the same object, and the moment they are built in two places
    they start disagreeing about which thumbnail to fall back to.
    """
    return FeedReviewItem(
        type=FeedItemType.REVIEW,
        id=entry.review.id,
        occurred_at=entry.review.created_at,
        review=summary_payload(entry),
    )


def activity_item(item: BacklogItem) -> FeedActivityItem:
    """Wrap a backlog status change in its feed envelope (SPEC §6.11)."""
    return FeedActivityItem(
        type=FeedItemType.BACKLOG_ACTIVITY,
        id=item.id,
        occurred_at=item.status_changed_at,
        actor=UserPublic.model_validate(item.user),
        game=GameSummary.model_validate(item.game),
        status=item.status,
    )


def recommended_item(entry: RecommendedReview) -> FeedRecommendedItem:
    """Wrap a blended-in review in its envelope (SPEC §6.4).

    The same `summary_payload` as a follow item, because it is the same review
    and just as interactive. What the envelope adds is that it was recommended
    and why — the two things a reader needs to know before they trust a card
    from somebody they have never heard of.
    """
    return FeedRecommendedItem(
        type=FeedItemType.RECOMMENDED_REVIEW,
        id=entry.entry.review.id,
        occurred_at=entry.entry.review.created_at,
        review=summary_payload(entry.entry),
        reason=entry.reason,
    )


def feed_item(entry: FeedEntry) -> FeedItem:
    """Dispatch one row of the feed to the envelope for its kind.

    A match on the type rather than a flag on a common wrapper: adding a kind of
    item then fails to compile until this function has been told what to do with
    it, which is the whole reason `FeedEntry` is a union — and why blending in
    recommendations cost a branch here rather than a field on every row.
    """
    if isinstance(entry, BacklogItem):
        return activity_item(entry)
    if isinstance(entry, RecommendedReview):
        return recommended_item(entry)
    return review_item(entry)


@router.get(
    "",
    response_model=CursorPage[FeedItem],
    summary="Reviews and activity from the accounts you follow",
)
async def read_feed(
    db: DbSession,
    current_user: CurrentUser,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[FeedItem]:
    """SPEC §6.4, newest first.

    Items are a discriminated union — **branch on `type`**. A `review` carries
    the whole review, rating and media and live like and comment counts included,
    so a row is interactive on arrival and tapping through to the detail page
    tells the client nothing new. A `backlog_activity` is the lighter-weight line
    SPEC §6.11 blends inline: who moved which game to which list. A
    `recommended_review` is SPEC §6.4's blend — a review the caller does *not*
    follow the author of, carrying a `reason` for why it is here. Label it as
    such: it is in the union as its own type precisely so it cannot be rendered
    as though somebody they follow wrote it.

    There is no separate `GET /activity`, on purpose. SPEC §6.4 is explicit that
    Home is unified and that there is no Activity tab, so a second endpoint would
    be a second thing to keep ordered against this one.

    An empty page is the normal state for a new account rather than an error; the
    client fills it from `/feed/suggestions`. Nothing is blended into an empty
    feed — a caller who follows nobody gets the empty state SPEC §6.4 describes,
    not a page of recommendations dressed up as one.
    """
    page = await feed_service.list_feed(db, current_user.id, cursor=cursor, limit=limit)
    return CursorPage(
        items=[feed_item(entry) for entry in page.items],
        next_cursor=page.next_cursor,
    )


@router.get(
    "/suggestions",
    response_model=FeedSuggestions,
    summary="What to show when the feed is empty",
)
async def read_suggestions(db: DbSession, current_user: CurrentUser) -> FeedSuggestions:
    """The empty state from SPEC §6.4: somewhere to go when nobody is followed.

    A separate call rather than a field on the feed page, so the request that
    every scroll makes does not also carry a section that is only ever read once.
    """
    window = trending_service.DEFAULT_TRENDING_WINDOW
    accounts = await feed_service.suggested_accounts(db, current_user.id)
    trending = await trending_service.list_trending(
        db, window=window, limit=feed_service.TRENDING_SUGGESTION_LIMIT
    )

    return FeedSuggestions(
        accounts=[UserPublic.model_validate(user) for user in accounts],
        trending=trending_payload(list(trending), window),
    )
