"""Search endpoints — SPEC §6.6, §8.

Both are readable signed-out; the difference a token makes is what a *private*
account exposes to the caller (SPEC §6.7). Rate limited per SPEC §9, because
search is the cheapest endpoint to abuse for scraping the user directory.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Request, Response

from app.api.deps import DbSession, OptionalUser
from app.core.config import settings
from app.core.rate_limit import limiter
from app.schemas.game import GameSummary
from app.schemas.pagination import CursorPage
from app.schemas.search import SearchQuery, UserSearchResult
from app.services import search as search_service
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/search", tags=["search"])

Query_ = Annotated[SearchQuery, Query(alias="q", description="What the user typed")]
PageLimit = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Results per page")]
Cursor = Annotated[str | None, Query(description="From a previous page")]


@router.get(
    "/games",
    response_model=CursorPage[GameSummary],
    summary="Search games by title",
)
@limiter.limit(settings.rate_limit_search)
async def search_games(
    request: Request,
    # slowapi writes its X-RateLimit-* headers onto this and raises if a limited
    # endpoint does not declare one.
    response: Response,
    db: DbSession,
    q: Query_,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[GameSummary]:
    """Results carry cover art, release year and platforms, which is what SPEC
    §6.6 says a result card shows."""
    page = await search_service.search_games(db, q, cursor=cursor, limit=limit)
    return CursorPage(
        items=[GameSummary.model_validate(game) for game in page.items],
        next_cursor=page.next_cursor,
    )


@router.get(
    "/users",
    response_model=CursorPage[UserSearchResult],
    summary="Search users by handle or display name",
)
@limiter.limit(settings.rate_limit_search)
async def search_users(
    request: Request,
    response: Response,
    db: DbSession,
    viewer: OptionalUser,
    q: Query_,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[UserSearchResult]:
    """Private accounts appear as shells (SPEC §6.6, §6.7).

    They have to be findable — otherwise nobody could send a follow request —
    but `review_count` comes back null unless the viewer is the account itself
    or an approved follower.
    """
    page = await search_service.search_users(
        db, q, viewer_id=viewer.id if viewer else None, cursor=cursor, limit=limit
    )
    return CursorPage(
        items=[
            UserSearchResult(
                id=hit.user.id,
                username=hit.user.username,
                display_name=hit.user.display_name,
                avatar_url=hit.user.avatar_url,
                is_private=hit.user.is_private,
                review_count=hit.review_count,
            )
            for hit in page.items
        ],
        next_cursor=page.next_cursor,
    )
