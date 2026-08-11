"""Registration — SPEC §6.1."""

from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import verify_password
from app.models.user import User
from tests.conftest import TEST_PASSWORD


async def test_register_returns_session_and_user(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    response = await client.post("/api/v1/auth/register", json=registration_payload)

    assert response.status_code == 201
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["expires_in"] == settings.access_token_ttl_minutes * 60
    assert body["user"]["username"] == "ripley"
    assert body["user"]["email"] == "ripley@example.com"
    assert body["user"]["display_name"] == "Ellen Ripley"
    assert body["user"]["is_private"] is False


async def test_register_sets_httponly_refresh_cookie(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    response = await client.post("/api/v1/auth/register", json=registration_payload)

    cookie = response.cookies.get(settings.refresh_cookie_name)
    assert cookie == response.json()["refresh_token"]

    set_cookie = response.headers["set-cookie"]
    assert "HttpOnly" in set_cookie
    assert "Path=/api/v1/auth" in set_cookie


async def test_password_is_hashed_and_never_returned(
    client: AsyncClient, db: AsyncSession, registration_payload: dict[str, str]
) -> None:
    response = await client.post("/api/v1/auth/register", json=registration_payload)

    assert "password" not in response.text
    assert "hashed_password" not in response.json()["user"]

    user = (await db.execute(select(User).where(User.username == "ripley"))).scalar_one()
    assert user.hashed_password != TEST_PASSWORD
    assert user.hashed_password.startswith("$argon2")
    assert verify_password(TEST_PASSWORD, user.hashed_password)


async def test_username_is_normalised_to_lowercase(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={**registration_payload, "username": "RiPLeY", "email": "MiXeD@Example.COM"},
    )

    assert response.status_code == 201
    assert response.json()["user"]["username"] == "ripley"
    assert response.json()["user"]["email"] == "mixed@example.com"


async def test_duplicate_username_is_rejected_with_field(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    await client.post("/api/v1/auth/register", json=registration_payload)

    response = await client.post(
        "/api/v1/auth/register",
        json={**registration_payload, "email": "someone.else@example.com"},
    )

    assert response.status_code == 409
    assert response.json()["field"] == "username"
    assert "username" in response.json()["detail"].lower()


async def test_duplicate_username_is_case_insensitive(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    await client.post("/api/v1/auth/register", json=registration_payload)

    response = await client.post(
        "/api/v1/auth/register",
        json={**registration_payload, "username": "RIPLEY", "email": "other@example.com"},
    )

    assert response.status_code == 409
    assert response.json()["field"] == "username"


async def test_duplicate_email_is_rejected_with_field(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    await client.post("/api/v1/auth/register", json=registration_payload)

    response = await client.post(
        "/api/v1/auth/register",
        json={**registration_payload, "username": "newt"},
    )

    assert response.status_code == 409
    assert response.json()["field"] == "email"
    assert "email" in response.json()["detail"].lower()


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("username", "ab"),  # shorter than 3
        ("username", "has spaces"),
        ("username", "trailing."),
        ("username", "double..dot"),
        ("username", "sym$bol"),
        ("email", "not-an-email"),
        ("password", "short"),
        ("display_name", ""),
    ],
)
async def test_invalid_input_is_rejected(
    client: AsyncClient, registration_payload: dict[str, str], field: str, value: str
) -> None:
    response = await client.post(
        "/api/v1/auth/register", json={**registration_payload, field: value}
    )

    assert response.status_code == 422, f"{field}={value!r} should not be accepted"


async def test_password_below_minimum_length_is_rejected(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    response = await client.post(
        "/api/v1/auth/register",
        json={**registration_payload, "password": "a" * (settings.min_password_length - 1)},
    )

    assert response.status_code == 422
    assert str(settings.min_password_length) in response.text


async def test_unknown_fields_are_rejected(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    response = await client.post(
        "/api/v1/auth/register", json={**registration_payload, "is_private": True}
    )

    assert response.status_code == 422


async def test_username_availability_endpoint(
    client: AsyncClient, registration_payload: dict[str, str]
) -> None:
    free = await client.get("/api/v1/users/username-available", params={"username": "newt"})
    assert free.json() == {"username": "newt", "available": True}

    await client.post("/api/v1/auth/register", json=registration_payload)

    taken = await client.get("/api/v1/users/username-available", params={"username": "RIPLEY"})
    assert taken.json() == {"username": "ripley", "available": False}
