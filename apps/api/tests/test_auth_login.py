"""Login, the bearer-token dependency, and logout — SPEC §6.1."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auth import RefreshToken
from app.models.user import User
from tests.conftest import TEST_PASSWORD


@pytest.mark.parametrize("identifier", ["ripley@example.com", "ripley", "RIPLEY@EXAMPLE.COM"])
async def test_login_accepts_email_or_username(
    client: AsyncClient, registered_user: dict[str, object], identifier: str
) -> None:
    response = await client.post(
        "/api/v1/auth/login", json={"identifier": identifier, "password": TEST_PASSWORD}
    )

    assert response.status_code == 200, response.text
    assert response.json()["user"]["username"] == "ripley"
    assert response.json()["access_token"]


async def test_login_with_wrong_password_is_rejected(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    response = await client.post(
        "/api/v1/auth/login", json={"identifier": "ripley", "password": "wrong-password-entirely"}
    )

    assert response.status_code == 401


async def test_login_error_does_not_reveal_whether_the_account_exists(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    wrong_password = await client.post(
        "/api/v1/auth/login", json={"identifier": "ripley", "password": "wrong-password-entirely"}
    )
    no_such_user = await client.post(
        "/api/v1/auth/login", json={"identifier": "nobody", "password": "wrong-password-entirely"}
    )

    assert wrong_password.status_code == no_such_user.status_code == 401
    assert wrong_password.json() == no_such_user.json()


async def test_login_is_rejected_for_deactivated_account(
    client: AsyncClient, db: AsyncSession, registered_user: dict[str, object]
) -> None:
    user = (await db.execute(select(User).where(User.username == "ripley"))).scalar_one()
    user.is_active = False
    await db.commit()

    response = await client.post(
        "/api/v1/auth/login", json={"identifier": "ripley", "password": TEST_PASSWORD}
    )

    assert response.status_code == 403


async def test_each_login_starts_its_own_token_family(
    client: AsyncClient, db: AsyncSession, registered_user: dict[str, object]
) -> None:
    await client.post(
        "/api/v1/auth/login", json={"identifier": "ripley", "password": TEST_PASSWORD}
    )

    families = (await db.execute(select(RefreshToken.family_id))).scalars().all()
    assert len(set(families)) == 2, "registration and login should not share a family"


# --- Authenticated requests -------------------------------------------------


async def test_me_returns_the_signed_in_user(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    response = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {registered_user['access_token']}"},
    )

    assert response.status_code == 200
    assert response.json()["username"] == "ripley"
    assert response.json()["email"] == "ripley@example.com"
    assert "hashed_password" not in response.json()


async def test_me_requires_a_token(client: AsyncClient) -> None:
    response = await client.get("/api/v1/users/me")

    assert response.status_code == 401


@pytest.mark.parametrize(
    "header",
    [
        "Bearer not-a-jwt",
        "Bearer ",
        "Basic ripley:password",
        "eyJhbGciOiJIUzI1NiJ9.e30.badsignature",
    ],
)
async def test_me_rejects_malformed_credentials(client: AsyncClient, header: str) -> None:
    response = await client.get("/api/v1/users/me", headers={"Authorization": header})

    assert response.status_code == 401


async def test_me_rejects_a_refresh_token_used_as_a_bearer_token(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    """Refresh tokens are opaque and must not be accepted where a JWT is expected."""
    response = await client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {registered_user['refresh_token']}"},
    )

    assert response.status_code == 401


# --- Logout -----------------------------------------------------------------


async def test_logout_revokes_the_refresh_token_and_clears_the_cookie(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    response = await client.post("/api/v1/auth/logout", json={})

    assert response.status_code == 200
    assert not client.cookies.get(settings.refresh_cookie_name)

    replay = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": registered_user["refresh_token"]}
    )
    assert replay.status_code == 401


async def test_logout_is_idempotent(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    first = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": registered_user["refresh_token"]}
    )
    second = await client.post(
        "/api/v1/auth/logout", json={"refresh_token": registered_user["refresh_token"]}
    )

    assert first.status_code == second.status_code == 200


async def test_logout_with_unknown_token_still_succeeds(client: AsyncClient) -> None:
    response = await client.post("/api/v1/auth/logout", json={"refresh_token": "not-a-real-token"})

    assert response.status_code == 200


async def test_logout_all_sessions_revokes_every_token(
    client: AsyncClient, db: AsyncSession, registered_user: dict[str, object]
) -> None:
    second = await client.post(
        "/api/v1/auth/login", json={"identifier": "ripley", "password": TEST_PASSWORD}
    )
    second_refresh = second.json()["refresh_token"]

    await client.post(
        "/api/v1/auth/logout",
        json={"refresh_token": registered_user["refresh_token"], "all_sessions": True},
    )

    live = (
        (await db.execute(select(RefreshToken).where(RefreshToken.revoked_at.is_(None))))
        .scalars()
        .all()
    )
    assert live == []

    replay = await client.post("/api/v1/auth/refresh", json={"refresh_token": second_refresh})
    assert replay.status_code == 401
