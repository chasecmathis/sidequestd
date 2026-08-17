"""Reviews and their attached media (SPEC §6.3, §8).

A review is the app's unit of content, so two rules run through everything here:

* **One review per user per game.** `uq_reviews_user_id_game_id` enforces it; the
  service checks first so the user gets a 409 that points at editing rather than
  a constraint violation.
* **Reviews inherit their author's privacy** (SPEC §6.3, §6.7). Every read goes
  through `users.require_content_access`, so a private account's reviews are
  invisible on every surface — detail, profile grid and Home feed — without each
  one having to remember.

Likes and comments are counted but never written here: `app.services.interactions`
owns those verbs, and reads its counters back through `interaction_stats` so
there is exactly one place a like is counted.

`select_reviews`, `NEWEST_FIRST` and `with_stats` are public because a review
list is not only a profile grid any more: `app.services.feed` pages the same
projection in the same order with a different WHERE. Anything that lists reviews
should be built from those three rather than assembling its own — a second
projection is a second thing to keep in step with the carousel, the counters and
the eager loads.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.enums import MediaType, NotificationType, ProcessingStatus
from app.models.game import Game
from app.models.review import MAX_MEDIA_PER_REVIEW, Comment, Like, Review, ReviewMedia
from app.models.user import User
from app.schemas.review import ReviewCreate, ReviewUpdate
from app.services import media as media_service
from app.services import notifications, storage
from app.services import users as users_service
from app.services.exceptions import (
    GameNotFoundError,
    MediaLimitReachedError,
    MediaNotFoundError,
    MultipleVideosError,
    NotReviewOwnerError,
    ReviewAlreadyExistsError,
    ReviewNotFoundError,
)
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    fetch_keyset_page,
)


@dataclass(frozen=True, slots=True)
class InteractionStats:
    """The counters SPEC §6.3 puts on a review, from the viewer's perspective."""

    like_count: int
    comment_count: int
    viewer_has_liked: bool


NO_INTERACTIONS = InteractionStats(like_count=0, comment_count=0, viewer_has_liked=False)


@dataclass(frozen=True, slots=True)
class ReviewWithStats:
    """A review paired with its counters — the shape every endpoint returns.

    Kept as a wrapper rather than attributes on the model so the counts are
    obviously derived, and so a caller cannot accidentally serialise a review
    without deciding whose `viewer_has_liked` it is.
    """

    review: Review
    stats: InteractionStats


# Author, game and media are all rendered by every caller, so they are loaded up
# front instead of lazily per row.
_LOADERS = (
    selectinload(Review.author),
    selectinload(Review.game).selectinload(Game.platforms),
    selectinload(Review.media),
)


def select_reviews() -> sa.Select[tuple[Review, datetime]]:
    """The statement every paged review surface starts from.

    Selects the review *and* its sort key, which is what `fetch_keyset_page`
    expects, with the eager loads already attached. Callers add their WHERE — one
    author for the profile grid, the viewer's follow edges for the feed — and
    nothing else about the projection is theirs to decide.
    """
    return sa.select(Review, Review.created_at).options(*_LOADERS)


# Reverse-chronological, tie-broken by id. SPEC §6.2 and §6.4 both ask for newest
# first, and sharing the sort means the cursors mean the same thing on both.
NEWEST_FIRST = KeysetSort(
    expression=Review.created_at,
    id_column=Review.id,
    bind_type=sa.DateTime(timezone=True),
    parse=datetime.fromisoformat,
    descending=True,
)


# --- Interaction counters ---------------------------------------------------


async def interaction_stats(
    db: AsyncSession, review_ids: Sequence[uuid.UUID], viewer_id: uuid.UUID | None
) -> dict[uuid.UUID, InteractionStats]:
    """Like and comment counts for a whole page in three queries, not 3N.

    Reviews with no activity are absent from the grouped results, so the caller
    fills them in with `NO_INTERACTIONS` rather than this returning a row per id.
    """
    if not review_ids:
        return {}

    like_rows = await db.execute(
        sa.select(Like.review_id, sa.func.count())
        .where(Like.review_id.in_(review_ids))
        .group_by(Like.review_id)
    )
    likes = {row[0]: row[1] for row in like_rows.all()}

    comment_rows = await db.execute(
        sa.select(Comment.review_id, sa.func.count())
        .where(Comment.review_id.in_(review_ids))
        .group_by(Comment.review_id)
    )
    comments = {row[0]: row[1] for row in comment_rows.all()}

    liked: set[uuid.UUID] = set()
    if viewer_id is not None:
        liked = set(
            (
                await db.execute(
                    sa.select(Like.review_id).where(
                        Like.review_id.in_(review_ids), Like.user_id == viewer_id
                    )
                )
            )
            .scalars()
            .all()
        )

    return {
        review_id: InteractionStats(
            like_count=likes.get(review_id, 0),
            comment_count=comments.get(review_id, 0),
            viewer_has_liked=review_id in liked,
        )
        for review_id in review_ids
    }


async def with_stats(
    db: AsyncSession, reviews: Sequence[Review], viewer_id: uuid.UUID | None
) -> list[ReviewWithStats]:
    """Pair a page of reviews with this viewer's counters, in one batch.

    Every surface that returns reviews ends here, which is what makes a like
    written by `app.services.interactions` show up on all of them at once.
    """
    stats = await interaction_stats(db, [review.id for review in reviews], viewer_id)
    return [
        ReviewWithStats(review=review, stats=stats.get(review.id, NO_INTERACTIONS))
        for review in reviews
    ]


# --- Lookups ----------------------------------------------------------------


async def _load(db: AsyncSession, review_id: uuid.UUID) -> Review:
    """Read a review and everything rendered with it, from the database.

    `populate_existing` because a session that already holds this review holds it
    as it was when it was last read — including a `media` collection that a delete
    in the same session has since emptied. Without it, "load, mutate, load again"
    hands back the first load's collection, and the second read quietly disagrees
    with the row it claims to be.
    """
    review = await db.scalar(
        sa.select(Review)
        .where(Review.id == review_id)
        .options(*_LOADERS)
        .execution_options(populate_existing=True)
    )
    if review is None:
        raise ReviewNotFoundError
    return review


async def get_review(
    db: AsyncSession, review_id: uuid.UUID, viewer_id: uuid.UUID | None
) -> ReviewWithStats:
    """Full detail, gated by the author's privacy (SPEC §6.3)."""
    review = await _load(db, review_id)
    await users_service.require_content_access(db, review.author, viewer_id)
    return (await with_stats(db, [review], viewer_id))[0]


async def _owned(db: AsyncSession, review_id: uuid.UUID, user: User) -> Review:
    """Load a review the caller is allowed to change.

    403 rather than 404 for someone else's review: it is readable, so hiding its
    existence here would say nothing the detail endpoint does not already tell them.
    """
    review = await _load(db, review_id)
    if review.user_id != user.id:
        raise NotReviewOwnerError
    return review


# --- Writing (SPEC §6.3) ----------------------------------------------------


async def refresh_game_rating(db: AsyncSession, game_id: uuid.UUID) -> None:
    """Rewrite `games.rating_average` / `rating_count` from `reviews`.

    Called inside the transaction of every review write, so a member who rates a
    game and goes back to it sees the average move. That immediacy is the whole
    reason this is denormalised onto `games` rather than materialised on a
    schedule the way `trending_scores` is.

    Recomputed, never incremented. An increment that misses one path is wrong
    forever; a recompute that misses one is wrong until the next review of that
    game and then heals itself.

    The row is locked *before* the aggregate is issued, and as a separate
    statement, which is not ceremony. Under READ COMMITTED an
    `UPDATE … SET x = (SELECT …)` that blocks on a concurrent writer re-runs its
    subquery against the *original* snapshot: it sees what the other transaction
    did to the row it locked, but not what it did to any other row — and the
    reviews being counted are exactly "any other row". Two people rating the same
    game in the same instant would leave a count permanently one short. Taking
    the lock first means the second writer's aggregate runs in a fresh snapshot
    and counts the review the first one just committed. Nothing here can
    deadlock: a review write touches one game, so no transaction ever holds two
    of these locks.

    `synchronize_session="fetch"` is load-bearing too. The session is built with
    `expire_on_commit=False`, so a `Game` already in the identity map — the one
    `create_review` loaded to check the game exists, which is then embedded in
    the 201 response — would otherwise keep and serialise its pre-review figures.

    Note for whoever adds account deletion: `reviews.user_id` is ON DELETE
    CASCADE, so removing a user silently drops their reviews out from under these
    counters. That path has to call this for every game it touched.
    """
    await db.execute(sa.select(Game.id).where(Game.id == game_id).with_for_update())
    await db.execute(
        sa.update(Game)
        .where(Game.id == game_id)
        .values(
            rating_average=(
                sa.select(sa.func.avg(Review.rating))
                .where(Review.game_id == game_id)
                .scalar_subquery()
            ),
            rating_count=(
                sa.select(sa.func.count())
                .select_from(Review)
                .where(Review.game_id == game_id)
                .scalar_subquery()
            ),
        )
        .execution_options(synchronize_session="fetch")
    )


async def create_review(db: AsyncSession, user: User, data: ReviewCreate) -> ReviewWithStats:
    """Start a review of a game already in the catalog."""
    if await db.get(Game, data.game_id) is None:
        raise GameNotFoundError

    existing = await db.scalar(
        sa.select(Review.id).where(Review.user_id == user.id, Review.game_id == data.game_id)
    )
    if existing is not None:
        raise ReviewAlreadyExistsError

    review = Review(
        user_id=user.id,
        game_id=data.game_id,
        rating=data.rating,
        review_text=data.review_text,
        playtime_minutes=data.playtime_minutes,
    )
    db.add(review)
    # For the same reason a comment is flushed before its notifications: the id
    # is what the notification deep-links to, and it does not exist until now.
    await db.flush()

    # SPEC §6.12's BACKLOG_GAME_REVIEWED — the one notification with more than
    # one recipient. Who they are is `app.services.notifications`' question, not
    # this module's; all reviews knows is that a review was written, which is
    # exactly as much as it should have to know.
    #
    # A per-category preference (SPEC §6.13's notification settings) would sit in
    # front of this fan-out and every other one, so it belongs to `emit` and to
    # the Settings slice rather than here.
    for recipient_id in await notifications.backlog_reviewers_of(
        db, author_id=user.id, game_id=data.game_id
    ):
        await notifications.emit(
            db,
            recipient_id=recipient_id,
            actor_id=user.id,
            type=NotificationType.BACKLOG_GAME_REVIEWED,
            review_id=review.id,
        )

    await refresh_game_rating(db, data.game_id)

    await db.commit()

    return ReviewWithStats(review=await _load(db, review.id), stats=NO_INTERACTIONS)


async def update_review(
    db: AsyncSession, user: User, review_id: uuid.UUID, data: ReviewUpdate
) -> ReviewWithStats:
    """Owner-only partial update.

    The game is not among the editable fields: pointing an existing review at a
    different game would silently rewrite what everyone who already liked or
    commented on it was responding to. `updated_at` moves on its own — SPEC §6.3
    asks for it and `TimestampMixin` has an `onupdate` — but only if something
    actually changed, so an empty PATCH is a true no-op.
    """
    review = await _owned(db, review_id, user)

    changed = data.model_dump(exclude_unset=True)
    for field, value in changed.items():
        setattr(review, field, value)

    # Only when the score itself moved. A PATCH of the text alone should not take
    # a row lock on a game whose average it cannot possibly have changed — and
    # the flush is required rather than incidental, because the session is built
    # with `autoflush=False` and the aggregate reads the table, not the session.
    if "rating" in changed:
        await db.flush()
        await refresh_game_rating(db, review.game_id)

    await db.commit()

    return (await with_stats(db, [await _load(db, review.id)], user.id))[0]


async def delete_review(db: AsyncSession, user: User, review_id: uuid.UUID) -> None:
    """Owner-only delete, taking the stored media with it.

    The rows go first and the objects after: `cascade="all, delete-orphan"` on
    `Review.media` removes the rows, and the bucket cleanup then runs against a
    list nothing references any more. Doing it the other way round would delete
    live files if the transaction rolled back.
    """
    review = await _owned(db, review_id, user)
    urls = [url for item in review.media for url in (item.url, item.thumbnail_url)]
    # Read before the delete: the instance is expunged by the flush below.
    game_id = review.game_id

    await db.delete(review)
    await db.flush()
    # The last review of a game leaves avg() returning NULL over an empty set,
    # which lands as the unrated state without needing a case for it.
    await refresh_game_rating(db, game_id)
    await db.commit()

    for url in urls:
        await storage.discard(url)


# --- Media (SPEC §6.3) ------------------------------------------------------


async def _renumber(db: AsyncSession, items: Sequence[ReviewMedia]) -> None:
    """Compact positions to 0..n-1, given `items` already in position order.

    Flushed one at a time, in ascending order, rather than assigned in a batch:
    `uq_review_media_review_id_position` is checked per statement, and letting the
    unit of work choose the order can move an item into a slot its neighbour has
    not left yet. Ascending is always safe — every item's new index is at or below
    its old position, so the slot it is moving into is already empty.
    """
    for index, item in enumerate(items):
        if item.position == index:
            continue
        item.position = index
        await db.flush([item])


async def _ordered_media(db: AsyncSession, review_id: uuid.UUID) -> Sequence[ReviewMedia]:
    return (
        (
            await db.execute(
                sa.select(ReviewMedia)
                .where(ReviewMedia.review_id == review_id)
                .order_by(ReviewMedia.position)
            )
        )
        .scalars()
        .all()
    )


async def attach_media(
    db: AsyncSession, user: User, review_id: uuid.UUID, data: bytes, *, alt_text: str | None
) -> ReviewMedia:
    """Store one photo or clip against a review and queue it for processing.

    The limits from SPEC §6.3 are checked before anything reaches the bucket, so a
    rejected upload leaves nothing behind. What lands at the end of the carousel
    is the picture the user sent with its metadata removed (SPEC §9), PENDING;
    `app.services.media` fills in the rest.

    The order is deliberate: **validate the original, store the stripped copy.**
    The size cap and the 60-second limit have to be judged on what the user
    actually uploaded — stripping changes the byte count, and a file must not
    become acceptable by being cleaned. Nothing un-stripped ever reaches the
    bucket, because the only `put_object` here is given `clean`.
    """
    review = await _owned(db, review_id, user)
    current = review.media  # eager-loaded and ordered by position

    if len(current) >= MAX_MEDIA_PER_REVIEW:
        raise MediaLimitReachedError(MAX_MEDIA_PER_REVIEW)

    probe = media_service.inspect(data)
    if probe.media_type is MediaType.VIDEO and any(
        item.type is MediaType.VIDEO for item in current
    ):
        raise MultipleVideosError

    # Off the loop for the same reason thumbnailing is: stripping a 15 MB photo
    # decodes and re-encodes it, which is real CPU work and not something to do
    # while other requests wait.
    clean = await asyncio.to_thread(media_service.strip_metadata, data, probe.content_type)

    key = storage.build_key(probe.policy, review.id, probe.content_type)
    url = await storage.put_object(key, clean, probe.content_type)

    item = ReviewMedia(
        review_id=review.id,
        type=probe.media_type,
        url=url,
        alt_text=alt_text,
        position=len(current),
        processing_status=ProcessingStatus.PENDING,
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return item


async def detach_media(
    db: AsyncSession, user: User, review_id: uuid.UUID, media_id: uuid.UUID
) -> Sequence[ReviewMedia]:
    """Remove one item and close the gap it leaves in the carousel."""
    review = await _owned(db, review_id, user)

    item = await db.get(ReviewMedia, media_id)
    if item is None or item.review_id != review.id:
        raise MediaNotFoundError

    urls = (item.url, item.thumbnail_url)
    await db.delete(item)
    await db.flush()

    await _renumber(db, await _ordered_media(db, review.id))
    await db.commit()

    for url in urls:
        await storage.discard(url)
    return await _ordered_media(db, review.id)


# --- Listing (SPEC §6.2 profile grid, §8) -----------------------------------


async def list_by_author(
    db: AsyncSession,
    author_id: uuid.UUID,
    *,
    viewer_id: uuid.UUID | None,
    game_id: uuid.UUID | None = None,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[ReviewWithStats]:
    """One author's reviews, newest first — the profile grid from SPEC §6.2.

    `game_id` narrows it to a single game, which is how a client that just hit the
    one-review-per-game conflict finds the review it should be editing instead.

    Privacy is the caller's job: this is reached through `read_user_reviews`, which
    resolves the author and applies `require_content_access` first.
    """
    statement = select_reviews().where(Review.user_id == author_id)
    if game_id is not None:
        statement = statement.where(Review.game_id == game_id)

    page = await fetch_keyset_page(db, statement, NEWEST_FIRST, cursor=cursor, limit=limit)

    return KeysetPage(
        items=await with_stats(db, page.items, viewer_id),
        next_cursor=page.next_cursor,
    )
