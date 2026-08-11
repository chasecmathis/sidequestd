"""Keyset ("seek") pagination shared by the catalog and search endpoints.

SPEC §9 asks for cursor pagination rather than OFFSET, so a page is fetched by
comparing against the last row's sort key instead of counting past rows. Every
ordering here is made *total* by appending the row id, which keeps the comparison
unambiguous when the sort key ties — without that, rows can be skipped or
repeated between pages.

Cursors are opaque to clients: base64url of `[sort_key, id]`. They carry no
authorisation, so they are safe to hand out, but callers must still apply the
same filters on the follow-up request.
"""

from __future__ import annotations

import base64
import binascii
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Protocol

import sqlalchemy as sa
from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.services.exceptions import InvalidCursorError

# Mapped attributes (`Game.title`) and built expressions (`func.coalesce(...)`)
# are both valid orderings, and SQLAlchemy's stubs do not give them a common
# base, so the alias spells out that either is accepted.
SortExpression = sa.ColumnElement[Any] | InstrumentedAttribute[Any]


class HasUuidId(Protocol):
    """Every entity a page is *fetched* over carries the id used as the tiebreaker."""

    @property
    def id(self) -> uuid.UUID: ...


DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 50


@dataclass(frozen=True, slots=True)
class Cursor:
    key: str
    id: uuid.UUID


def encode_cursor(key: object, row_id: uuid.UUID) -> str:
    payload = json.dumps([str(key), str(row_id)], separators=(",", ":")).encode()
    # Padding is stripped so the cursor survives a URL query string untouched.
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(raw: str) -> Cursor:
    try:
        padded = raw + "=" * (-len(raw) % 4)
        key, row_id = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, binascii.Error, TypeError) as exc:
        raise InvalidCursorError from exc

    if not isinstance(key, str) or not isinstance(row_id, str):
        raise InvalidCursorError
    try:
        return Cursor(key=key, id=uuid.UUID(row_id))
    except ValueError as exc:
        raise InvalidCursorError from exc


@dataclass(frozen=True, slots=True)
class KeysetSort:
    """A total ordering over a query, plus how to round-trip its cursor.

    `expression` must never evaluate to NULL — wrap nullable columns in COALESCE
    — because NULL breaks the row-value comparison the keyset relies on.
    """

    expression: SortExpression
    id_column: SortExpression
    bind_type: sa.types.TypeEngine[Any]
    parse: Callable[[str], Any]
    descending: bool = True


@dataclass(frozen=True, slots=True)
class KeysetPage[ItemT]:
    """Unbound on purpose: a page may hold a mapped entity or a wrapper built
    from one (see `UserHit` in app.services.search)."""

    items: list[ItemT]
    next_cursor: str | None


async def _window(
    db: AsyncSession,
    statement: Select[Any],
    sort: KeysetSort,
    *,
    cursor: str | None,
    limit: int,
) -> tuple[list[sa.Row[Any]], bool]:
    """Seek past the cursor, impose the total ordering, and read one page.

    One extra row is fetched to decide whether a next cursor exists, so the last
    page reports `next_cursor is None` without a second round trip. Returns the
    page and whether anything follows it; who owns the id in each row is the
    caller's business.
    """
    if cursor is not None:
        position = decode_cursor(cursor)
        try:
            key = sort.parse(position.key)
        except ValueError as exc:
            raise InvalidCursorError from exc

        current = sa.tuple_(sort.expression, sort.id_column)
        seen = sa.tuple_(
            sa.literal(key, type_=sort.bind_type),
            sa.literal(position.id, type_=sa.Uuid),
        )
        statement = statement.where(current < seen if sort.descending else current > seen)

    direction = sa.desc if sort.descending else sa.asc
    statement = statement.order_by(direction(sort.expression), direction(sort.id_column))

    rows = (await db.execute(statement.limit(limit + 1))).all()
    return list(rows[:limit]), len(rows) > limit


async def fetch_keyset_page[T: HasUuidId](
    db: AsyncSession,
    statement: Select[tuple[T, Any]],
    sort: KeysetSort,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[T]:
    """Run `statement` (which must select the entity plus its sort key) as a page."""
    page, has_more = await _window(db, statement, sort, cursor=cursor, limit=limit)

    next_cursor = None
    if has_more and page:
        last = page[-1]
        next_cursor = encode_cursor(last[1], last[0].id)

    return KeysetPage(items=[row[0] for row in page], next_cursor=next_cursor)


async def fetch_keyset_keys(
    db: AsyncSession,
    statement: Select[tuple[uuid.UUID, Any]],
    sort: KeysetSort,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[sa.Row[Any]]:
    """The same window over a statement that selects a bare id and sort key.

    For orderings that span more than one table. The Home feed interleaves
    reviews and backlog activity (SPEC §6.4, §6.11), which is a UNION of two
    queries with no entity to hang an id on, so it pages the *keys* here and
    loads each kind afterwards. Everything about the cursor — the seek, the
    tiebreaker, the extra row — is shared with `fetch_keyset_page`, which is the
    point: two paginators would eventually disagree about what a cursor means.

    Rows carry whatever else the statement selected, in order; the caller is what
    knows their names.
    """
    page, has_more = await _window(db, statement, sort, cursor=cursor, limit=limit)

    next_cursor = None
    if has_more and page:
        last = page[-1]
        next_cursor = encode_cursor(last[1], last[0])

    return KeysetPage(items=page, next_cursor=next_cursor)
