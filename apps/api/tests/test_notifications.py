"""In-app notifications — SPEC §6.12, §8.

Two halves, and they are tested differently on purpose.

The *write* half is `emit`, and what matters about it is that a row exists
afterwards with the right recipient, actor, type and target. Those tests drive
the real producers through the API and then read the table, because a
notification that is emitted but not stored is exactly the bug this slice
existed to fix. (The complementary tests — that each producer *calls* the seam,
and that the wrong actions call nothing at all — live beside their producers and
substitute `emit` through the `notifications_log` fixture.)

The *read* half is the tab: newest first, unread counted, marked read one at a
time or all at once, and never anybody else's. Ownership is the thread running
through it — there is no notification endpoint that takes a user id, so every
test here that could leak someone else's inbox asks for it and is refused.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus, FollowStatus, NotificationType
from app.models.game import Game
from app.models.notification import Notification
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User
from app.services import notifications as notifications_service

MakeUser = Callable[..., Awaitable[User]]
MakeReview = Callable[..., Awaitable[Review]]
AuthHeaders = Callable[[User], dict[str, str]]

NOTIFICATIONS_URL = "/api/v1/notifications"
UNREAD_URL = f"{NOTIFICATIONS_URL}/unread-count"
READ_URL = f"{NOTIFICATIONS_URL}/read"


# --- Helpers ----------------------------------------------------------------


async def rows_for(db: AsyncSession, user: User) -> list[Notification]:
    """Somebody's notifications straight from the table, oldest first."""
    result = await db.scalars(
        sa.select(Notification)
        .where(Notification.recipient_id == user.id)
        .order_by(Notification.created_at, Notification.id)
    )
    return list(result)


async def follow(db: AsyncSession, follower: User, followee: User) -> None:
    db.add(Follow(follower_id=follower.id, followee_id=followee.id, status=FollowStatus.ACCEPTED))
    await db.flush()


async def backlog(
    db: AsyncSession, user: User, game: Game, status: BacklogStatus = BacklogStatus.TO_BE_PLAYED
) -> None:
    db.add(BacklogItem(user_id=user.id, game_id=game.id, status=status, position=0))
    await db.flush()


async def notify(
    db: AsyncSession,
    recipient: User,
    actor: User,
    *,
    type: NotificationType = NotificationType.NEW_FOLLOWER,
) -> None:
    """Write a notification the short way, for the tests that only need rows."""
    await notifications_service.emit(db, recipient_id=recipient.id, actor_id=actor.id, type=type)
    await db.flush()


async def backdate(db: AsyncSession, *, minutes: int) -> None:
    """Move every notification into the past.

    `created_at` is Postgres' `now()`, which is the *transaction* clock — and the
    whole test runs in one transaction, so rows written a few statements apart
    are stamped identically. Ordering and paging are only observable once the
    earlier ones have actually been pushed earlier.
    """
    await db.execute(
        sa.update(Notification).values(created_at=sa.text(f"now() - interval '{minutes} minutes'"))
    )
    await db.flush()


async def read_page(
    client: AsyncClient, headers: dict[str, str], **params: str
) -> dict[str, object]:
    response = await client.get(NOTIFICATIONS_URL, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return dict(response.json())


async def unread(client: AsyncClient, headers: dict[str, str]) -> int:
    response = await client.get(UNREAD_URL, headers=headers)
    assert response.status_code == 200, response.text
    count = response.json()["count"]
    assert isinstance(count, int)
    return count


async def mark_read(
    client: AsyncClient, headers: dict[str, str], **body: object
) -> dict[str, object]:
    response = await client.post(READ_URL, headers=headers, json=body)
    assert response.status_code == 200, response.text
    return dict(response.json())


def types_in(body: dict[str, object]) -> list[str]:
    items = body["items"]
    assert isinstance(items, list)
    return [item["type"] for item in items]


def ids_in(body: dict[str, object]) -> list[str]:
    items = body["items"]
    assert isinstance(items, list)
    return [item["id"] for item in items]


# --- The seam actually stores something (SPEC §6.12) ------------------------


async def test_following_stores_a_new_follower_notification(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    fan = await make_user("hicks")
    idol = await make_user("ripley")

    await client.post(f"/api/v1/follow/{idol.id}", headers=auth_headers(fan))

    (row,) = await rows_for(db, idol)
    assert row.type is NotificationType.NEW_FOLLOWER
    assert row.actor_id == fan.id
    assert row.is_read is False
    # A follow is about a person, so there is nothing else to point at.
    assert (row.review_id, row.comment_id) == (None, None)


async def test_asking_a_private_account_stores_a_request(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)

    await client.post(f"/api/v1/follow/{newt.id}", headers=auth_headers(hopeful))

    (row,) = await rows_for(db, newt)
    assert row.type is NotificationType.FOLLOW_REQUEST


async def test_approving_a_request_stores_one_for_the_requester(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """The one notification that travels back down the edge that caused it."""
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)
    await client.post(f"/api/v1/follow/{newt.id}", headers=auth_headers(hopeful))

    await client.post(f"/api/v1/follow/requests/{hopeful.id}/accept", headers=auth_headers(newt))

    (row,) = await rows_for(db, hopeful)
    assert row.type is NotificationType.FOLLOW_REQUEST_APPROVED
    assert row.actor_id == newt.id


async def test_liking_stores_one_pointing_at_the_review(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)

    await client.post(f"/api/v1/reviews/{review.id}/like", headers=auth_headers(fan))

    (row,) = await rows_for(db, author)
    assert row.type is NotificationType.REVIEW_LIKED
    assert row.review_id == review.id
    assert row.comment_id is None


async def test_commenting_stores_one_pointing_at_both(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The review says what it is about; the comment is where the link goes."""
    author = await make_user("ripley")
    hicks = await make_user("hicks")
    review = await make_review(author)

    response = await client.post(
        f"/api/v1/reviews/{review.id}/comments",
        headers=auth_headers(hicks),
        json={"text": "Astonishing."},
    )
    assert response.status_code == 201, response.text

    (row,) = await rows_for(db, author)
    assert row.type is NotificationType.REVIEW_COMMENTED
    assert row.review_id == review.id
    assert row.comment_id == uuid.UUID(response.json()["id"])


async def test_a_reply_stores_one_for_each_of_the_two_people(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley")
    hicks = await make_user("hicks")
    bishop = await make_user("bishop")
    review = await make_review(author)
    parent = await client.post(
        f"/api/v1/reviews/{review.id}/comments",
        headers=auth_headers(hicks),
        json={"text": "Astonishing."},
    )

    reply = await client.post(
        f"/api/v1/reviews/{review.id}/comments",
        headers=auth_headers(bishop),
        json={"text": "Agreed.", "parent_comment_id": parent.json()["id"]},
    )

    # Picked out by the comment they point at rather than by position: the author
    # already heard about the comment being replied to, and both of their rows
    # were written inside one transaction, so they share a `created_at`.
    reply_id = uuid.UUID(reply.json()["id"])
    about_reply = [
        row
        for user in (author, hicks)
        for row in await rows_for(db, user)
        if row.comment_id == reply_id
    ]

    assert [row.type for row in about_reply] == [
        # The review's author hears that something was said on their review…
        NotificationType.REVIEW_COMMENTED,
        # …and the person answered hears that they were answered.
        NotificationType.COMMENT_REPLIED,
    ]
    # Both also carry the review, so either row is a link without a lookup.
    assert {row.review_id for row in about_reply} == {review.id}


# --- Someone reviewed a game on your list (SPEC §6.12) ----------------------


async def test_reviewing_tells_the_followers_holding_that_game(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley")
    watcher = await make_user("hicks")
    game = catalog[0]
    await follow(db, watcher, author)
    await backlog(db, watcher, game)

    response = await client.post(
        "/api/v1/reviews", headers=auth_headers(author), json={"game_id": str(game.id), "rating": 9}
    )
    assert response.status_code == 201, response.text

    (row,) = await rows_for(db, watcher)
    assert row.type is NotificationType.BACKLOG_GAME_REVIEWED
    assert row.actor_id == author.id
    # It is worth reading *because* of the review, so that is the link.
    assert row.review_id == uuid.UUID(response.json()["id"])


async def test_reviewing_says_nothing_to_someone_who_does_not_follow_you(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.12 says "someone *you follow*" — holding the game is not enough,
    or every review would notify strangers who happened to want the same game."""
    author = await make_user("ripley")
    stranger = await make_user("hicks")
    game = catalog[0]
    await backlog(db, stranger, game)

    await client.post(
        "/api/v1/reviews", headers=auth_headers(author), json={"game_id": str(game.id), "rating": 9}
    )

    assert await rows_for(db, stranger) == []


async def test_reviewing_says_nothing_to_a_follower_without_the_game(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Following someone already puts their reviews in your feed. This
    notification is for the game being one you were waiting on."""
    author = await make_user("ripley")
    watcher = await make_user("hicks")
    await follow(db, watcher, author)
    await backlog(db, watcher, catalog[1])

    await client.post(
        "/api/v1/reviews",
        headers=auth_headers(author),
        json={"game_id": str(catalog[0].id), "rating": 9},
    )

    assert await rows_for(db, watcher) == []


@pytest.mark.parametrize("status", [BacklogStatus.COMPLETED, BacklogStatus.DROPPED])
async def test_reviewing_says_nothing_about_a_game_they_are_finished_with(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    status: BacklogStatus,
) -> None:
    """The notification helps you decide what to play next, which is not a
    question you still have about a game you completed or gave up on."""
    author = await make_user("ripley")
    watcher = await make_user("hicks")
    game = catalog[0]
    await follow(db, watcher, author)
    await backlog(db, watcher, game, status)

    await client.post(
        "/api/v1/reviews", headers=auth_headers(author), json={"game_id": str(game.id), "rating": 9}
    )

    assert await rows_for(db, watcher) == []


async def test_reviewing_a_game_on_your_own_list_tells_you_nothing(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Reviewing something is a fine way to take it off your own backlog, and
    hearing about it from yourself would be absurd."""
    author = await make_user("ripley")
    game = catalog[0]
    await backlog(db, author, game)

    await client.post(
        "/api/v1/reviews", headers=auth_headers(author), json={"game_id": str(game.id), "rating": 9}
    )

    assert await rows_for(db, author) == []


async def test_reviewing_tells_every_follower_holding_the_game(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The one notification with more than one recipient — one row each."""
    author = await make_user("ripley")
    game = catalog[0]
    watchers = [await make_user(name) for name in ("hicks", "bishop", "newt")]
    for watcher in watchers:
        await follow(db, watcher, author)
        await backlog(db, watcher, game)

    await client.post(
        "/api/v1/reviews", headers=auth_headers(author), json={"game_id": str(game.id), "rating": 9}
    )

    for watcher in watchers:
        assert [row.type for row in await rows_for(db, watcher)] == [
            NotificationType.BACKLOG_GAME_REVIEWED
        ]


# --- What emit will not do --------------------------------------------------


async def test_emit_writes_nothing_about_your_own_action(
    db: AsyncSession, make_user: MakeUser
) -> None:
    """The producers all check first, but the guard is here too, so a producer
    written next year cannot reintroduce "you liked your own review"."""
    ripley = await make_user("ripley")

    await notifications_service.emit(
        db, recipient_id=ripley.id, actor_id=ripley.id, type=NotificationType.REVIEW_LIKED
    )
    await db.flush()

    assert await rows_for(db, ripley) == []


async def test_a_rolled_back_action_leaves_no_notification(
    db: AsyncSession, make_user: MakeUser
) -> None:
    """`emit` writes into the caller's transaction rather than one of its own, so
    a notification about something that did not happen cannot survive it."""
    ripley = await make_user("ripley")
    hicks = await make_user("hicks")

    savepoint = await db.begin_nested()
    await notifications_service.emit(
        db, recipient_id=ripley.id, actor_id=hicks.id, type=NotificationType.NEW_FOLLOWER
    )
    await db.flush()
    await savepoint.rollback()

    assert await rows_for(db, ripley) == []


# --- The tab (SPEC §6.12) ---------------------------------------------------


async def test_the_tab_lists_your_notifications_newest_first(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    hicks = await make_user("hicks")
    await notify(db, ripley, hicks, type=NotificationType.NEW_FOLLOWER)
    await backdate(db, minutes=5)
    await notify(db, ripley, hicks, type=NotificationType.FOLLOW_REQUEST_APPROVED)

    body = await read_page(client, auth_headers(ripley))

    assert types_in(body) == [
        NotificationType.FOLLOW_REQUEST_APPROVED.value,
        NotificationType.NEW_FOLLOWER.value,
    ]


async def test_the_tab_shows_only_your_own(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """There is no id in the path, so this is the only shape the leak could
    take: reading your own inbox and finding somebody else's row in it."""
    ripley = await make_user("ripley")
    newt = await make_user("newt")
    hicks = await make_user("hicks")
    await notify(db, newt, hicks)

    body = await read_page(client, auth_headers(ripley))

    assert body["items"] == []


async def test_a_row_carries_the_actor_as_a_public_shell(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    hicks = await make_user("hicks", display_name="Dwayne Hicks")
    await notify(db, ripley, hicks)

    body = await read_page(client, auth_headers(ripley))
    items = body["items"]
    assert isinstance(items, list)

    assert items[0]["actor"]["username"] == "hicks"
    assert items[0]["actor"]["display_name"] == "Dwayne Hicks"
    # A shell, not the whole account: a notification is not an introduction.
    assert "email" not in items[0]["actor"]


async def test_a_like_row_names_the_game_it_is_about(
    client: AsyncClient,
    catalog: list[Game],
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """ "Hicks liked your review of *…*" is one request, not one plus a lookup."""
    author = await make_user("ripley")
    hicks = await make_user("hicks")
    review = await make_review(author, game=catalog[0])
    await client.post(f"/api/v1/reviews/{review.id}/like", headers=auth_headers(hicks))

    body = await read_page(client, auth_headers(author))
    items = body["items"]
    assert isinstance(items, list)

    assert items[0]["review"]["id"] == str(review.id)
    assert items[0]["review"]["game"]["title"] == catalog[0].title
    assert items[0]["comment"] is None


async def test_a_comment_row_carries_the_words_and_where_they_are(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley")
    hicks = await make_user("hicks")
    review = await make_review(author)
    await client.post(
        f"/api/v1/reviews/{review.id}/comments",
        headers=auth_headers(hicks),
        json={"text": "Astonishing."},
    )

    body = await read_page(client, auth_headers(author))
    items = body["items"]
    assert isinstance(items, list)

    assert items[0]["comment"]["text"] == "Astonishing."
    assert items[0]["comment"]["review_id"] == str(review.id)


async def test_a_follow_row_has_no_target_at_all(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    await notify(db, ripley, await make_user("hicks"))

    body = await read_page(client, auth_headers(ripley))
    items = body["items"]
    assert isinstance(items, list)

    assert (items[0]["review"], items[0]["comment"]) == (None, None)


async def test_the_tab_pages_without_repeating_a_row(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    hicks = await make_user("hicks")
    for minute in range(5):
        await notify(db, ripley, hicks)
        await backdate(db, minutes=minute + 1)

    first = await read_page(client, auth_headers(ripley), limit="2")
    cursor = first["next_cursor"]
    assert isinstance(cursor, str)
    second = await read_page(client, auth_headers(ripley), limit="2", cursor=cursor)

    seen = ids_in(first) + ids_in(second)
    assert len(seen) == 4
    assert len(set(seen)) == 4


async def test_the_tab_needs_a_caller(client: AsyncClient) -> None:
    assert (await client.get(NOTIFICATIONS_URL)).status_code == 401
    assert (await client.get(UNREAD_URL)).status_code == 401
    assert (await client.post(READ_URL, json={})).status_code == 401


# --- The unread badge (SPEC §6.12) ------------------------------------------


async def test_a_new_account_has_nothing_unread(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    assert await unread(client, auth_headers(await make_user("ripley"))) == 0


async def test_the_badge_counts_what_arrived(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    hicks = await make_user("hicks")
    await notify(db, ripley, hicks)
    await notify(db, ripley, hicks)

    assert await unread(client, auth_headers(ripley)) == 2


async def test_the_badge_ignores_other_peoples_notifications(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    newt = await make_user("newt")
    await notify(db, newt, await make_user("hicks"))

    assert await unread(client, auth_headers(ripley)) == 0


async def test_reading_the_tab_does_not_mark_anything_read(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Marking is the client's decision, which is why it is its own endpoint."""
    ripley = await make_user("ripley")
    await notify(db, ripley, await make_user("hicks"))

    await read_page(client, auth_headers(ripley))

    assert await unread(client, auth_headers(ripley)) == 1


# --- Marking read (SPEC §6.12) ----------------------------------------------


async def test_marking_one_leaves_the_rest_unread(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    hicks = await make_user("hicks")
    await notify(db, ripley, hicks)
    await notify(db, ripley, hicks)
    headers = auth_headers(ripley)
    body = await read_page(client, headers)

    result = await mark_read(client, headers, ids=[ids_in(body)[0]])

    assert result == {"marked": 1, "unread_count": 1}


async def test_marking_all_empties_the_badge(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """No `ids` at all — SPEC §6.12's "mark all as read"."""
    ripley = await make_user("ripley")
    hicks = await make_user("hicks")
    await notify(db, ripley, hicks)
    await notify(db, ripley, hicks)
    headers = auth_headers(ripley)

    result = await mark_read(client, headers)

    assert result == {"marked": 2, "unread_count": 0}
    body = await read_page(client, headers)
    items = body["items"]
    assert isinstance(items, list)
    assert all(item["is_read"] for item in items)


async def test_an_empty_id_list_marks_nothing(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The dangerous reading of `[]` would be "all of them". A client that meant
    "these" and computed an empty selection gets a no-op instead."""
    ripley = await make_user("ripley")
    await notify(db, ripley, await make_user("hicks"))
    headers = auth_headers(ripley)

    result = await mark_read(client, headers, ids=[])

    assert result == {"marked": 0, "unread_count": 1}


async def test_marking_the_same_one_twice_reports_no_second_change(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """`marked` counts what changed, so a client can trust it to move a badge."""
    ripley = await make_user("ripley")
    await notify(db, ripley, await make_user("hicks"))
    headers = auth_headers(ripley)
    chosen = ids_in(await read_page(client, headers))

    assert (await mark_read(client, headers, ids=chosen))["marked"] == 1
    assert (await mark_read(client, headers, ids=chosen))["marked"] == 0


async def test_you_cannot_mark_somebody_elses_notification_read(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Zero rather than a 403: refusing would confirm that the id is real and
    whose it is, which is more than a stranger is entitled to learn."""
    ripley = await make_user("ripley")
    newt = await make_user("newt")
    await notify(db, newt, await make_user("hicks"))
    theirs = ids_in(await read_page(client, auth_headers(newt)))

    result = await mark_read(client, auth_headers(ripley), ids=theirs)

    assert result == {"marked": 0, "unread_count": 0}
    assert await unread(client, auth_headers(newt)) == 1


async def test_marking_all_read_stops_at_your_own(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    newt = await make_user("newt")
    hicks = await make_user("hicks")
    await notify(db, ripley, hicks)
    await notify(db, newt, hicks)

    await mark_read(client, auth_headers(ripley))

    assert await unread(client, auth_headers(newt)) == 1


async def test_an_unknown_id_is_simply_not_found_and_not_an_error(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    ripley = await make_user("ripley")
    await notify(db, ripley, await make_user("hicks"))

    result = await mark_read(client, auth_headers(ripley), ids=[str(uuid.uuid4())])

    assert result == {"marked": 0, "unread_count": 1}
