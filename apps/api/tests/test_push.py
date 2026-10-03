"""Push delivery — SPEC §6.12.

Three things are worth pinning here and they are the three things that would
otherwise be found in production:

* the **wording**, because it is a second copy of `packages/core`'s and a new
  notification type would otherwise ship with no sentence at all;
* the **ticket alignment**, because Expo answers positionally and a misread
  response would delete live devices; and
* the **commit hook**, because a push sent from inside a transaction that then
  rolls back cannot be taken back.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import DeviceToken
from app.models.enums import DevicePlatform, NotificationType
from app.models.game import Game
from app.models.notification import Notification
from app.models.review import Comment, Review
from app.models.user import User
from app.services import devices as devices_service
from app.services import notifications as notifications_service
from app.services import push

pytestmark = pytest.mark.asyncio

MakeUser = Callable[..., Awaitable[User]]
MakeReview = Callable[..., Awaitable[Review]]


async def _device(db: AsyncSession, user: User, token: str) -> DeviceToken:
    row = DeviceToken(user_id=user.id, token=token, platform=DevicePlatform.IOS)
    db.add(row)
    await db.flush()
    return row


async def _notification(
    db: AsyncSession,
    *,
    recipient: User,
    actor: User,
    type: NotificationType,
    review: Review | None = None,
    comment: Comment | None = None,
) -> Notification:
    row = Notification(
        id=uuid.uuid4(),
        recipient_id=recipient.id,
        actor_id=actor.id,
        type=type,
        review_id=review.id if review else None,
        comment_id=comment.id if comment else None,
    )
    db.add(row)
    await db.flush()
    return row


# --- Wording ----------------------------------------------------------------


async def test_every_notification_type_has_a_phrase() -> None:
    """A new member of the enum must not ship with an empty push body.

    The in-app row would still read correctly — its wording lives in
    `packages/core` — so nothing else in the suite would notice.
    """
    assert set(push._PHRASES) == set(NotificationType)


async def test_body_names_the_game_when_there_is_one(
    db: AsyncSession, make_user: MakeUser, make_review: MakeReview, catalog: list[Game]
) -> None:
    author = await make_user("ripley", display_name="Ellen Ripley")
    liker = await make_user("dallas", display_name="Arthur Dallas")
    review = await make_review(author, game=catalog[0])

    notification = await _notification(
        db,
        recipient=author,
        actor=liker,
        type=NotificationType.REVIEW_LIKED,
        review=review,
    )
    await _device(db, author, "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]")

    [message] = await push.messages_for(db, [notification.id])

    # The display name is the title, so the body reads as the rest of a sentence
    # the lock screen has already started.
    assert message.title == "Arthur Dallas"
    assert message.body == f"liked your review of {catalog[0].title}"
    assert message.data["path"] == f"/reviews/{review.id}"


async def test_a_comment_quotes_itself(
    db: AsyncSession, make_user: MakeUser, make_review: MakeReview
) -> None:
    """The one place the push says more than the in-app row, and on purpose."""
    author = await make_user("ripley")
    commenter = await make_user("dallas")
    review = await make_review(author)

    comment = Comment(review_id=review.id, user_id=commenter.id, text="This is the best one yet")
    db.add(comment)
    await db.flush()

    notification = await _notification(
        db,
        recipient=author,
        actor=commenter,
        type=NotificationType.REVIEW_COMMENTED,
        review=review,
        comment=comment,
    )
    await _device(db, author, "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]")

    [message] = await push.messages_for(db, [notification.id])

    assert "This is the best one yet" in message.body
    # The comment wins over the review, exactly as `notificationHref` does: a
    # reply is only findable in the thread.
    assert message.data["path"] == f"/reviews/{review.id}#comments"


async def test_a_long_comment_is_cut_on_a_word(
    db: AsyncSession, make_user: MakeUser, make_review: MakeReview
) -> None:
    author = await make_user("ripley")
    commenter = await make_user("dallas")
    review = await make_review(author)

    comment = Comment(review_id=review.id, user_id=commenter.id, text="alpha " * 60)
    db.add(comment)
    await db.flush()

    notification = await _notification(
        db,
        recipient=author,
        actor=commenter,
        type=NotificationType.COMMENT_REPLIED,
        review=review,
        comment=comment,
    )
    await _device(db, author, "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]")

    [message] = await push.messages_for(db, [notification.id])

    assert len(message.body) <= push._BODY_MAX
    assert message.body.endswith("…")
    assert not message.body.endswith(" …")


async def test_a_follow_goes_to_the_actors_profile(db: AsyncSession, make_user: MakeUser) -> None:
    followed = await make_user("ripley")
    follower = await make_user("dallas")

    notification = await _notification(
        db, recipient=followed, actor=follower, type=NotificationType.NEW_FOLLOWER
    )
    await _device(db, followed, "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]")

    [message] = await push.messages_for(db, [notification.id])

    # No display name on this one, so the handle carries the sentence.
    assert message.title == "dallas"
    assert message.body == "started following you"
    assert message.data["path"] == "/profile/dallas"


# --- Addressing -------------------------------------------------------------


async def test_a_recipient_with_no_device_produces_nothing(
    db: AsyncSession, make_user: MakeUser
) -> None:
    """A producer must not have to know whether the person it notifies owns a phone."""
    followed = await make_user("ripley")
    follower = await make_user("dallas")

    notification = await _notification(
        db, recipient=followed, actor=follower, type=NotificationType.NEW_FOLLOWER
    )

    assert await push.messages_for(db, [notification.id]) == []


async def test_every_device_of_a_recipient_is_addressed(
    db: AsyncSession, make_user: MakeUser
) -> None:
    followed = await make_user("ripley")
    follower = await make_user("dallas")

    await _device(db, followed, "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]")
    await _device(db, followed, "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]")

    notification = await _notification(
        db, recipient=followed, actor=follower, type=NotificationType.NEW_FOLLOWER
    )

    messages = await push.messages_for(db, [notification.id])
    assert sorted(message.to for message in messages) == [
        "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]",
        "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]",
    ]


async def test_the_badge_is_the_recipients_unread_count(
    db: AsyncSession, make_user: MakeUser
) -> None:
    """The whole of "the badge updates from a background push".

    The number is the same one `GET /notifications/unread-count` returns, so a
    phone that never opens the app still shows the truth on its icon.
    """
    followed = await make_user("ripley")
    follower = await make_user("dallas")
    await _device(db, followed, "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]")

    older = await _notification(
        db, recipient=followed, actor=follower, type=NotificationType.NEW_FOLLOWER
    )
    newest = await _notification(
        db, recipient=followed, actor=follower, type=NotificationType.FOLLOW_REQUEST
    )
    # One already read: the badge counts what is unread, not what has arrived.
    older.is_read = True
    await db.flush()

    [message] = await push.messages_for(db, [newest.id])
    assert message.badge == 1


# --- The wire ---------------------------------------------------------------


def _client_returning(
    handler: Callable[[httpx.Request], httpx.Response],
) -> Callable[[], httpx.AsyncClient]:
    def _factory() -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(handler))

    return _factory


def _message(token: str) -> push.PushMessage:
    return push.PushMessage(to=token, title="Dallas", body="started following you", badge=1)


async def test_a_batch_is_chunked_to_the_api_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """Expo rejects a batch over 100 outright, so a popular fan-out is split."""
    batches: list[int] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        payload: list[dict[str, Any]] = json.loads(request.content)
        batches.append(len(payload))
        return httpx.Response(200, json={"data": [{"status": "ok"} for _ in payload]})

    monkeypatch.setattr(push, "_new_client", _client_returning(_handler))

    messages = [_message(f"ExponentPushToken[{index:022d}]") for index in range(250)]
    assert await push.send(messages) == []
    assert batches == [100, 100, 50]


async def test_only_device_not_registered_is_fatal(monkeypatch: pytest.MonkeyPatch) -> None:
    """A rate limit is about the send; an uninstalled app is about the device."""

    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "data": [
                    {"status": "ok", "id": "1"},
                    {"status": "error", "details": {"error": "DeviceNotRegistered"}},
                    {"status": "error", "details": {"error": "MessageRateExceeded"}},
                ]
            },
        )

    monkeypatch.setattr(push, "_new_client", _client_returning(_handler))

    dead = await push.send(
        [
            _message("ExponentPushToken[a]"),
            _message("ExponentPushToken[b]"),
            _message("ExponentPushToken[c]"),
        ]
    )
    assert dead == ["ExponentPushToken[b]"]


async def test_a_misaligned_response_prunes_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tickets are matched by index, so a short list must not be guessed at.

    Pruning against a misaligned response would delete devices that are alive.
    """

    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"data": [{"status": "error", "details": {"error": "DeviceNotRegistered"}}]}
        )

    monkeypatch.setattr(push, "_new_client", _client_returning(_handler))

    assert (
        await push.send([_message("ExponentPushToken[a]"), _message("ExponentPushToken[b]")]) == []
    )


async def test_a_failed_batch_loses_only_that_batch(monkeypatch: pytest.MonkeyPatch) -> None:
    """No retry, and no raising: a like is not less liked because Expo was down."""

    def _handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(502)

    monkeypatch.setattr(push, "_new_client", _client_returning(_handler))

    assert await push.send([_message("ExponentPushToken[a]")]) == []


async def test_dead_tokens_are_swept(db: AsyncSession, make_user: MakeUser) -> None:
    """`DeviceNotRegistered` is the only signal this table gets that a row is rubbish."""
    user = await make_user("ripley")
    await _device(db, user, "ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]")
    await _device(db, user, "ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]")

    forgotten = await devices_service.forget(db, ["ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]"])
    assert forgotten == 1

    remaining = (await db.scalars(sa.select(DeviceToken.token))).all()
    assert list(remaining) == ["ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]"]


# --- The commit hook --------------------------------------------------------


async def test_emit_queues_the_push_on_the_session(db: AsyncSession, make_user: MakeUser) -> None:
    """`emit` writes and does not commit, so it also cannot send.

    What it does instead is leave the id where the after-commit listener will
    find it — which is the only reason `emit` assigns the id itself.
    """
    followed = await make_user("ripley")
    follower = await make_user("dallas")

    await notifications_service.emit(
        db,
        recipient_id=followed.id,
        actor_id=follower.id,
        type=NotificationType.NEW_FOLLOWER,
    )

    queued = db.info[notifications_service._PENDING_KEY]
    assert len(queued) == 1
    assert isinstance(queued[0], uuid.UUID)


async def test_notifying_yourself_queues_nothing(db: AsyncSession, make_user: MakeUser) -> None:
    user = await make_user("ripley")

    await notifications_service.emit(
        db,
        recipient_id=user.id,
        actor_id=user.id,
        type=NotificationType.NEW_FOLLOWER,
    )

    assert notifications_service._PENDING_KEY not in db.info


async def test_a_rollback_discards_the_queue(db: AsyncSession, make_user: MakeUser) -> None:
    """The action did not happen, so neither did the notification about it.

    A push, unlike a row, cannot be rolled back once it is on a lock screen.
    """
    followed = await make_user("ripley")
    follower = await make_user("dallas")

    await notifications_service.emit(
        db,
        recipient_id=followed.id,
        actor_id=follower.id,
        type=NotificationType.NEW_FOLLOWER,
    )
    await db.rollback()

    assert not db.info.get(notifications_service._PENDING_KEY)
