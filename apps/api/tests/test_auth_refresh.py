"""Refresh-token rotation, expiry and reuse detection — SPEC §6.1, §9."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_opaque_token
from app.models.auth import RefreshToken
from tests.conftest import TEST_PASSWORD


async def test_refresh_issues_a_new_pair_from_the_body(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": registered_user["refresh_token"]}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["refresh_token"] != registered_user["refresh_token"], "token must rotate"
    assert body["user"]["username"] == "ripley"


async def test_refresh_falls_back_to_the_cookie(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    """The web client sends no body token — only the cookie set at login."""
    assert client.cookies.get(settings.refresh_cookie_name)

    response = await client.post("/api/v1/auth/refresh", json={})

    assert response.status_code == 200, response.text
    assert response.json()["access_token"]


async def test_refresh_without_any_token_is_rejected(client: AsyncClient) -> None:
    response = await client.post("/api/v1/auth/refresh", json={})

    assert response.status_code == 401


async def test_rotated_token_stays_in_the_same_family(
    client: AsyncClient, db: AsyncSession, registered_user: dict[str, object]
) -> None:
    await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": registered_user["refresh_token"]}
    )

    rows = (await db.execute(select(RefreshToken))).scalars().all()
    assert len({row.family_id for row in rows}) == 1

    original = next(
        row
        for row in rows
        if row.token_hash == hash_opaque_token(str(registered_user["refresh_token"]))
    )
    assert original.revoked_at is not None
    assert original.replaced_by_id is not None


async def test_replaying_a_rotated_token_revokes_the_whole_family(
    client: AsyncClient, db: AsyncSession, registered_user: dict[str, object]
) -> None:
    """The stolen-token case: an attacker replays a token the real client already
    rotated, so both of them get logged out (SPEC §9 revocation)."""
    rotated = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": registered_user["refresh_token"]}
    )
    live_token = rotated.json()["refresh_token"]

    replay = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": registered_user["refresh_token"]}
    )
    assert replay.status_code == 401

    # The token the honest client still holds is dead too.
    follow_up = await client.post("/api/v1/auth/refresh", json={"refresh_token": live_token})
    assert follow_up.status_code == 401

    live = (
        (await db.execute(select(RefreshToken).where(RefreshToken.revoked_at.is_(None))))
        .scalars()
        .all()
    )
    assert live == []


async def test_expired_refresh_token_is_rejected(
    client: AsyncClient, db: AsyncSession, registered_user: dict[str, object]
) -> None:
    row = (
        await db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == hash_opaque_token(str(registered_user["refresh_token"]))
            )
        )
    ).scalar_one()
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.commit()

    response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": registered_user["refresh_token"]}
    )

    assert response.status_code == 401


async def test_failed_refresh_clears_the_cookie(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    response = await client.post("/api/v1/auth/refresh", json={"refresh_token": "bogus"})

    assert response.status_code == 401
    assert not client.cookies.get(settings.refresh_cookie_name)


async def test_refreshing_does_not_invalidate_other_sessions(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    """Signing in on a phone must not log you out of the web app."""
    other = await client.post(
        "/api/v1/auth/login", json={"identifier": "ripley", "password": TEST_PASSWORD}
    )
    other_refresh = other.json()["refresh_token"]

    await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": registered_user["refresh_token"]}
    )

    still_valid = await client.post("/api/v1/auth/refresh", json={"refresh_token": other_refresh})
    assert still_valid.status_code == 200
