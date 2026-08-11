"""Password reset — SPEC §6.1."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import PasswordResetToken
from tests.conftest import TEST_PASSWORD, SentEmail

NEW_PASSWORD = "a-brand-new-passphrase"


async def test_reset_request_emails_a_link(
    client: AsyncClient, registered_user: dict[str, object], outbox: list[SentEmail]
) -> None:
    response = await client.post(
        "/api/v1/auth/password-reset", json={"email": "ripley@example.com"}
    )

    assert response.status_code == 202
    assert len(outbox) == 1
    assert outbox[0].to == "ripley@example.com"
    assert outbox[0].reset_url.startswith("http://localhost:3000/reset-password?token=")


async def test_reset_request_for_unknown_email_looks_identical(
    client: AsyncClient, registered_user: dict[str, object], outbox: list[SentEmail]
) -> None:
    """Must not disclose which addresses have accounts (SPEC §9)."""
    known = await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})
    unknown = await client.post("/api/v1/auth/password-reset", json={"email": "who@example.com"})

    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert [email.to for email in outbox] == ["ripley@example.com"]


async def test_reset_token_is_stored_hashed(
    client: AsyncClient,
    db: AsyncSession,
    registered_user: dict[str, object],
    outbox: list[SentEmail],
) -> None:
    await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})

    row = (await db.execute(select(PasswordResetToken))).scalar_one()
    assert row.token_hash != outbox[0].token
    assert len(row.token_hash) == 64


async def test_confirm_sets_the_new_password(
    client: AsyncClient, registered_user: dict[str, object], outbox: list[SentEmail]
) -> None:
    await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})

    confirm = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": outbox[0].token, "new_password": NEW_PASSWORD},
    )
    assert confirm.status_code == 200

    with_new = await client.post(
        "/api/v1/auth/login", json={"identifier": "ripley", "password": NEW_PASSWORD}
    )
    assert with_new.status_code == 200

    with_old = await client.post(
        "/api/v1/auth/login", json={"identifier": "ripley", "password": TEST_PASSWORD}
    )
    assert with_old.status_code == 401


async def test_confirm_revokes_every_existing_session(
    client: AsyncClient, registered_user: dict[str, object], outbox: list[SentEmail]
) -> None:
    """A reset is what you do when your account is compromised, so the attacker's
    session has to die with it."""
    await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})
    await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": outbox[0].token, "new_password": NEW_PASSWORD},
    )

    response = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": registered_user["refresh_token"]}
    )
    assert response.status_code == 401


async def test_reset_token_is_single_use(
    client: AsyncClient, registered_user: dict[str, object], outbox: list[SentEmail]
) -> None:
    await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})
    token = outbox[0].token

    first = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": token, "new_password": NEW_PASSWORD},
    )
    second = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": token, "new_password": "yet-another-passphrase"},
    )

    assert first.status_code == 200
    assert second.status_code == 400


async def test_requesting_again_invalidates_the_previous_link(
    client: AsyncClient, registered_user: dict[str, object], outbox: list[SentEmail]
) -> None:
    await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})
    await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})
    first_token, second_token = outbox[0].token, outbox[1].token

    stale = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": first_token, "new_password": NEW_PASSWORD},
    )
    assert stale.status_code == 400

    current = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": second_token, "new_password": NEW_PASSWORD},
    )
    assert current.status_code == 200


async def test_expired_reset_token_is_rejected(
    client: AsyncClient,
    db: AsyncSession,
    registered_user: dict[str, object],
    outbox: list[SentEmail],
) -> None:
    await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})

    row = (await db.execute(select(PasswordResetToken))).scalar_one()
    row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.commit()

    response = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": outbox[0].token, "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 400


async def test_unknown_reset_token_is_rejected(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": "x" * 64, "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 400


async def test_confirm_enforces_password_policy(
    client: AsyncClient, registered_user: dict[str, object], outbox: list[SentEmail]
) -> None:
    await client.post("/api/v1/auth/password-reset", json={"email": "ripley@example.com"})

    response = await client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": outbox[0].token, "new_password": "short"},
    )

    assert response.status_code == 422
