"""Profiles, favorites, stats and the follow lists (SPEC §6.2, §6.7, §6.8).

The privacy rule from SPEC §6.7 runs through all of it: a private account's
*shell* is public — otherwise nobody could find it to send a follow request — but
its reviews, stats and lists need an approved follow. `content_is_visible_to`
below is the single expression that decides this, shared with user search so the
two can't drift apart.

Everything here *reads* the graph; nothing writes to it. The actions that do —
request, approve, unfollow, remove — live in `app.services.social`, and take
effect on every surface below without any of them being told, because they write
the same edge `content_is_visible_to` was already looking for.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus, FollowStatus
from app.models.game import Game
from app.models.review import MAX_RATING, MIN_RATING, Review
from app.models.social import Follow
from app.models.user import MAX_FAVORITE_GAMES, FavoriteGame, User
from app.schemas.user import UserUpdate
from app.services import storage
from app.services.exceptions import (
    AlreadyFavoritedError,
    FavoriteLimitReachedError,
    FavoriteNotFoundError,
    GameNotFoundError,
    InvalidFavoriteOrderError,
    ProfileIsPrivateError,
    UserNotFoundError,
)
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    fetch_keyset_page,
)


@dataclass(frozen=True, slots=True)
class ProfileStatistics:
    """SPEC §6.8. Plain numbers — the schema layer decides how to present them."""

    games_reviewed: int
    review_count: int
    average_rating: float | None
    total_playtime_minutes: int
    completed_count: int
    backlog_count: int
    rating_distribution: dict[int, int]


@dataclass(frozen=True, slots=True)
class FollowCounts:
    followers: int
    following: int


# --- Privacy (SPEC §6.7) ---------------------------------------------------


def content_is_visible_to(viewer_id: uuid.UUID | None) -> sa.ColumnElement[bool]:
    """Whether gated content is visible: owner and approved followers only.

    Correlates on `User.id`, so it drops into any statement with the users table
    in scope. Written as one expression rather than a post-filter so a gated
    value cannot be forgotten on the way out of a query.
    """
    if viewer_id is None:
        return User.is_private.is_(False)

    approved_follow = (
        sa.select(sa.literal(1))
        .where(
            Follow.follower_id == viewer_id,
            Follow.followee_id == User.id,
            Follow.status == FollowStatus.ACCEPTED,
        )
        .exists()
    )
    return sa.or_(User.is_private.is_(False), User.id == viewer_id, approved_follow)


async def viewer_may_see_content(
    db: AsyncSession, owner: User, viewer_id: uuid.UUID | None
) -> bool:
    """The single-profile form of `content_is_visible_to`."""
    if not owner.is_private:
        return True
    if viewer_id is None:
        return False
    if viewer_id == owner.id:
        return True

    approved = await db.scalar(
        sa.select(sa.literal(1)).where(
            Follow.follower_id == viewer_id,
            Follow.followee_id == owner.id,
            Follow.status == FollowStatus.ACCEPTED,
        )
    )
    return approved is not None


async def require_content_access(
    db: AsyncSession, owner: User, viewer_id: uuid.UUID | None
) -> None:
    if not await viewer_may_see_content(db, owner, viewer_id):
        raise ProfileIsPrivateError


# --- Lookups ---------------------------------------------------------------


async def get_by_username(db: AsyncSession, username: str) -> User:
    """Handles are stored lower-cased, so the lookup is case-insensitive for free."""
    user = await db.scalar(
        sa.select(User).where(User.username == username.lower(), User.is_active.is_(True))
    )
    if user is None:
        raise UserNotFoundError
    return user


async def get_by_id(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = await db.scalar(sa.select(User).where(User.id == user_id, User.is_active.is_(True)))
    if user is None:
        raise UserNotFoundError
    return user


async def follow_counts(db: AsyncSession, user_id: uuid.UUID) -> FollowCounts:
    """Accepted edges only — a pending request is not yet a follower.

    Visible even on a private profile: SPEC §6.7 gates the follower *lists*, and
    a bare number tells a stranger nothing about who those people are.
    """
    followers = (
        sa.select(sa.func.count())
        .select_from(Follow)
        .where(Follow.followee_id == user_id, Follow.status == FollowStatus.ACCEPTED)
        .scalar_subquery()
    )
    following = (
        sa.select(sa.func.count())
        .select_from(Follow)
        .where(Follow.follower_id == user_id, Follow.status == FollowStatus.ACCEPTED)
        .scalar_subquery()
    )
    row = (await db.execute(sa.select(followers, following))).one()
    return FollowCounts(followers=row[0], following=row[1])


# --- Editing your own profile (SPEC §6.2) ----------------------------------


async def update_profile(db: AsyncSession, user: User, data: UserUpdate) -> User:
    """Apply a partial update.

    `exclude_unset` is what makes this a PATCH rather than a PUT: keys the client
    left out keep their current value, while an explicit null clears the column.
    """
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    await db.commit()
    await db.refresh(user)
    return user


async def set_avatar(db: AsyncSession, user: User, data: bytes) -> User:
    """Store an uploaded image and point the profile at it.

    The previous object is deleted only after the row has been committed. Doing
    it the other way round risks deleting the image the profile still references
    if the commit then fails.
    """
    content_type = storage.validate_upload(data, storage.AVATAR_POLICY)
    key = storage.build_key(storage.AVATAR_POLICY, user.id, content_type)
    url = await storage.put_object(key, data, content_type)

    previous = user.avatar_url
    user.avatar_url = url
    await db.commit()
    await db.refresh(user)

    await storage.discard(previous)
    return user


async def clear_avatar(db: AsyncSession, user: User) -> User:
    previous = user.avatar_url
    user.avatar_url = None
    await db.commit()
    await db.refresh(user)

    await storage.discard(previous)
    return user


# --- Favorite games (SPEC §6.2) --------------------------------------------


async def list_favorites(db: AsyncSession, user_id: uuid.UUID) -> Sequence[FavoriteGame]:
    """The curated list in its pinned order.

    The game and its platforms are eager-loaded because every caller renders a
    game card, which needs both.
    """
    statement = (
        sa.select(FavoriteGame)
        .where(FavoriteGame.user_id == user_id)
        .order_by(FavoriteGame.position, FavoriteGame.game_id)
        .options(selectinload(FavoriteGame.game).selectinload(Game.platforms))
    )
    return (await db.execute(statement)).scalars().all()


def _renumber(favorites: Sequence[FavoriteGame]) -> None:
    """Compact positions to 0..n-1 in their current order.

    Keeping them dense means "add" can append at `len(favorites)` and a reorder
    is a straight index assignment, with no gaps to reason about.
    """
    for index, favorite in enumerate(favorites):
        favorite.position = index


async def add_favorite(db: AsyncSession, user: User, game_id: uuid.UUID) -> Sequence[FavoriteGame]:
    """Pin a game to the end of the list."""
    if await db.get(Game, game_id) is None:
        raise GameNotFoundError

    current = await list_favorites(db, user.id)
    if any(favorite.game_id == game_id for favorite in current):
        raise AlreadyFavoritedError
    if len(current) >= MAX_FAVORITE_GAMES:
        raise FavoriteLimitReachedError(MAX_FAVORITE_GAMES)

    db.add(FavoriteGame(user_id=user.id, game_id=game_id, position=len(current)))
    await db.commit()
    return await list_favorites(db, user.id)


async def remove_favorite(
    db: AsyncSession, user: User, game_id: uuid.UUID
) -> Sequence[FavoriteGame]:
    favorite = await db.get(FavoriteGame, {"user_id": user.id, "game_id": game_id})
    if favorite is None:
        raise FavoriteNotFoundError

    await db.delete(favorite)
    await db.flush()
    # Close the gap the removal left, so positions stay 0..n-1.
    _renumber(await list_favorites(db, user.id))
    await db.commit()
    return await list_favorites(db, user.id)


async def reorder_favorites(
    db: AsyncSession, user: User, game_ids: Sequence[uuid.UUID]
) -> Sequence[FavoriteGame]:
    """Rewrite the pinned order.

    The request must name exactly the current set. Anything else means the client
    is working from a stale list, and quietly reconciling it would discard
    whatever another tab had just added.
    """
    current = await list_favorites(db, user.id)
    by_game = {favorite.game_id: favorite for favorite in current}
    if len(game_ids) != len(set(game_ids)) or set(game_ids) != set(by_game):
        raise InvalidFavoriteOrderError

    for index, game_id in enumerate(game_ids):
        by_game[game_id].position = index
    await db.commit()
    return await list_favorites(db, user.id)


# --- Profile stats (SPEC §6.8) ---------------------------------------------


async def get_stats(db: AsyncSession, user_id: uuid.UUID) -> ProfileStatistics:
    """Three grouped queries, no per-row work.

    Everything is computed from whatever exists today: reviews and backlog items
    only start arriving in later slices, so an account with neither is the normal
    case rather than an error. Aggregates over an empty set come back as zero,
    and the average comes back null.
    """
    totals = (
        await db.execute(
            sa.select(
                sa.func.count(Review.id),
                sa.func.count(sa.distinct(Review.game_id)),
                sa.func.avg(Review.rating),
                sa.func.coalesce(sa.func.sum(Review.playtime_minutes), 0),
            ).where(Review.user_id == user_id)
        )
    ).one()
    review_count, games_reviewed, average, playtime = totals

    # Zero-filled so a client can draw all ten bars without checking for holes.
    distribution = dict.fromkeys(range(MIN_RATING, MAX_RATING + 1), 0)
    rated = await db.execute(
        sa.select(Review.rating, sa.func.count())
        .where(Review.user_id == user_id)
        .group_by(Review.rating)
    )
    for rating, count in rated.all():
        distribution[rating] = count

    backlog = await db.execute(
        sa.select(BacklogItem.status, sa.func.count())
        .where(BacklogItem.user_id == user_id)
        .group_by(BacklogItem.status)
    )
    by_status = {row[0]: row[1] for row in backlog.all()}

    return ProfileStatistics(
        # Identical today: `uq_reviews_user_id_game_id` allows one review per
        # game. Kept apart because SPEC §6.8 lists them separately and only one
        # of them stays a count of reviews once re-logging a game is possible.
        games_reviewed=games_reviewed,
        review_count=review_count,
        average_rating=float(average) if average is not None else None,
        total_playtime_minutes=playtime,
        completed_count=by_status.get(BacklogStatus.COMPLETED, 0),
        # "Backlog" in the SPEC §6.8 sense is the To Be Played list specifically,
        # not the union of all four lists from §6.9.
        backlog_count=by_status.get(BacklogStatus.TO_BE_PLAYED, 0),
        rating_distribution=distribution,
    )


# --- Follower / following lists (SPEC §6.2) --------------------------------


async def _paged_follows(
    db: AsyncSession,
    statement: sa.Select[tuple[User, datetime]],
    *,
    cursor: str | None,
    limit: int,
) -> KeysetPage[User]:
    """Newest edge first, tie-broken by user id.

    The sort key is when the follow happened, which lives on the join row rather
    than on the user, so the ordering stays total even when two people followed
    in the same transaction.
    """
    return await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=Follow.created_at,
            id_column=User.id,
            bind_type=sa.DateTime(timezone=True),
            parse=datetime.fromisoformat,
            descending=True,
        ),
        cursor=cursor,
        limit=limit,
    )


async def list_followers(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[User]:
    statement = (
        sa.select(User, Follow.created_at)
        .join(Follow, Follow.follower_id == User.id)
        .where(
            Follow.followee_id == user_id,
            Follow.status == FollowStatus.ACCEPTED,
            User.is_active.is_(True),
        )
    )
    return await _paged_follows(db, statement, cursor=cursor, limit=limit)


async def list_following(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[User]:
    statement = (
        sa.select(User, Follow.created_at)
        .join(Follow, Follow.followee_id == User.id)
        .where(
            Follow.follower_id == user_id,
            Follow.status == FollowStatus.ACCEPTED,
            User.is_active.is_(True),
        )
    )
    return await _paged_follows(db, statement, cursor=cursor, limit=limit)
