"""Password hashing, JWT access tokens, and opaque refresh/reset token helpers.

Design notes (SPEC §6.1, §9):
- Passwords use argon2id and are never returned by the API.
- Access tokens are short-lived signed JWTs; they are not revocable by design.
- Refresh and password-reset tokens are opaque random strings. Only their SHA-256
  digest is persisted, so a database leak does not yield usable tokens, and rows
  can be revoked individually — the "refresh + revocation" requirement in §9.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Final

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import settings

_hasher = PasswordHasher()

TOKEN_TYPE_ACCESS: Final = "access"  # noqa: S105 - JWT claim value, not a secret
_OPAQUE_TOKEN_BYTES: Final = 48


# --- Passwords -------------------------------------------------------------


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    """True when argon2 parameters have been tightened since this hash was made."""
    try:
        return _hasher.check_needs_rehash(password_hash)
    except InvalidHashError:
        return True


# --- Access tokens (JWT) ---------------------------------------------------


@dataclass(frozen=True, slots=True)
class AccessToken:
    token: str
    expires_at: datetime
    expires_in: int


def create_access_token(subject: uuid.UUID, *, now: datetime | None = None) -> AccessToken:
    issued_at = now or datetime.now(UTC)
    expires_at = issued_at + timedelta(minutes=settings.access_token_ttl_minutes)
    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": TOKEN_TYPE_ACCESS,
        "jti": uuid.uuid4().hex,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)
    return AccessToken(
        token=token,
        expires_at=expires_at,
        expires_in=settings.access_token_ttl_minutes * 60,
    )


class InvalidTokenError(Exception):
    """Raised when an access token is malformed, expired, or of the wrong type."""


def decode_access_token(token: str) -> uuid.UUID:
    """Return the subject of a valid access token, or raise InvalidTokenError."""
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc

    if payload.get("type") != TOKEN_TYPE_ACCESS:
        raise InvalidTokenError("wrong token type")

    try:
        return uuid.UUID(payload["sub"])
    except (KeyError, ValueError) as exc:
        raise InvalidTokenError("malformed subject") from exc


# --- Opaque tokens (refresh, password reset) -------------------------------


def generate_opaque_token() -> str:
    """A high-entropy, URL-safe secret handed to the client exactly once."""
    return secrets.token_urlsafe(_OPAQUE_TOKEN_BYTES)


def hash_opaque_token(token: str) -> str:
    """SHA-256 is the right primitive here: the input is already 384 bits of entropy,
    so it needs no key stretching, and lookups must be by exact digest."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def tokens_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)
