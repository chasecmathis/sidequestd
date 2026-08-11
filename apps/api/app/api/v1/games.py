"""Games catalog endpoints — SPEC §6.5, §8.

The catalog is public: a game is not user content, so nothing here is gated. The
viewer is still resolved where it exists, because Discover personalises for
whoever is reading it — and falls back to what is popular for whoever is not.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.api.deps import DbSession, OptionalUser
from app.models.game import Game
from app.schemas.game import (
    DiscoverResponse,
    GameDetail,
    GameSort,
    GameSummary,
    GenreRef,
    PlatformRef,
    TrendingGame,
    TrendingWindow,
)
from app.schemas.pagination import CursorPage
from app.services import games as games_service
from app.services import trending as trending_service
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/games", tags=["games"])

PageLimit = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Results per page")]
Window = Annotated[TrendingWindow, Query(description="Rolling window the ranking covers")]


def trending_payload(rows: list[tuple[Game, float]], window: TrendingWindow) -> list[TrendingGame]:
    """Shared with the feed router, whose empty state offers the same ranking."""
    return [
        TrendingGame(game=GameSummary.model_validate(game), score=score, window=window)
        for game, score in rows
    ]


@router.get(
    "",
    response_model=CursorPage[GameSummary],
    summary="Browse the catalog",
)
async def browse_games(
    db: DbSession,
    genre: Annotated[list[str] | None, Query(description="Genre slug. Repeat for any-of.")] = None,
    platform: Annotated[
        list[str] | None, Query(description="Platform slug. Repeat for any-of.")
    ] = None,
    sort: Annotated[GameSort, Query(description="Result ordering")] = GameSort.TITLE,
    window: Window = trending_service.DEFAULT_TRENDING_WINDOW,
    cursor: Annotated[str | None, Query(description="From a previous page")] = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[GameSummary]:
    """Filter by genre and/or platform (SPEC §6.5 Browse).

    Repeated values within a facet are OR-ed and the facets are AND-ed, so
    `?genre=indie&genre=puzzle&platform=nintendo-switch` reads as "indie or
    puzzle, on Switch".
    """
    page = await games_service.list_games(
        db,
        genres=genre,
        platforms=platform,
        sort=sort,
        window=window,
        cursor=cursor,
        limit=limit,
    )
    return CursorPage(
        items=[GameSummary.model_validate(game) for game in page.items],
        next_cursor=page.next_cursor,
    )


@router.get("/genres", response_model=list[GenreRef], summary="Every genre in the catalog")
async def list_genres(db: DbSession) -> list[GenreRef]:
    return [GenreRef.model_validate(genre) for genre in await games_service.list_genres(db)]


@router.get("/platforms", response_model=list[PlatformRef], summary="Every platform")
async def list_platforms(db: DbSession) -> list[PlatformRef]:
    return [
        PlatformRef.model_validate(platform) for platform in await games_service.list_platforms(db)
    ]


@router.get(
    "/trending",
    response_model=list[TrendingGame],
    summary="Trending games for a rolling window",
)
async def trending_games(
    db: DbSession,
    window: Window = trending_service.DEFAULT_TRENDING_WINDOW,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> list[TrendingGame]:
    """Reads the ranking materialised by `python -m app.cli.trending`.

    Empty until that has run against some activity — the endpoint does not fall
    back to an arbitrary list, because a made-up "trending" is worse than none.
    """
    rows = await trending_service.list_trending(db, window=window, limit=limit)
    return trending_payload(list(rows), window)


@router.get(
    "/discover",
    response_model=DiscoverResponse,
    summary="The Discover tab's sections in one call",
)
async def discover(
    db: DbSession,
    viewer: OptionalUser,
    window: Window = trending_service.DEFAULT_TRENDING_WINDOW,
) -> DiscoverResponse:
    """One round trip for the whole tab (SPEC §6.5).

    `recommended` is personal to the caller: their favourite genres and the
    genres of what they rated well, blended with what the people who rate like
    them rated well, minus everything they have already reviewed, listed or
    pinned. A caller we know nothing about — signed out, or signed in and new —
    gets what is trending and what has always been popular instead, so the
    section is never an error and never a lie about being tailored.
    """
    section = games_service.DISCOVER_SECTION_SIZE
    trending = await trending_service.list_trending(db, window=window, limit=section)
    new_releases = await games_service.list_new_releases(db, limit=section)
    recommended = await games_service.list_recommended(
        db, viewer.id if viewer else None, limit=section
    )

    return DiscoverResponse(
        trending=trending_payload(list(trending), window),
        new_releases=[GameSummary.model_validate(game) for game in new_releases],
        recommended=[GameSummary.model_validate(game) for game in recommended],
        genres=[GenreRef.model_validate(genre) for genre in await games_service.list_genres(db)],
        platforms=[
            PlatformRef.model_validate(platform)
            for platform in await games_service.list_platforms(db)
        ],
    )


@router.get(
    "/{game_id}",
    response_model=GameDetail,
    summary="Full detail for one game",
    responses={404: {"description": "No such game"}},
)
async def read_game(
    db: DbSession,
    game_id: Annotated[uuid.UUID, Path(description="Catalog id")],
) -> GameDetail:
    """Declared last on purpose: `/games/trending` and friends are literal paths
    that would otherwise be swallowed by this one."""
    return GameDetail.model_validate(await games_service.get_game(db, game_id))
