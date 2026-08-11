"""Backlog lists (SPEC §6.9, §8).

Four lists, one table. A game holds at most one status, so "add to Playing" and
"move from To Be Played to Playing" are the same operation on the same row —
`set_status` — and the caller never has to know which of the two they are doing.
That is the whole reason `BacklogItem` is unique per (user, game): two rows for
one game would let a profile claim it is both completed and unplayed.

Positions are kept dense (0..n-1) *within a status*, the way
`app.services.users` keeps favorites dense: append is then `len(list)`, a reorder
is a straight index assignment, and moving a game between lists closes the gap it
left behind. Unlike review media there is no unique constraint on the position,
so renumbering can be assigned in one pass rather than flushed row by row.

Privacy is the caller's, not this module's: SPEC §6.9 says lists inherit account
privacy, and `app.api.v1.users` applies `users.require_content_access` before
reading anyone else's. Keeping the check at the edge is what lets the feed reuse
these rows under its own gate — an accepted follow edge — without two different
answers to the same question.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus
from app.models.game import Game
from app.models.user import User
from app.services.exceptions import (
    BacklogItemNotFoundError,
    GameNotFoundError,
    InvalidBacklogOrderError,
)

# SPEC §6.9's order, which is also the order a game moves through them. Declared
# once here so the API and every client draw the four headings the same way
# rather than each picking the enum's or the database's.
LIST_ORDER: tuple[BacklogStatus, ...] = (
    BacklogStatus.TO_BE_PLAYED,
    BacklogStatus.PLAYING,
    BacklogStatus.COMPLETED,
    BacklogStatus.DROPPED,
)

# Every caller renders a game card, which needs the platforms too.
_LOADERS = (selectinload(BacklogItem.game).selectinload(Game.platforms),)


async def list_items(
    db: AsyncSession, user_id: uuid.UUID, *, status: BacklogStatus | None = None
) -> Sequence[BacklogItem]:
    """One user's backlog in list order, optionally narrowed to one status.

    Ordered by status then position so a caller can group by walking the result
    once. `game_id` breaks a tie, which only matters for rows written outside
    this module — everything here keeps positions distinct.
    """
    statement = (
        sa.select(BacklogItem)
        .where(BacklogItem.user_id == user_id)
        .order_by(BacklogItem.status, BacklogItem.position, BacklogItem.game_id)
        .options(*_LOADERS)
    )
    if status is not None:
        statement = statement.where(BacklogItem.status == status)

    return (await db.execute(statement)).scalars().all()


async def _in_status(
    db: AsyncSession, user_id: uuid.UUID, status: BacklogStatus
) -> Sequence[BacklogItem]:
    return await list_items(db, user_id, status=status)


def _renumber(items: Sequence[BacklogItem]) -> None:
    """Compact positions to 0..n-1 in their current order."""
    for index, item in enumerate(items):
        if item.position != index:
            item.position = index


async def get_item(db: AsyncSession, user_id: uuid.UUID, game_id: uuid.UUID) -> BacklogItem | None:
    """The row for one game, or None when the game is on no list.

    `populate_existing` because a session that already holds this row holds it as
    it was before the move that just happened — including a `status_changed_at`
    that is still the SQL expression it was assigned rather than the timestamp
    the database resolved it to.
    """
    item: BacklogItem | None = await db.scalar(
        sa.select(BacklogItem)
        .where(BacklogItem.user_id == user_id, BacklogItem.game_id == game_id)
        .options(*_LOADERS)
        .execution_options(populate_existing=True)
    )
    return item


async def set_status(
    db: AsyncSession, user: User, game_id: uuid.UUID, status: BacklogStatus
) -> BacklogItem:
    """Put a game on a list, or move it to a different one (SPEC §6.9).

    An UPSERT rather than a create: the unique constraint on (user, game) means
    there is only ever one row to write, and moving a game is that row changing
    its `status`. It lands at the end of the list it arrives on, because the
    owner's order within a list is theirs — dropping a new arrival into the
    middle would be this function having an opinion about their queue.

    Setting the status a game already has is a no-op that returns the existing
    row: `status_changed_at` deliberately does not move, so a client retrying a
    request cannot re-announce the same change to the owner's followers.
    """
    if await db.get(Game, game_id) is None:
        raise GameNotFoundError

    item = await get_item(db, user.id, game_id)
    if item is not None and item.status is status:
        return item

    if item is None:
        item = BacklogItem(
            user_id=user.id,
            game_id=game_id,
            status=status,
            position=len(await _in_status(db, user.id, status)),
        )
        db.add(item)
    else:
        vacated = item.status
        # Read the destination *before* mutating: any query autoflushes, so once
        # `item.status` has moved the row is already counted among its new
        # neighbours and the append would land one slot past the end.
        arriving_at = len(await _in_status(db, user.id, status))

        item.status = status
        item.position = arriving_at
        # The transaction clock, matching `created_at` and `Review.created_at` —
        # the feed interleaves reviews and these events in one ordering, so they
        # have to be told the time by the same thing.
        item.status_changed_at = sa.func.now()
        await db.flush()
        _renumber(await _in_status(db, user.id, vacated))

    await db.commit()
    refreshed = await get_item(db, user.id, game_id)
    if refreshed is None:  # pragma: no cover — the row was just committed
        raise BacklogItemNotFoundError
    return refreshed


async def remove(db: AsyncSession, user: User, game_id: uuid.UUID) -> None:
    """Take a game off the backlog entirely (SPEC §6.9).

    404 rather than a silent success: unlike unfollowing, where the caller's
    intent ("not be following") is satisfied either way, removing a game that is
    not there means the client is looking at a list somebody else already
    changed, and it should re-read rather than believe it removed something.
    """
    item = await get_item(db, user.id, game_id)
    if item is None:
        raise BacklogItemNotFoundError

    status = item.status
    await db.delete(item)
    await db.flush()

    _renumber(await _in_status(db, user.id, status))
    await db.commit()


async def reorder(
    db: AsyncSession, user: User, status: BacklogStatus, game_ids: Sequence[uuid.UUID]
) -> Sequence[BacklogItem]:
    """Rewrite the order of one list (SPEC §6.9).

    The request must name exactly the games currently on that list — the same
    rule `users.reorder_favorites` applies, for the same reason: a request that
    is missing a game is a stale client, and quietly reconciling it would discard
    whatever another tab had just moved onto the list.

    Only one list is touched. Reordering does not move `status_changed_at`, so
    tidying a list is not an event anybody's Home feed hears about.
    """
    current = await _in_status(db, user.id, status)
    by_game = {item.game_id: item for item in current}
    if len(game_ids) != len(set(game_ids)) or set(game_ids) != set(by_game):
        raise InvalidBacklogOrderError

    for index, game_id in enumerate(game_ids):
        by_game[game_id].position = index
    await db.commit()

    return await _in_status(db, user.id, status)
