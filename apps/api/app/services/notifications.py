"""In-app notifications (SPEC §6.12, §8).

`emit` is the only way a notification is ever created. Every producer — a follow
in `app.services.social`, a like or a comment in `app.services.interactions`, a
review of a backlogged game in `app.services.reviews` — calls it and knows
nothing else about notifications. That was true while this function only logged,
which is why filling in its body was the whole of the write side: no producer
moved, and none of them can quietly grow a second way to notify someone.

Two properties are load-bearing and easy to break:

* **It writes, it does not commit.** `emit` adds the row to the caller's session
  and returns. The notification therefore lands in the same transaction as the
  action that caused it, so an action that rolls back cannot leave behind a
  notification about something that never happened. A caller that committed here
  instead would also end the caller's own transaction underneath it.
* **Nobody is notified about themselves.** The producers already check, because
  most of them have to for other reasons, but the guard lives here as well: it is
  one comparison, and "you liked your own review" is the kind of thing that
  reappears the first time somebody adds a producer without reading the others.

In-app, the row *is* the delivery: the client reads it from `GET /notifications`
and there is no fan-out worker. Push arrived behind this same function, exactly
where the previous version of this docstring said it belonged — `emit` records
the intent, and the hook at the foot of this module hands it to
`app.services.push` **after the caller's transaction commits**, which is the only
point at which the notification is a fact rather than a maybe.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Sequence
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus, FollowStatus, NotificationType
from app.models.game import Game
from app.models.notification import Notification
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User
from app.services import push as push_service
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    fetch_keyset_page,
)

logger = logging.getLogger(__name__)

# The actor is a `UserPublic` shell, and the target is only ever rendered as the
# sentence's object — "your review of *Hades*", "your comment" — so the game
# comes along and the review's own author does not: it is the recipient on every
# type that carries one.
_LOADERS = (
    selectinload(Notification.actor),
    selectinload(Notification.review).selectinload(Review.game).selectinload(Game.platforms),
    selectinload(Notification.comment),
)

# Newest first, tie-broken by id — the same shape as every other paged surface,
# so a cursor here means what a cursor means everywhere else.
NEWEST_FIRST = KeysetSort(
    expression=Notification.created_at,
    id_column=Notification.id,
    bind_type=sa.DateTime(timezone=True),
    parse=datetime.fromisoformat,
    descending=True,
)


# --- Writing ----------------------------------------------------------------


async def emit(
    db: AsyncSession,
    *,
    recipient_id: uuid.UUID,
    actor_id: uuid.UUID,
    type: NotificationType,
    review_id: uuid.UUID | None = None,
    comment_id: uuid.UUID | None = None,
) -> None:
    """Record that `actor_id` did something `recipient_id` should hear about.

    `review_id` and `comment_id` are the deep-link targets from SPEC §7. Which
    one a type carries is the producer's business — a like has a review, a reply
    has both, a follow has neither — and they are optional here rather than a
    per-type argument list because the alternative is one `emit` per type, which
    is the thing this function exists instead of.

    Pass a target whenever there is one, even when the sentence would read
    without it: the client turns the notification into a link, and one without a
    target is a row the reader cannot act on.
    """
    if recipient_id == actor_id:
        return

    notification = Notification(
        # Assigned here rather than left to the column default, which only runs
        # at flush. The push hook needs a handle on this row *now* — it is
        # scheduled from the commit, by which point the object may be expired,
        # and flushing here to learn the id would put a round trip inside a
        # function whose whole contract is that it only adds to the session.
        id=uuid.uuid4(),
        recipient_id=recipient_id,
        actor_id=actor_id,
        type=type,
        review_id=review_id,
        comment_id=comment_id,
    )
    db.add(notification)
    _queue_push(db, notification.id)


# --- Reading (SPEC §6.12) ---------------------------------------------------


async def list_for(
    db: AsyncSession,
    user: User,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[Notification]:
    """One page of somebody's own notifications, newest first.

    Scoped to `user` by the WHERE rather than checked afterwards, so there is no
    path through this function that returns somebody else's row. Read and unread
    are one list — SPEC §6.12 asks for read *state*, not two tabs — and the
    client styles the unread ones.
    """
    statement = (
        sa.select(Notification, Notification.created_at)
        .where(Notification.recipient_id == user.id)
        .options(*_LOADERS)
    )
    return await fetch_keyset_page(db, statement, NEWEST_FIRST, cursor=cursor, limit=limit)


async def unread_count(db: AsyncSession, user: User) -> int:
    """What the badge on the tab shows (SPEC §6.12).

    Its own endpoint rather than a field on the list, because the badge is
    polled on every screen and a count is a great deal cheaper than a page. The
    partial index on `(recipient_id) WHERE is_read = false` is what makes it so.
    """
    total = await db.scalar(
        sa.select(sa.func.count())
        .select_from(Notification)
        .where(Notification.recipient_id == user.id, Notification.is_read.is_(False))
    )
    return total or 0


async def mark_read(db: AsyncSession, user: User, *, ids: Sequence[uuid.UUID] | None = None) -> int:
    """Mark some notifications read, or all of them. Returns how many changed.

    `ids=None` means the whole inbox — the "mark all as read" from SPEC §6.12 —
    and an *empty* sequence means nothing, which is the safer reading of the two:
    a client that meant "these" and computed an empty list gets a no-op instead
    of silently clearing the badge.

    Ownership is the WHERE clause again. Naming a stranger's notification id
    matches no row and is reported as zero rather than as a 403, because a 403
    would confirm that the id exists and who it belongs to.

    Already-read rows are excluded so the return value is the number of rows that
    actually *changed*, which is what the client needs to move its badge.
    """
    if ids is not None and not ids:
        return 0

    statement = sa.update(Notification).where(
        Notification.recipient_id == user.id, Notification.is_read.is_(False)
    )
    if ids is not None:
        statement = statement.where(Notification.id.in_(ids))

    # RETURNING rather than `rowcount`: one statement either way, and the rows it
    # names are the rows it changed, which is a stronger thing to count than a
    # driver-reported total.
    changed = (await db.scalars(statement.values(is_read=True).returning(Notification.id))).all()
    await db.commit()
    return len(changed)


# --- Producers' helpers -----------------------------------------------------


async def backlog_reviewers_of(
    db: AsyncSession, *, author_id: uuid.UUID, game_id: uuid.UUID
) -> Sequence[uuid.UUID]:
    """Who should hear that `author_id` reviewed `game_id` (SPEC §6.12).

    "Someone you follow reviewed a game you have in your backlog", so a recipient
    is anyone with an ACCEPTED edge *to* the author who is also holding that game
    on a list they have not finished with. It lives here rather than in
    `app.services.reviews` because it is the recipient list of a notification,
    and reviews should not have to know how one is addressed.

    Deliberately narrowed to To Be Played and Playing. The point of the
    notification is that a review helps you decide what to play next, which is
    not a question you have about a game you already finished or gave up on —
    and `app.services.users.profile_stats` already reads "backlog" in SPEC's
    sense as the unplayed lists.
    """
    rows = await db.scalars(
        sa.select(BacklogItem.user_id)
        .join(Follow, Follow.follower_id == BacklogItem.user_id)
        .join(User, User.id == BacklogItem.user_id)
        .where(
            BacklogItem.game_id == game_id,
            BacklogItem.status.in_((BacklogStatus.TO_BE_PLAYED, BacklogStatus.PLAYING)),
            Follow.followee_id == author_id,
            Follow.status == FollowStatus.ACCEPTED,
            User.is_active.is_(True),
        )
    )
    return list(rows)


# --- Push, after the commit (SPEC §6.12) ------------------------------------
#
# `emit` writes and does not commit, which is the property the module docstring
# opens with — so it also cannot *send*. A push posted from inside the producer's
# transaction is a notification on somebody's lock screen about a like that then
# rolled back, and unlike a database row a push cannot be taken back.
#
# So `emit` records an intention on the session and this pair of listeners acts
# on it: dispatch when that session commits, discard when it rolls back. It is
# the SQLAlchemy answer to the problem and it means no producer moved — a like,
# a follow and a comment still know nothing about notifications beyond the one
# function they call.
#
# What this is *not* is a durable outbox. A process that dies between the commit
# and the send loses that push and nothing else, which is a trade the module
# docstring of `app.services.push` argues in full: the notification is already
# recorded, the inbox already shows it, and the badge poll already corrects
# itself. Delivery is a nudge toward state that is true either way.

_PENDING_KEY = "pending_push_notification_ids"

# asyncio holds only a weak reference to a bare task, so a fire-and-forget one
# can be garbage collected mid-flight. Holding them here until they finish is
# the documented way round it.
_IN_FLIGHT: set[asyncio.Task[None]] = set()


def _queue_push(db: AsyncSession, notification_id: uuid.UUID) -> None:
    """Note that this notification should be pushed if the transaction lands."""
    db.info.setdefault(_PENDING_KEY, []).append(notification_id)


@sa.event.listens_for(Session, "after_commit")
def _dispatch_pending_pushes(session: Session) -> None:
    """Hand everything this transaction emitted to the push service.

    Listens on the *sync* `Session` because that is the object SQLAlchemy's ORM
    events fire on; `AsyncSession.info` is a proxy to this one's, so what `emit`
    put there is what is drained here.

    The handler is synchronous and the send is not, so the work is scheduled on
    the running loop rather than awaited — the greenlet this runs in belongs to
    that loop, so it is there to be found. When it is not (a synchronous script,
    a migration, a test harness driving a sync session) the pushes are dropped
    with a line in the log rather than raising, because a commit must not fail
    over a notification that has already been written.
    """
    pending: list[uuid.UUID] = session.info.pop(_PENDING_KEY, [])
    if not pending or not settings.push_enabled:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.debug("No running loop; %d push(es) not dispatched", len(pending))
        return

    task = loop.create_task(push_service.deliver(pending))
    _IN_FLIGHT.add(task)
    task.add_done_callback(_IN_FLIGHT.discard)


@sa.event.listens_for(Session, "after_rollback")
@sa.event.listens_for(Session, "after_soft_rollback")
def _drop_pending_pushes(session: Session, *_: object) -> None:
    """The action did not happen, so neither did the notification about it."""
    session.info.pop(_PENDING_KEY, None)
