"""Request/response bodies for the auth endpoints (SPEC §6.1, §8)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator

from app.core.config import settings
from app.schemas.user import DisplayName, UserMe, Username, validate_username

# The upper bound matches argon2's practical input limit and blocks a trivially
# cheap DoS via multi-megabyte passwords.
Password = Annotated[str, StringConstraints(min_length=1, max_length=128)]


def _validate_password_strength(value: str) -> str:
    if len(value) < settings.min_password_length:
        raise ValueError(
            f"Password must be at least {settings.min_password_length} characters long."
        )
    return value


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: Username = Field(description="Unique public handle")
    email: EmailStr = Field(description="Unique, private")
    password: Password
    display_name: DisplayName | None = None

    @field_validator("username")
    @classmethod
    def _check_username(cls, value: str) -> str:
        return validate_username(value)

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, value: str) -> str:
        return value.lower()

    @field_validator("password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return _validate_password_strength(value)


class LoginRequest(BaseModel):
    """SPEC §6.1 allows signing in with either the email or the username."""

    model_config = ConfigDict(extra="forbid")

    identifier: Annotated[str, StringConstraints(min_length=1, max_length=320)] = Field(
        description="Email address or username"
    )
    password: Password


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str | None = Field(
        default=None,
        description=(
            "Native clients send the refresh token here. The web client omits it and "
            "relies on the httpOnly cookie set at login."
        ),
    )


class LogoutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    refresh_token: str | None = None
    all_sessions: bool = Field(
        default=False, description="Revoke every refresh token for this user, not just this one."
    )


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - scheme name, not a secret
    expires_in: int = Field(description="Access token lifetime in seconds")


class AuthSession(TokenPair):
    """What register / login / refresh return: tokens plus the signed-in user."""

    user: UserMe


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr

    @field_validator("email")
    @classmethod
    def _normalise_email(cls, value: str) -> str:
        return value.lower()


class PasswordResetConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: Annotated[str, StringConstraints(min_length=16, max_length=512)]
    new_password: Password

    @field_validator("new_password")
    @classmethod
    def _check_password(cls, value: str) -> str:
        return _validate_password_strength(value)


class MessageResponse(BaseModel):
    detail: str
