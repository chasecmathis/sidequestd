"""Read-only follower / following lists — SPEC §6.2, §6.7.

Follow *actions* are the social slice, so the edges here are written directly.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus
from app.models.social import Follow
from app.models.user import User

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


def followers_url(user: User) -> str:
    return f"/api/v1/users/{user.id}/followers"


def following_url(user: User) -> str:
    return f"/api/v1/users/{user.id}/following"


def handles(body: dict[str, object]) -> list[str]:
    return [shell["username"] for shell in body["items"]]  # type: ignore[index,union-attr]


# --- Reading the graph -----------------------------------------------------


async def test_followers_lists_the_accepted_edges_pointing_at_a_user(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")
    for handle in ("hicks", "bishop"):
        follower = await make_user(handle)
        db.add(
            Follow(follower_id=follower.id, followee_id=subject.id, status=FollowStatus.ACCEPTED)
        )
    await db.flush()

    body = (await client.get(followers_url(subject))).json()

    assert sorted(handles(body)) == ["bishop", "hicks"]


async def test_following_lists_the_edges_pointing_away(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")
    idol = await make_user("bishop")
    fan = await make_user("hicks")
    db.add(Follow(follower_id=subject.id, followee_id=idol.id, status=FollowStatus.ACCEPTED))
    db.add(Follow(follower_id=fan.id, followee_id=subject.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    assert handles((await client.get(following_url(subject))).json()) == ["bishop"]


async def test_a_pending_request_is_in_neither_list(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")
    hopeful = await make_user("hicks")
    db.add(Follow(follower_id=hopeful.id, followee_id=subject.id, status=FollowStatus.PENDING))
    await db.flush()

    assert (await client.get(followers_url(subject))).json()["items"] == []


async def test_a_deactivated_follower_drops_out_of_the_list(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")
    gone = await make_user("burke")
    db.add(Follow(follower_id=gone.id, followee_id=subject.id, status=FollowStatus.ACCEPTED))
    gone.is_active = False
    await db.flush()

    assert (await client.get(followers_url(subject))).json()["items"] == []


async def test_the_list_returns_shells_not_full_records(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")
    follower = await make_user("hicks", display_name="Dwayne Hicks")
    db.add(Follow(follower_id=follower.id, followee_id=subject.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.get(followers_url(subject))

    shell = response.json()["items"][0]
    assert shell["display_name"] == "Dwayne Hicks"
    assert "email" not in response.text


async def test_an_empty_list_is_a_page_not_an_error(
    client: AsyncClient, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")

    assert (await client.get(followers_url(subject))).json() == {"items": [], "next_cursor": None}


async def test_an_unknown_user_is_a_404(client: AsyncClient) -> None:
    assert (await client.get(f"/api/v1/users/{uuid.uuid4()}/followers")).status_code == 404


# --- Pagination ------------------------------------------------------------


async def test_the_list_pages_without_repeating_or_skipping(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")
    # Distinct timestamps: the keyset orders by when the follow happened, and
    # rows inserted in one transaction would otherwise all share `now()`.
    base = datetime.now(UTC)
    for index in range(5):
        follower = await make_user(f"fan{index}")
        db.add(
            Follow(
                follower_id=follower.id,
                followee_id=subject.id,
                status=FollowStatus.ACCEPTED,
                created_at=base - timedelta(minutes=index),
            )
        )
    await db.flush()

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        page = (await client.get(followers_url(subject), params=params)).json()
        seen.extend(handles(page))
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert cursor is None, "pagination did not terminate"
    assert sorted(seen) == [f"fan{index}" for index in range(5)]
    assert len(seen) == len(set(seen))


async def test_the_newest_follower_comes_first(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")
    base = datetime.now(UTC)
    for index, handle in enumerate(("oldest", "newest")):
        follower = await make_user(handle)
        db.add(
            Follow(
                follower_id=follower.id,
                followee_id=subject.id,
                status=FollowStatus.ACCEPTED,
                created_at=base + timedelta(minutes=index),
            )
        )
    await db.flush()

    assert handles((await client.get(followers_url(subject))).json()) == ["newest", "oldest"]


async def test_a_corrupt_cursor_is_a_400(client: AsyncClient, make_user: MakeUser) -> None:
    subject = await make_user("ripley")

    response = await client.get(followers_url(subject), params={"cursor": "garbage"})

    assert response.status_code == 400


# --- Privacy (SPEC §6.7) ---------------------------------------------------


async def test_a_private_accounts_lists_are_refused_to_a_stranger(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """SPEC §6.7 names the follower/following lists as gated content — unlike the
    counts on the profile, which stay visible."""
    subject = await make_user("newt", is_private=True)

    assert (await client.get(followers_url(subject))).status_code == 403
    assert (await client.get(following_url(subject))).status_code == 403


async def test_an_approved_follower_may_read_them(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    subject = await make_user("newt", is_private=True)
    follower = await make_user("hicks")
    db.add(Follow(follower_id=follower.id, followee_id=subject.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.get(followers_url(subject), headers=auth_headers(follower))

    assert response.status_code == 200
    assert handles(response.json()) == ["hicks"]


async def test_the_owner_may_read_their_own(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    subject = await make_user("newt", is_private=True)

    response = await client.get(followers_url(subject), headers=auth_headers(subject))

    assert response.status_code == 200
