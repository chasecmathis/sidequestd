"""Follow requests — SPEC §6.7, §8.

Requests only exist because an account is private, so most of these set that up
through the real endpoint rather than writing PENDING rows directly: which of
"followed" and "requested" happens is itself the thing under test.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus, NotificationType
from app.models.social import Follow
from app.models.user import User
from tests.conftest import EmittedNotification

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]

REQUESTS_URL = "/api/v1/follow/requests"


def accept_url(user: User) -> str:
    return f"{REQUESTS_URL}/{user.id}/accept"


def decline_url(user: User) -> str:
    return f"{REQUESTS_URL}/{user.id}/decline"


def handles(body: dict[str, object]) -> list[str]:
    return [entry["user"]["username"] for entry in body["items"]]  # type: ignore[index,union-attr]


async def request_to_follow(
    client: AsyncClient, follower: User, followee: User, headers: AuthHeaders
) -> None:
    response = await client.post(f"/api/v1/follow/{followee.id}", headers=headers(follower))
    assert response.json()["state"] == "REQUESTED", response.text


async def edge_for(db: AsyncSession, follower: User, followee: User) -> Follow | None:
    return await db.scalar(
        sa.select(Follow).where(
            Follow.follower_id == follower.id, Follow.followee_id == followee.id
        )
    )


# --- The inbox --------------------------------------------------------------


async def test_the_list_holds_the_requests_you_have_received(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    for handle in ("hicks", "bishop"):
        await request_to_follow(client, await make_user(handle), newt, auth_headers)

    response = await client.get(REQUESTS_URL, headers=auth_headers(newt))

    assert response.status_code == 200, response.text
    assert sorted(handles(response.json())) == ["bishop", "hicks"]


async def test_each_entry_carries_the_requesters_shell_and_when_they_asked(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Enough to decide on: the decision is made before any content is visible."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks", display_name="Dwayne Hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)

    response = await client.get(REQUESTS_URL, headers=auth_headers(newt))

    entry = response.json()["items"][0]
    assert entry["user"]["display_name"] == "Dwayne Hicks"
    assert entry["requested_at"] is not None
    assert "email" not in response.text


async def test_a_request_you_sent_is_not_in_your_own_inbox(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """It is yours to withdraw, not to approve."""
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)
    await request_to_follow(client, hopeful, newt, auth_headers)

    response = await client.get(REQUESTS_URL, headers=auth_headers(hopeful))

    assert response.json()["items"] == []


async def test_an_accepted_follower_is_no_longer_a_request(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    follower = await make_user("hicks")
    db.add(Follow(follower_id=follower.id, followee_id=newt.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    assert (await client.get(REQUESTS_URL, headers=auth_headers(newt))).json()["items"] == []


async def test_a_public_account_has_nothing_to_approve(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Follows land accepted, so the screen is empty by construction rather than
    by filtering."""
    ripley = await make_user("ripley")
    await client.post(f"/api/v1/follow/{ripley.id}", headers=auth_headers(await make_user("hicks")))

    assert (await client.get(REQUESTS_URL, headers=auth_headers(ripley))).json()["items"] == []


async def test_a_deactivated_requester_drops_out(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    gone = await make_user("burke")
    db.add(Follow(follower_id=gone.id, followee_id=newt.id, status=FollowStatus.PENDING))
    gone.is_active = False
    await db.flush()

    assert (await client.get(REQUESTS_URL, headers=auth_headers(newt))).json()["items"] == []


async def test_the_inbox_needs_a_signed_in_caller(client: AsyncClient) -> None:
    assert (await client.get(REQUESTS_URL)).status_code == 401


async def test_the_newest_request_comes_first(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    base = datetime.now(UTC)
    for index, handle in enumerate(("oldest", "newest")):
        requester = await make_user(handle)
        db.add(
            Follow(
                follower_id=requester.id,
                followee_id=newt.id,
                status=FollowStatus.PENDING,
                created_at=base + timedelta(minutes=index),
            )
        )
    await db.flush()

    assert handles((await client.get(REQUESTS_URL, headers=auth_headers(newt))).json()) == [
        "newest",
        "oldest",
    ]


async def test_the_inbox_pages_without_repeating_or_skipping(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    # Distinct timestamps: rows written in one transaction otherwise share now().
    base = datetime.now(UTC)
    for index in range(5):
        requester = await make_user(f"fan{index}")
        db.add(
            Follow(
                follower_id=requester.id,
                followee_id=newt.id,
                status=FollowStatus.PENDING,
                created_at=base - timedelta(minutes=index),
            )
        )
    await db.flush()

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        page = (await client.get(REQUESTS_URL, params=params, headers=auth_headers(newt))).json()
        seen.extend(handles(page))
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert cursor is None, "pagination did not terminate"
    assert sorted(seen) == [f"fan{index}" for index in range(5)]
    assert len(seen) == len(set(seen))


# --- Approving --------------------------------------------------------------


async def test_accepting_establishes_the_follow(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)

    response = await client.post(accept_url(hopeful), headers=auth_headers(newt))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == "FOLLOWING"
    assert body["follower_id"] == str(hopeful.id)
    assert body["follower_count"] == 1
    edge = await edge_for(db, hopeful, newt)
    assert edge is not None and edge.status is FollowStatus.ACCEPTED


async def test_accepting_records_when_it_was_answered(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)

    await client.post(accept_url(hopeful), headers=auth_headers(newt))

    edge = await edge_for(db, hopeful, newt)
    assert edge is not None and edge.responded_at is not None


async def test_the_request_leaves_the_inbox_once_answered(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)

    await client.post(accept_url(hopeful), headers=auth_headers(newt))

    assert (await client.get(REQUESTS_URL, headers=auth_headers(newt))).json()["items"] == []


async def test_accepting_the_same_request_twice_is_a_404(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """There is nothing left to approve, which is friendlier than a conflict
    about a request the user can no longer see."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)
    await client.post(accept_url(hopeful), headers=auth_headers(newt))

    assert (await client.post(accept_url(hopeful), headers=auth_headers(newt))).status_code == 404


async def test_you_cannot_approve_a_request_addressed_to_someone_else(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """SPEC §6.7 puts approval in the followee's hands. The path names the
    requester; the followee is always the caller."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    meddler = await make_user("burke")
    await request_to_follow(client, hopeful, newt, auth_headers)

    response = await client.post(accept_url(hopeful), headers=auth_headers(meddler))

    assert response.status_code == 404
    edge = await edge_for(db, hopeful, newt)
    assert edge is not None and edge.status is FollowStatus.PENDING


async def test_approving_a_request_that_was_never_made_is_a_404(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)

    response = await client.post(
        f"{REQUESTS_URL}/{uuid.uuid4()}/accept", headers=auth_headers(newt)
    )

    assert response.status_code == 404


async def test_approving_tells_the_requester(
    client: AsyncClient,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)
    notifications_log.clear()

    await client.post(accept_url(hopeful), headers=auth_headers(newt))

    assert notifications_log == [
        EmittedNotification(
            recipient_id=hopeful.id,
            actor_id=newt.id,
            type=NotificationType.FOLLOW_REQUEST_APPROVED,
        )
    ]


# --- Declining --------------------------------------------------------------


async def test_declining_removes_the_request(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)

    response = await client.post(decline_url(hopeful), headers=auth_headers(newt))

    assert response.json()["state"] == "NONE"
    assert response.json()["follower_count"] == 0
    assert await edge_for(db, hopeful, newt) is None


async def test_a_declined_requester_may_ask_again(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Declining leaves no record, so the button falls back to "Follow" rather
    than locking them out."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)
    await client.post(decline_url(hopeful), headers=auth_headers(newt))

    await request_to_follow(client, hopeful, newt, auth_headers)

    assert handles((await client.get(REQUESTS_URL, headers=auth_headers(newt))).json()) == ["hicks"]


async def test_declining_says_nothing_to_the_requester(
    client: AsyncClient,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    """SPEC §6.12 has a notification for a request approved and none for one
    turned down."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)
    notifications_log.clear()

    await client.post(decline_url(hopeful), headers=auth_headers(newt))

    assert notifications_log == []


async def test_declining_an_accepted_follower_is_a_404(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Removing an existing follower is a different verb, at a different path."""
    newt = await make_user("newt", is_private=True)
    follower = await make_user("hicks")
    db.add(Follow(follower_id=follower.id, followee_id=newt.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.post(decline_url(follower), headers=auth_headers(newt))

    assert response.status_code == 404
    assert await edge_for(db, follower, newt) is not None


# --- Switching privacy (SPEC §6.7) ------------------------------------------


async def test_going_private_keeps_the_followers_you_already_had(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    ripley = await make_user("ripley")
    fan = await make_user("hicks")
    await client.post(f"/api/v1/follow/{ripley.id}", headers=auth_headers(fan))

    await client.patch("/api/v1/users/me", json={"is_private": True}, headers=auth_headers(ripley))

    profile = await client.get("/api/v1/users/ripley", headers=auth_headers(fan))
    assert profile.json()["can_view_content"] is True
    assert profile.json()["viewer_follow_state"] == "FOLLOWING"


async def test_going_public_does_not_approve_outstanding_requests(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """SPEC §6.7 is explicit: the switch itself approves nothing."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)

    await client.patch("/api/v1/users/me", json={"is_private": False}, headers=auth_headers(newt))

    edge = await edge_for(db, hopeful, newt)
    assert edge is not None and edge.status is FollowStatus.PENDING


async def test_asking_a_now_public_account_again_goes_through(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """The request is stranded once the account goes public — nothing takes it to
    a requests screen its owner has no reason to open. Asking again is what
    resolves it, and on a public account asking means following."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await request_to_follow(client, hopeful, newt, auth_headers)
    await client.patch("/api/v1/users/me", json={"is_private": False}, headers=auth_headers(newt))

    response = await client.post(f"/api/v1/follow/{newt.id}", headers=auth_headers(hopeful))

    assert response.json()["state"] == "FOLLOWING"
    assert response.json()["follower_count"] == 1
    edge = await edge_for(db, hopeful, newt)
    assert edge is not None and edge.status is FollowStatus.ACCEPTED
