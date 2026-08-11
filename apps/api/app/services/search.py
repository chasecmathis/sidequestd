"""Game and user search (SPEC §6.6).

Both searches *filter* on a case-insensitive substring — which is what someone
typing half a title expects to work — and *rank* by trigram similarity, so
"witcher" puts "The Witcher 3" above "Witcheye". The pg_trgm GIN indexes on
`games.title`, `users.username` and `users.display_name` serve both halves.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, selectinload

from app.models.game import Game
from app.models.review import Review
from app.models.user import User
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    fetch_keyset_page,
)
from app.services.users import content_is_visible_to

# A display-name match is a slightly weaker signal than a handle match, so an
# equal-similarity hit on the handle wins.
DISPLAY_NAME_WEIGHT = 0.9


@dataclass(frozen=True, slots=True)
class UserHit:
    """A user search row with the privacy decision already applied.

    `review_count` is None when the account is private and the viewer has not
    been approved — see `search_users`.
    """

    user: User
    review_count: int | None


def _contains(column: InstrumentedAttribute[Any], query: str) -> sa.ColumnElement[bool]:
    """ILIKE '%q%', with the user's own wildcards escaped so '100%' isn't match-all."""
    escaped = query.replace("\\", "\\\\").replace("%", r"\%").replace("_", r"\_")
    return column.ilike(f"%{escaped}%", escape="\\")


# --- Games -----------------------------------------------------------------


async def search_games(
    db: AsyncSession,
    query: str,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[Game]:
    relevance = sa.func.similarity(Game.title, query)

    statement = (
        sa.select(Game, relevance)
        .where(_contains(Game.title, query))
        .options(selectinload(Game.genres), selectinload(Game.platforms))
    )

    return await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=relevance,
            id_column=Game.id,
            bind_type=sa.Float(),
            parse=float,
            descending=True,
        ),
        cursor=cursor,
        limit=limit,
    )


# --- Users -----------------------------------------------------------------


async def _visible_review_counts(
    db: AsyncSession, user_ids: Sequence[uuid.UUID], viewer_id: uuid.UUID | None
) -> dict[uuid.UUID, int]:
    """Review counts for the subset of `user_ids` whose stats the viewer may see.

    Users missing from the result are gated, which is what turns into a null
    `review_count` on the card. Batched over the whole page — one query, no N+1.
    """
    if not user_ids:
        return {}

    statement = (
        sa.select(User.id, sa.func.count(Review.id))
        .outerjoin(Review, Review.user_id == User.id)
        .where(User.id.in_(user_ids), content_is_visible_to(viewer_id))
        .group_by(User.id)
    )
    return {row[0]: row[1] for row in (await db.execute(statement)).all()}


async def search_users(
    db: AsyncSession,
    query: str,
    *,
    viewer_id: uuid.UUID | None = None,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[UserHit]:
    """Search handles and display names.

    Private accounts are returned — SPEC §6.7 keeps them findable, otherwise
    sending a follow request would be impossible — but everything behind the
    approval gate is withheld, leaving only the shell the card renders.
    """
    relevance = sa.func.greatest(
        sa.func.similarity(User.username, query),
        sa.func.coalesce(sa.func.similarity(User.display_name, query), 0.0) * DISPLAY_NAME_WEIGHT,
    )

    statement = sa.select(User, relevance).where(
        User.is_active.is_(True),
        sa.or_(_contains(User.username, query), _contains(User.display_name, query)),
    )

    page = await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=relevance,
            id_column=User.id,
            bind_type=sa.Float(),
            parse=float,
            descending=True,
        ),
        cursor=cursor,
        limit=limit,
    )

    counts = await _visible_review_counts(db, [user.id for user in page.items], viewer_id)
    return KeysetPage(
        items=[UserHit(user=user, review_count=counts.get(user.id)) for user in page.items],
        next_cursor=page.next_cursor,
    )
