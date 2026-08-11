"""Backlog lists (SPEC §6.9, §8).

The four lists are one table, so the wire shape is one entry type grouped by
status rather than four different payloads. `BacklogLists` returns every status
the caller asked about — all four by default — including the empty ones, because
a profile draws four headings whether or not there is anything under them, and a
client that has to tell "absent" apart from "empty" will eventually get it wrong.

Deliberately not a `CursorPage`: the grouped shape has no single ordering to
cursor over, and a reorder has to name the whole list anyway (see
`BacklogReorder`), so paging one would break the operation it exists to support.
A backlog is human-scale. If that stops being true it needs paging per status,
which is an additive endpoint rather than a change to this one.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import BacklogStatus
from app.schemas.game import GameSummary


class BacklogEntry(BaseModel):
    """One game on one of the four lists."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    game: GameSummary
    status: BacklogStatus
    position: int = Field(description="0-based, dense within the status")
    created_at: datetime = Field(description="When the game first joined the backlog")
    status_changed_at: datetime = Field(
        description="When it last moved lists. This is what the Home feed's "
        "activity events are ordered by (SPEC §6.11)."
    )


class BacklogList(BaseModel):
    """One status and everything on it, in the owner's order."""

    status: BacklogStatus
    items: list[BacklogEntry]


class BacklogLists(BaseModel):
    """A whole backlog, or the single list a `?status=` narrowed it to."""

    lists: list[BacklogList] = Field(
        description="All four statuses in SPEC §6.9's order unless one was asked "
        "for by name, in which case exactly that one."
    )


class BacklogStatusUpdate(BaseModel):
    """The body of `PUT /backlog/{game_id}` — where the game should end up.

    One field, because that is the whole operation: SPEC §6.9 says a game holds
    at most one status, so setting it is both "add to a list" and "move between
    lists" and the caller does not have to know which one they are doing.
    """

    model_config = ConfigDict(extra="forbid")

    status: BacklogStatus


class BacklogReorder(BaseModel):
    """A permutation of one list — see `InvalidBacklogOrderError`."""

    model_config = ConfigDict(extra="forbid")

    status: BacklogStatus = Field(description="Which list is being reordered")
    game_ids: list[uuid.UUID] = Field(
        description="Every game currently on that list, in the new order"
    )
