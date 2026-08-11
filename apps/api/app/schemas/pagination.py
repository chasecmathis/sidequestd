"""Cursor-paginated envelope shared by every list endpoint (SPEC §9)."""

from __future__ import annotations

from pydantic import BaseModel, Field


class CursorPage[T](BaseModel):
    """One page of results plus the cursor that fetches the next one.

    `next_cursor` is opaque: pass it back verbatim as `?cursor=`. It is absent on
    the last page, which is how a client knows to stop.
    """

    items: list[T]
    next_cursor: str | None = Field(
        default=None, description="Pass as ?cursor= for the next page; null when exhausted."
    )
