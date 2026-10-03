"""Push device registration — SPEC §6.12.

The interesting half of this file is ownership. A push token addresses a
*device*, not an account, and the endpoint's contract is that registering one
moves it to the caller. The tests that matter are therefore the ones about a
phone that has been signed into twice.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from urllib.parse import quote

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import DeviceToken
from app.models.enums import DevicePlatform
from app.models.user import User

pytestmark = pytest.mark.asyncio

TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
OTHER_TOKEN = "ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]"

MakeUser = Callable[..., Awaitable[User]]
Headers = Callable[[User], dict[str, str]]


async def _tokens(db: AsyncSession) -> list[DeviceToken]:
    return list((await db.scalars(sa.select(DeviceToken).order_by(DeviceToken.token))).all())


async def test_register_requires_a_session(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/users/me/devices", json={"token": TOKEN, "platform": "IOS"}
    )
    assert response.status_code == 401


async def test_register_stores_the_token(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    user = await make_user("ripley")

    response = await client.post(
        "/api/v1/users/me/devices",
        json={"token": TOKEN, "platform": "IOS"},
        headers=auth_headers(user),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["registered"] is True
    # The suite runs with delivery off, and the response says so — which is the
    # whole reason it is a body rather than a 204.
    assert body["push_enabled"] is False

    stored = await _tokens(db)
    assert [(item.user_id, item.token, item.platform) for item in stored] == [
        (user.id, TOKEN, DevicePlatform.IOS)
    ]


async def test_registering_twice_keeps_one_row(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    """The client registers on every cold start; that must not accumulate rows."""
    user = await make_user("ripley")
    headers = auth_headers(user)

    first = await client.post(
        "/api/v1/users/me/devices", json={"token": TOKEN, "platform": "IOS"}, headers=headers
    )
    assert first.status_code == 200
    original = (await _tokens(db))[0]
    seen_at = original.last_seen_at

    second = await client.post(
        "/api/v1/users/me/devices", json={"token": TOKEN, "platform": "IOS"}, headers=headers
    )
    assert second.status_code == 200

    db.expire_all()
    stored = await _tokens(db)
    assert len(stored) == 1
    assert stored[0].last_seen_at >= seen_at


async def test_registering_someone_elses_token_moves_it(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    """A phone that changed hands stops carrying the old member's notifications.

    The failure this guards against is the worst one available to this feature:
    two rows for one device, and a lock screen showing a stranger somebody
    else's comments.
    """
    first_owner = await make_user("ripley")
    second_owner = await make_user("dallas")
    # Read before the expiry below: touching an expired ORM object from an
    # assertion means lazy IO outside the session's greenlet.
    new_owner_id = second_owner.id

    await client.post(
        "/api/v1/users/me/devices",
        json={"token": TOKEN, "platform": "IOS"},
        headers=auth_headers(first_owner),
    )
    await client.post(
        "/api/v1/users/me/devices",
        json={"token": TOKEN, "platform": "ANDROID"},
        headers=auth_headers(second_owner),
    )

    db.expire_all()
    stored = await _tokens(db)
    assert len(stored) == 1
    assert stored[0].user_id == new_owner_id
    assert stored[0].platform == DevicePlatform.ANDROID


async def test_forget_removes_only_the_callers_token(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    owner = await make_user("ripley")
    stranger = await make_user("dallas")

    await client.post(
        "/api/v1/users/me/devices",
        json={"token": TOKEN, "platform": "IOS"},
        headers=auth_headers(owner),
    )

    # Naming somebody else's token is a no-op reported as success, not a 403 —
    # a 403 would confirm the token exists.
    stranger_attempt = await client.delete(
        f"/api/v1/users/me/devices/{quote(TOKEN, safe='')}", headers=auth_headers(stranger)
    )
    assert stranger_attempt.status_code == 200
    assert len(await _tokens(db)) == 1

    removed = await client.delete(
        f"/api/v1/users/me/devices/{quote(TOKEN, safe='')}", headers=auth_headers(owner)
    )
    assert removed.status_code == 200
    assert removed.json()["registered"] is False

    db.expire_all()
    assert await _tokens(db) == []


async def test_forget_is_idempotent(
    client: AsyncClient, make_user: MakeUser, auth_headers: Headers
) -> None:
    """Signing out of an app that never had the permission sends nothing real."""
    user = await make_user("ripley")

    response = await client.delete(
        f"/api/v1/users/me/devices/{quote(OTHER_TOKEN, safe='')}", headers=auth_headers(user)
    )
    assert response.status_code == 200


async def test_platform_must_be_one_we_know(
    client: AsyncClient, make_user: MakeUser, auth_headers: Headers
) -> None:
    user = await make_user("ripley")

    response = await client.post(
        "/api/v1/users/me/devices",
        json={"token": TOKEN, "platform": "WINDOWS_PHONE"},
        headers=auth_headers(user),
    )
    assert response.status_code == 422


async def test_deleting_the_member_takes_their_devices(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: Headers,
) -> None:
    """The cascade, asserted rather than assumed.

    An address with nobody at the other end is a way to send a notification to a
    stranger's phone, so this is a security property and not housekeeping.
    """
    user = await make_user("ripley")
    await client.post(
        "/api/v1/users/me/devices",
        json={"token": TOKEN, "platform": "IOS"},
        headers=auth_headers(user),
    )

    await db.execute(sa.delete(User).where(User.id == user.id))
    await db.flush()

    assert await _tokens(db) == []
