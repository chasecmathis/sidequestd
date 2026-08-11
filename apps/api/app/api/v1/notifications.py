"""The Notifications tab — SPEC §6.12, §8.

Every endpoint here is about the caller's own inbox and nobody else's, which is
why none of them take a user id: there is no notification of yours that anybody
else is entitled to read, so an id in the path would only be an opportunity to
get the authorisation wrong. `CurrentUser` is the whole of the access rule.

There is no `POST /notifications` and no way to create one from outside — a
notification is a consequence of an action, so it is written by whichever service
performed that action, through `app.services.notifications.emit`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.models.notification import Notification
from app.schemas.notification import (
    NotificationItem,
    NotificationReadRequest,
    NotificationReadResult,
    UnreadCount,
)
from app.schemas.pagination import CursorPage
from app.services import notifications as notifications_service
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(prefix="/notifications", tags=["notifications"])

PageLimit = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Results per page")]
Cursor = Annotated[str | None, Query(description="From a previous page")]


def notification_payload(notification: Notification) -> NotificationItem:
    return NotificationItem.model_validate(notification)


@router.get(
    "",
    response_model=CursorPage[NotificationItem],
    summary="Your notifications, newest first",
)
async def read_notifications(
    db: DbSession,
    current_user: CurrentUser,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[NotificationItem]:
    """SPEC §6.12. Read and unread in one list, with `is_read` on each row.

    Not two endpoints and not a `?unread=` filter: the tab shows a history in
    which the unread ones are highlighted, and reading it does not mark anything
    — that is `POST /notifications/read`, so the client decides whether opening
    the tab counts as reading everything in it.

    Each row arrives with its actor and its target already attached, so a page is
    a fixed number of queries however many rows it holds.
    """
    page = await notifications_service.list_for(db, current_user, cursor=cursor, limit=limit)
    return CursorPage(
        items=[notification_payload(item) for item in page.items],
        next_cursor=page.next_cursor,
    )


@router.get(
    "/unread-count",
    response_model=UnreadCount,
    summary="How many are unread",
)
async def read_unread_count(db: DbSession, current_user: CurrentUser) -> UnreadCount:
    """The badge on the tab (SPEC §6.12).

    Separate from the list because it is polled from every screen and the list is
    not. Delivery in this slice is in-app only — no websocket, no push — so the
    badge is only ever as fresh as the last poll, which is the trade SPEC §6.12
    makes by naming push as post-MVP.
    """
    return UnreadCount(count=await notifications_service.unread_count(db, current_user))


@router.post(
    "/read",
    response_model=NotificationReadResult,
    summary="Mark notifications read",
)
async def mark_notifications_read(
    db: DbSession, current_user: CurrentUser, payload: NotificationReadRequest
) -> NotificationReadResult:
    """SPEC §6.12's mark-as-read, individually or all at once.

    One endpoint for both because they are one statement with one extra WHERE.
    Always a 200: ids that are already read, do not exist, or belong to somebody
    else are counted as zero rather than refused, so a client that presses the
    button twice does not get an error the second time, and nobody learns whether
    a notification id they guessed is real.
    """
    marked = await notifications_service.mark_read(db, current_user, ids=payload.ids)
    return NotificationReadResult(
        marked=marked, unread_count=await notifications_service.unread_count(db, current_user)
    )
