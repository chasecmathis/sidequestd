"""Backlog list actions — SPEC §6.9, §8.

The *writes* live here at their own root, the way follow actions do: a backlog
action names a game, not a user, and `PUT /backlog/{game_id}` is the whole of
"add to a list" and "move between lists" at once. The *reads* are on the profile
they belong to — `GET /users/me/lists` and `GET /users/{id}/backlog` in
`app.api.v1.users` — because that is where the privacy gate already is.

Route order matters: `/order` is a literal path that `/{game_id}` would swallow.
It is declared first, which is the same reason `/users/me` precedes
`/users/{username}`.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Path, status

from app.api.deps import CurrentUser, DbSession
from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus
from app.schemas.backlog import (
    BacklogEntry,
    BacklogList,
    BacklogLists,
    BacklogReorder,
    BacklogStatusUpdate,
)
from app.services import backlog as backlog_service

router = APIRouter(prefix="/backlog", tags=["backlog"])

GameId = Annotated[uuid.UUID, Path(description="Catalog id of the game")]


def entry_payload(item: BacklogItem) -> BacklogEntry:
    return BacklogEntry.model_validate(item)


def lists_payload(
    items: Sequence[BacklogItem], *, only: BacklogStatus | None = None
) -> BacklogLists:
    """Group a flat, already-ordered backlog into its lists.

    All four by default, empty ones included, so a profile can draw four headings
    without asking whether each came back; `only` narrows it to the one list a
    `?status=` asked for. `list_items` returns rows ordered by status then
    position, so this is a bucket-fill rather than a sort.
    """
    wanted = (only,) if only is not None else backlog_service.LIST_ORDER
    grouped: dict[BacklogStatus, list[BacklogEntry]] = {value: [] for value in wanted}
    for item in items:
        bucket = grouped.get(item.status)
        if bucket is not None:
            bucket.append(entry_payload(item))

    return BacklogLists(lists=[BacklogList(status=value, items=grouped[value]) for value in wanted])


@router.put(
    "/order",
    response_model=BacklogList,
    summary="Reorder one of your lists",
    responses={400: {"description": "Not a permutation of that list"}},
)
async def reorder_list(
    db: DbSession, current_user: CurrentUser, payload: BacklogReorder
) -> BacklogList:
    """SPEC §6.9. The body must name exactly the games currently on that list.

    Returns the list it rewrote, so the client renders the order the server
    actually stored rather than the one it hoped for.
    """
    items = await backlog_service.reorder(db, current_user, payload.status, payload.game_ids)
    return BacklogList(status=payload.status, items=[entry_payload(item) for item in items])


@router.put(
    "/{game_id}",
    response_model=BacklogEntry,
    summary="Put a game on a list, or move it to another one",
    responses={404: {"description": "No such game in the catalog"}},
)
async def set_backlog_status(
    db: DbSession,
    current_user: CurrentUser,
    game_id: GameId,
    payload: BacklogStatusUpdate,
) -> BacklogEntry:
    """SPEC §6.9, an upsert.

    PUT rather than POST because it is idempotent and the caller names the id:
    sending the same status twice leaves one row in one place, and — because
    `status_changed_at` does not move for a no-op — does not tell the owner's
    followers about it twice either.
    """
    item = await backlog_service.set_status(db, current_user, game_id, payload.status)
    return entry_payload(item)


@router.delete(
    "/{game_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Take a game off your backlog",
    responses={404: {"description": "That game is on none of your lists"}},
)
async def remove_from_backlog(db: DbSession, current_user: CurrentUser, game_id: GameId) -> None:
    await backlog_service.remove(db, current_user, game_id)
