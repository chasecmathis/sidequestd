"""Authentication and onboarding logic (SPEC §6.1).

Refresh tokens rotate on every use. Each login starts a token *family*; rotating
a token revokes it and links it to its successor. If a token that has already
been rotated is presented again, that means a copy leaked, so the entire family
is revoked and the holder must sign in again.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.email import send_password_reset_email
from app.models.auth import PasswordResetToken, RefreshToken
from app.models.user import User
from app.schemas.auth import RegisterRequest
from app.services.exceptions import (
    EmailTakenError,
    InactiveAccountError,
    InvalidCredentialsError,
    InvalidRefreshTokenError,
    InvalidResetTokenError,
    UsernameTakenError,
)

# A dummy argon2 hash of a random string. Verifying against it when no user
# matches keeps login timing flat, so response time can't be used to enumerate
# which emails and usernames exist.
_DUMMY_PASSWORD_HASH = security.hash_password(security.generate_opaque_token())


@dataclass(frozen=True, slots=True)
class IssuedSession:
    user: User
    access_token: str
    refresh_token: str
    expires_in: int


@dataclass(frozen=True, slots=True)
class ClientInfo:
    """Coarse request provenance recorded against each refresh token."""

    user_agent: str | None = None
    ip_address: str | None = None


# --- Registration ----------------------------------------------------------


async def _username_exists(db: AsyncSession, username: str) -> bool:
    result = await db.execute(select(User.id).where(User.username == username))
    return result.first() is not None


async def _email_exists(db: AsyncSession, email: str) -> bool:
    result = await db.execute(select(User.id).where(User.email == email))
    return result.first() is not None


async def is_username_available(db: AsyncSession, username: str) -> bool:
    return not await _username_exists(db, username.lower())


async def register_user(
    db: AsyncSession, data: RegisterRequest, client: ClientInfo | None = None
) -> IssuedSession:
    username = data.username.lower()
    email = data.email.lower()

    # Checked up front so the user gets a message naming the offending field.
    # The IntegrityError branch below still covers two concurrent signups.
    if await _username_exists(db, username):
        raise UsernameTakenError
    if await _email_exists(db, email):
        raise EmailTakenError

    user = User(
        username=username,
        email=email,
        hashed_password=security.hash_password(data.password),
        display_name=data.display_name,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        constraint = str(getattr(exc.orig, "constraint_name", "")) or str(exc.orig)
        if "email" in constraint:
            raise EmailTakenError from exc
        raise UsernameTakenError from exc

    session = await _issue_session(db, user, client=client)
    await db.commit()
    return session


# --- Login -----------------------------------------------------------------


async def authenticate(db: AsyncSession, identifier: str, password: str) -> User:
    """Resolve an email *or* username plus password to a user."""
    normalised = identifier.strip().lower()
    result = await db.execute(
        select(User).where((User.email == normalised) | (User.username == normalised))
    )
    user = result.scalar_one_or_none()

    if user is None:
        # Spend the same time hashing as the success path would.
        security.verify_password(password, _DUMMY_PASSWORD_HASH)
        raise InvalidCredentialsError

    if not security.verify_password(password, user.hashed_password):
        raise InvalidCredentialsError

    if not user.is_active:
        raise InactiveAccountError

    # Transparently upgrade the stored hash if argon2 parameters have changed.
    if security.password_needs_rehash(user.hashed_password):
        user.hashed_password = security.hash_password(password)
        await db.flush()

    return user


async def login(
    db: AsyncSession, identifier: str, password: str, client: ClientInfo | None = None
) -> IssuedSession:
    user = await authenticate(db, identifier, password)
    session = await _issue_session(db, user, client=client)
    await db.commit()
    return session


# --- Session issuing and rotation -----------------------------------------


async def _issue_session(
    db: AsyncSession,
    user: User,
    *,
    client: ClientInfo | None = None,
    family_id: uuid.UUID | None = None,
) -> IssuedSession:
    raw_refresh = security.generate_opaque_token()
    client = client or ClientInfo()

    refresh_row = RefreshToken(
        user_id=user.id,
        token_hash=security.hash_opaque_token(raw_refresh),
        family_id=family_id or uuid.uuid4(),
        expires_at=datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days),
        user_agent=(client.user_agent or None) and client.user_agent[:512],
        ip_address=client.ip_address,
    )
    db.add(refresh_row)
    await db.flush()

    access = security.create_access_token(user.id)
    return IssuedSession(
        user=user,
        access_token=access.token,
        refresh_token=raw_refresh,
        expires_in=access.expires_in,
    )


async def _load_refresh_token(db: AsyncSession, raw_token: str) -> RefreshToken:
    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == security.hash_opaque_token(raw_token))
    )
    row = result.scalar_one_or_none()
    if row is None:
        raise InvalidRefreshTokenError
    return row


async def _revoke_family(db: AsyncSession, family_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )


async def refresh_session(
    db: AsyncSession, raw_token: str, client: ClientInfo | None = None
) -> IssuedSession:
    row = await _load_refresh_token(db, raw_token)

    if row.revoked_at is not None:
        # Replaying a rotated token means it leaked. Burn the whole lineage.
        await _revoke_family(db, row.family_id)
        await db.commit()
        raise InvalidRefreshTokenError

    if row.expires_at <= datetime.now(UTC):
        raise InvalidRefreshTokenError

    user = await db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise InvalidRefreshTokenError

    session = await _issue_session(db, user, client=client, family_id=row.family_id)

    successor = await db.execute(
        select(RefreshToken.id).where(
            RefreshToken.token_hash == security.hash_opaque_token(session.refresh_token)
        )
    )
    row.revoked_at = datetime.now(UTC)
    row.replaced_by_id = successor.scalar_one()

    await db.commit()
    return session


async def revoke_refresh_token(
    db: AsyncSession, raw_token: str | None, *, all_sessions: bool = False
) -> None:
    """Log out. Unknown or already-revoked tokens are a no-op: logout is
    idempotent and must never report whether a token was real."""
    if raw_token is None:
        return

    result = await db.execute(
        select(RefreshToken).where(RefreshToken.token_hash == security.hash_opaque_token(raw_token))
    )
    row = result.scalar_one_or_none()
    if row is None:
        return

    if all_sessions:
        await db.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == row.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=func.now())
        )
    elif row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)

    await db.commit()


async def revoke_all_sessions_for_user(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=func.now())
    )


# --- Password reset --------------------------------------------------------


async def request_password_reset(db: AsyncSession, email: str) -> None:
    """Always succeeds from the caller's point of view — see the endpoint docstring."""
    result = await db.execute(select(User).where(User.email == email.lower()))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        return

    # Only the newest link should work; invalidate any outstanding ones.
    await db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == user.id, PasswordResetToken.used_at.is_(None))
        .values(used_at=func.now())
    )

    raw_token = security.generate_opaque_token()
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=security.hash_opaque_token(raw_token),
            expires_at=datetime.now(UTC) + timedelta(minutes=settings.password_reset_ttl_minutes),
        )
    )
    await db.commit()

    reset_url = f"{settings.web_app_url.rstrip('/')}/reset-password?token={quote(raw_token)}"
    await send_password_reset_email(to=user.email, username=user.username, reset_url=reset_url)


async def confirm_password_reset(db: AsyncSession, raw_token: str, new_password: str) -> User:
    result = await db.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.token_hash == security.hash_opaque_token(raw_token)
        )
    )
    row = result.scalar_one_or_none()
    if row is None or not row.is_usable:
        raise InvalidResetTokenError

    user = await db.get(User, row.user_id)
    if user is None or not user.is_active:
        raise InvalidResetTokenError

    user.hashed_password = security.hash_password(new_password)
    row.used_at = datetime.now(UTC)

    # A reset is the remedy for a compromised account, so every existing session
    # has to die with it.
    await revoke_all_sessions_for_user(db, user.id)
    await db.commit()
    return user
