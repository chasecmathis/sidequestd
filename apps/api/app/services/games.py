"""Games catalog reads — browse, filter, sort, detail (SPEC §6.5, §8).

Every list here is keyset-paginated through `app.services.pagination`; see that
module for why the orderings all end in the row id.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.game import Game, Genre, Platform, TrendingScore
from app.schemas.game import GameSort, TrendingWindow
from app.services import recommendations
from app.services.exceptions import GameNotFoundError
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    SortExpression,
    fetch_keyset_page,
)
from app.services.trending import DEFAULT_TRENDING_WINDOW

# release_date is nullable and a NULL sort key would break the keyset comparison,
# so undated entries are coalesced to a sentinel that sorts last newest-first.
UNDATED = date(1, 1, 1)

# How many rows each Discover section shows before "see all" takes over.
DISCOVER_SECTION_SIZE = 12


@dataclass(frozen=True, slots=True)
class _SortSpec:
    expression: SortExpression
    bind_type: sa.types.TypeEngine[Any]
    parse: Callable[[str], Any]
    descending: bool
    joins_trending: bool = False


def _spec_for(sort: GameSort) -> _SortSpec:
    match sort:
        case GameSort.TITLE:
            return _SortSpec(Game.title, sa.String(), str, descending=False)
        case GameSort.RELEASE_DATE:
            return _SortSpec(
                sa.func.coalesce(Game.release_date, UNDATED),
                sa.Date(),
                date.fromisoformat,
                descending=True,
            )
        case GameSort.TRENDING:
            return _SortSpec(
                sa.func.coalesce(TrendingScore.score, 0.0),
                sa.Float(),
                float,
                descending=True,
                joins_trending=True,
            )


def _with_related[SelectT: sa.Select[Any]](statement: SelectT) -> SelectT:
    """Eager-load the M2M sides so a page costs three queries, not 2N (SPEC §9)."""
    return statement.options(selectinload(Game.genres), selectinload(Game.platforms))


async def list_games(
    db: AsyncSession,
    *,
    genres: Sequence[str] | None = None,
    platforms: Sequence[str] | None = None,
    sort: GameSort = GameSort.TITLE,
    window: TrendingWindow = DEFAULT_TRENDING_WINDOW,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[Game]:
    """Browse the catalog.

    Slugs within one facet are OR-ed (any of these genres) and the facets are
    AND-ed (that genre *and* that platform), which is how a faceted browse UI
    reads to a user ticking boxes.
    """
    spec = _spec_for(sort)
    statement = _with_related(sa.select(Game, spec.expression))

    if spec.joins_trending:
        statement = statement.outerjoin(
            TrendingScore,
            sa.and_(TrendingScore.game_id == Game.id, TrendingScore.window == window),
        )
    if genres:
        statement = statement.where(Game.genres.any(Genre.slug.in_(genres)))
    if platforms:
        statement = statement.where(Game.platforms.any(Platform.slug.in_(platforms)))

    return await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=spec.expression,
            id_column=Game.id,
            bind_type=spec.bind_type,
            parse=spec.parse,
            descending=spec.descending,
        ),
        cursor=cursor,
        limit=limit,
    )


async def get_game(db: AsyncSession, game_id: uuid.UUID) -> Game:
    result = await db.execute(_with_related(sa.select(Game)).where(Game.id == game_id))
    game = result.scalar_one_or_none()
    if game is None:
        raise GameNotFoundError
    return game


async def list_genres(db: AsyncSession) -> Sequence[Genre]:
    return (await db.execute(sa.select(Genre).order_by(Genre.name))).scalars().all()


async def list_platforms(db: AsyncSession) -> Sequence[Platform]:
    return (await db.execute(sa.select(Platform).order_by(Platform.name))).scalars().all()


async def list_new_releases(
    db: AsyncSession, *, limit: int = DISCOVER_SECTION_SIZE
) -> Sequence[Game]:
    """Most recently released games that have a release date at all."""
    statement = (
        _with_related(sa.select(Game))
        .where(Game.release_date.is_not(None))
        .order_by(Game.release_date.desc(), Game.id.desc())
        .limit(limit)
    )
    return (await db.execute(statement)).scalars().all()


async def list_recommended(
    db: AsyncSession, user_id: uuid.UUID | None, *, limit: int = DISCOVER_SECTION_SIZE
) -> Sequence[Game]:
    """Personalised recommendations — SPEC §6.5.

    The ranking itself lives in `app.services.recommendations`, which the feed
    blend also reads. This stays the door the catalog is asked through, so
    `/games/discover` never had to learn that a recommendation is a different
    kind of question from a browse — but the scoring does not belong to a module
    about listing and filtering a catalog, and a second copy of it inside the
    feed is the one way Discover and Home could start disagreeing about what the
    viewer likes.
    """
    return await recommendations.recommend_games(db, user_id, limit=limit)
