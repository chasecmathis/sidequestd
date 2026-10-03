"""Push delivery, over the Expo push service (SPEC §6.12).

In-app notifications are a row in a table the client reads. A push is the same
notification carried to a phone that is not running the app, and everything
awkward about this module follows from that one difference:

* **The server has to write the sentence.** In-app, the API sends the parts —
  who, what happened, what to — and `packages/core/src/notifications.ts` composes
  the words, which is what lets the wording change without an API deploy. On a
  lock screen the renderer is the operating system, so the words have to be in
  the payload. `_PHRASES` below is therefore a second copy of a thing that has a
  first copy, and the two are cross-referenced in both directions. They are
  allowed to differ in *register* — a push is read at a glance and quotes the
  comment, a list row does not — but never in meaning.
* **Nothing here may raise into a producer.** A like is not less liked because a
  phone could not be reached. Every failure is logged and swallowed, which is
  the same call `app.services.steam.sync_library_in_background` makes.
* **Dead addresses have to be swept.** `DeviceNotRegistered` from a send is the
  only signal `device_tokens` ever gets that a row is rubbish, so it is acted on
  rather than logged.

Delivery is scheduled after the producer's transaction commits — see the hook at
the foot of `app.services.notifications`. It is not a queue: there is no retry
and no durable outbox, because a push is a *nudge* toward state that is already
recorded and readable. If it is lost, the badge poll and the inbox both still
tell the truth, which is exactly why it was safe to build this before a job
runner exists.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

import httpx
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.device import DeviceToken
from app.models.enums import NotificationType
from app.models.notification import Notification
from app.models.review import Review
from app.services import devices as devices_service

logger = logging.getLogger(__name__)

# Expo accepts at most 100 messages per request and rejects the whole batch if
# there are more, so a fan-out to a popular reviewer's followers is chunked
# rather than truncated.
MAX_MESSAGES_PER_REQUEST = 100

# The Android channel the client creates on first launch. Named in the payload
# because Android 8+ drops a notification whose channel does not exist, and the
# default channel a bare token would land on has no sound and no heads-up
# behaviour.
ANDROID_CHANNEL_ID = "default"

# What a notification body is cut to. The OS truncates anyway — this is so the
# cut happens on a word and with an ellipsis rather than mid-syllable.
_BODY_MAX = 140


@dataclass(frozen=True)
class PushMessage:
    """One Expo push message, in the shape their API takes."""

    to: str
    title: str
    body: str
    # The unread count *after* this notification, so a phone that never opens
    # the app still shows the right number on the icon. This is the whole of
    # "the badge updates from a background push".
    badge: int
    data: dict[str, Any] = field(default_factory=dict)

    def as_payload(self) -> dict[str, Any]:
        return {
            "to": self.to,
            "title": self.title,
            "body": self.body,
            "badge": self.badge,
            "sound": "default",
            "channelId": ANDROID_CHANNEL_ID,
            "data": self.data,
        }


# --- Wording ----------------------------------------------------------------

# The twin of `PHRASES` in packages/core/src/notifications.ts. Same clauses, and
# for the same reason they are whole clauses there: "replied to your comment"
# has no object to template, so a verb-plus-noun scheme breaks on it.
#
# Change one, change the other. A test pins every member of the enum so a new
# notification type cannot ship with a `None` body.
_PHRASES: dict[NotificationType, str] = {
    NotificationType.NEW_FOLLOWER: "started following you",
    NotificationType.FOLLOW_REQUEST: "asked to follow you",
    NotificationType.FOLLOW_REQUEST_APPROVED: "approved your follow request",
    NotificationType.REVIEW_LIKED: "liked your review",
    NotificationType.REVIEW_COMMENTED: "commented on your review",
    NotificationType.COMMENT_REPLIED: "replied to your comment",
    NotificationType.BACKLOG_GAME_REVIEWED: "reviewed a game on your list",
}

# The same clauses again with the game in them. Kept as a second table rather
# than as a format string with an optional slot, because the two readings are
# not the same sentence with a hole in it — "reviewed a game on your list"
# becomes "reviewed *Hades*, which is on your list", and no template does that.
_PHRASES_WITH_GAME: dict[NotificationType, str] = {
    NotificationType.REVIEW_LIKED: "liked your review of {game}",
    NotificationType.REVIEW_COMMENTED: "commented on your review of {game}",
    NotificationType.BACKLOG_GAME_REVIEWED: "reviewed {game}, which is on your list",
}


def _actor_name(notification: Notification) -> str:
    """Who it was, as a lock screen should name them.

    The display name when there is one, because that is the name the sentence
    reads with; the handle otherwise. "Someone" is the floor rather than a case
    anything produces — `actor` is nullable for a system-raised notification,
    which nothing emits yet.
    """
    actor = notification.actor
    if actor is None:
        return "Someone"
    return actor.display_name or actor.username


def _phrase(notification: Notification) -> str:
    """What the actor did, as it reads after their name."""
    game = notification.review.game.title if notification.review else None
    if game:
        with_game = _PHRASES_WITH_GAME.get(notification.type)
        if with_game:
            return with_game.format(game=game)
    return _PHRASES[notification.type]


def _truncate(text: str) -> str:
    if len(text) <= _BODY_MAX:
        return text
    # Cut back to the last space so the ellipsis lands between words.
    head = text[: _BODY_MAX - 1].rstrip()
    spaced = head.rsplit(" ", 1)[0] if " " in head else head
    return f"{spaced}…"


def notification_body(notification: Notification) -> str:
    """The line under the title.

    A comment or a reply quotes itself. That is the one place this diverges from
    the in-app row on purpose rather than by necessity: a list row shows the
    quote *and* the sentence on two lines, and a push has one line that is often
    read without ever being opened — so the words somebody actually wrote are
    worth more in it than the fact that they wrote some.
    """
    phrase = _phrase(notification)
    if notification.comment is not None:
        return _truncate(f"{phrase}: “{notification.comment.text}”")
    return _truncate(phrase)


def deep_link_path(notification: Notification) -> str:
    """Where a tap goes — the twin of `notificationHref` in `@sidequestd/core`.

    Resolved here rather than sent as parts, because a tap can arrive at an app
    that was not running: there is no loaded inbox to look the row up in, and
    making the first thing a cold launch does a network request would mean a tap
    that goes nowhere on a phone with no signal.

    The ordering is core's and has to stay core's: the comment wins over the
    review, because a reply is only findable in the thread. Everything with no
    target is about a person, so it goes to their profile — and the inbox is the
    floor for a row whose target has been deleted since it was raised.
    """
    if notification.comment is not None:
        return f"/reviews/{notification.comment.review_id}#comments"
    if notification.review is not None:
        return f"/reviews/{notification.review.id}"
    if notification.actor is not None:
        return f"/profile/{notification.actor.username}"
    return "/notifications"


# --- Building a batch -------------------------------------------------------


async def messages_for(
    db: AsyncSession, notification_ids: Sequence[uuid.UUID]
) -> list[PushMessage]:
    """Turn freshly-committed notifications into messages for their recipients.

    Reads the rows back rather than taking them from the producer's session, and
    that is deliberate: this runs after that session's transaction closed, and a
    notification whose actor or target was rolled back should produce no push at
    all. Whatever is in the database is what gets sent.

    Recipients with no registered device cost nothing — they simply produce no
    messages — so there is no need for a producer to know whether anyone it is
    notifying happens to own a phone.
    """
    if not notification_ids:
        return []

    notifications = (
        await db.scalars(
            sa.select(Notification)
            .where(Notification.id.in_(list(notification_ids)))
            .options(
                selectinload(Notification.actor),
                selectinload(Notification.review).selectinload(Review.game),
                selectinload(Notification.comment),
            )
        )
    ).all()
    if not notifications:
        return []

    recipient_ids = {item.recipient_id for item in notifications}
    tokens = await _tokens_by_recipient(db, recipient_ids)
    if not tokens:
        return []

    badges = await _unread_counts(db, recipient_ids)

    messages: list[PushMessage] = []
    for notification in notifications:
        addresses = tokens.get(notification.recipient_id)
        if not addresses:
            continue

        data = {
            "notificationId": str(notification.id),
            "type": str(notification.type),
            "path": deep_link_path(notification),
        }
        for address in addresses:
            messages.append(
                PushMessage(
                    to=address,
                    title=_actor_name(notification),
                    body=notification_body(notification),
                    badge=badges.get(notification.recipient_id, 0),
                    data=data,
                )
            )
    return messages


async def _tokens_by_recipient(
    db: AsyncSession, recipient_ids: set[uuid.UUID]
) -> dict[uuid.UUID, list[str]]:
    """Every recipient's addresses, in one query rather than one per person."""
    rows = await db.execute(
        sa.select(DeviceToken.user_id, DeviceToken.token).where(
            DeviceToken.user_id.in_(list(recipient_ids))
        )
    )
    by_user: dict[uuid.UUID, list[str]] = {}
    for user_id, token in rows:
        by_user.setdefault(user_id, []).append(token)
    return by_user


async def _unread_counts(db: AsyncSession, recipient_ids: set[uuid.UUID]) -> dict[uuid.UUID, int]:
    """What each recipient's badge should read, grouped in one statement.

    The same number `GET /notifications/unread-count` returns, off the same
    partial index — asked here so the phone's icon is right the moment the push
    lands rather than the next time the app is opened.
    """
    rows = await db.execute(
        sa.select(Notification.recipient_id, sa.func.count())
        .where(
            Notification.recipient_id.in_(list(recipient_ids)),
            Notification.is_read.is_(False),
        )
        .group_by(Notification.recipient_id)
    )
    return dict(rows.tuples().all())


# --- Sending ----------------------------------------------------------------


def _new_client() -> httpx.AsyncClient:
    """The HTTP client every push goes through. Patched out in tests.

    The same seam `app.services.steam` uses, and the same timeout: long enough
    for a batch of a hundred, short enough that a push service having a bad day
    cannot pin a background task open for minutes.
    """
    headers = {"accept": "application/json", "content-type": "application/json"}
    if settings.expo_access_token:
        headers["authorization"] = f"Bearer {settings.expo_access_token}"
    return httpx.AsyncClient(timeout=15.0, headers=headers)


def _chunks(messages: Sequence[PushMessage]) -> list[Sequence[PushMessage]]:
    return [
        messages[start : start + MAX_MESSAGES_PER_REQUEST]
        for start in range(0, len(messages), MAX_MESSAGES_PER_REQUEST)
    ]


async def send(messages: Sequence[PushMessage]) -> list[str]:
    """Hand a batch to Expo. Returns the addresses it says are dead.

    Tickets come back positionally, one per message, so a `DeviceNotRegistered`
    is matched to its token by index — Expo does not echo the address back. A
    short or missing ticket list is therefore not something to guess at: the
    batch is treated as delivered-unknown and nothing is pruned, because pruning
    against a misaligned list would delete live devices.

    A whole chunk failing (a timeout, a 502) loses that chunk's notifications
    and nothing else. There is no retry — see the module docstring.
    """
    if not messages:
        return []

    dead: list[str] = []
    async with _new_client() as client:
        for chunk in _chunks(messages):
            try:
                response = await client.post(
                    settings.push_api_url, json=[message.as_payload() for message in chunk]
                )
                response.raise_for_status()
                body = response.json()
            except (httpx.HTTPError, ValueError):
                logger.exception("Push batch of %d failed", len(chunk))
                continue

            dead.extend(_dead_tokens(chunk, body))
    return dead


def _dead_tokens(chunk: Sequence[PushMessage], body: object) -> list[str]:
    """The addresses in this chunk that Expo reported as unreachable for good.

    Only `DeviceNotRegistered` is fatal. `MessageRateExceeded` and
    `MessageTooBig` are about the send rather than the device, and deleting a
    token because one message was too large would lose a real phone over a long
    comment.
    """
    if not isinstance(body, dict):
        return []
    tickets = body.get("data")
    if not isinstance(tickets, list) or len(tickets) != len(chunk):
        logger.warning("Push response had %s tickets for %d messages", type(tickets), len(chunk))
        return []

    dead: list[str] = []
    for message, ticket in zip(chunk, tickets, strict=True):
        if not isinstance(ticket, dict) or ticket.get("status") != "error":
            continue
        details = ticket.get("details")
        error = details.get("error") if isinstance(details, dict) else None
        if error == "DeviceNotRegistered":
            dead.append(message.to)
        else:
            logger.warning("Push ticket error %s: %s", error, ticket.get("message"))
    return dead


# --- The whole round trip ---------------------------------------------------


async def deliver(notification_ids: Sequence[uuid.UUID]) -> None:
    """What the commit hook schedules: build, send, sweep.

    Opens its own session for the same reason the Steam sync does — this runs
    after the request that caused it has returned and that session is closed.
    Nothing raises out of here: the caller is an event loop task with no one to
    report to, and the notification itself is already safely recorded.
    """
    if not settings.push_enabled or not notification_ids:
        return

    from app.db.session import SessionLocal

    try:
        async with SessionLocal() as session:
            messages = await messages_for(session, notification_ids)
            if not messages:
                return

            dead = await send(messages)
            if dead:
                forgotten = await devices_service.forget(session, dead)
                logger.info("Dropped %d unreachable device token(s)", forgotten)
    except Exception:
        logger.exception("Push delivery failed for %d notification(s)", len(notification_ids))
