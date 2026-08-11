"""User account and profile-adjacent models (SPEC §7)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.auth import PasswordResetToken, RefreshToken
    from app.models.game import Game

# Handles and emails are stored lower-cased on write, so a plain unique index is
# sufficient for the case-insensitive uniqueness required by SPEC §6.1.
USERNAME_MAX_LENGTH = 30
DISPLAY_NAME_MAX_LENGTH = 50
BIO_MAX_LENGTH = 300

# SPEC §6.2 calls favorites "a short pinned/curated list". Capped so the profile
# header stays one row on a phone and the list keeps meaning something.
MAX_FAVORITE_GAMES = 6


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    username: Mapped[str] = mapped_column(sa.String(USERNAME_MAX_LENGTH), unique=True)
    email: Mapped[str] = mapped_column(sa.String(320), unique=True)
    hashed_password: Mapped[str] = mapped_column(sa.String(255))

    display_name: Mapped[str | None] = mapped_column(sa.String(DISPLAY_NAME_MAX_LENGTH))
    bio: Mapped[str | None] = mapped_column(sa.String(BIO_MAX_LENGTH))
    avatar_url: Mapped[str | None] = mapped_column(sa.Text)

    is_private: Mapped[bool] = mapped_column(sa.Boolean, default=False, server_default=sa.false())
    is_active: Mapped[bool] = mapped_column(sa.Boolean, default=True, server_default=sa.true())
    email_verified_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    refresh_tokens: Mapped[list[RefreshToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    password_reset_tokens: Mapped[list[PasswordResetToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    favorite_games: Mapped[list[FavoriteGame]] = relationship(
        back_populates="user", cascade="all, delete-orphan", order_by="FavoriteGame.position"
    )

    __table_args__ = (
        sa.CheckConstraint("username = lower(username)", name="username_is_lowercase"),
        sa.CheckConstraint("email = lower(email)", name="email_is_lowercase"),
        sa.CheckConstraint("char_length(username) >= 3", name="username_min_length"),
        # User search (SPEC §6.6) matches substrings of either name; see the note
        # on the equivalent index over games.title.
        sa.Index(
            "ix_users_username_trgm",
            "username",
            postgresql_using="gin",
            postgresql_ops={"username": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_users_display_name_trgm",
            "display_name",
            postgresql_using="gin",
            postgresql_ops={"display_name": "gin_trgm_ops"},
        ),
    )

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<User {self.username}>"


class FavoriteGame(CreatedAtMixin, Base):
    """Curated, ordered games pinned to a profile (SPEC §6.2, §7)."""

    __tablename__ = "favorite_games"

    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    game_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("games.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(sa.Integer, default=0)

    user: Mapped[User] = relationship(back_populates="favorite_games")
    game: Mapped[Game] = relationship()

    __table_args__ = (sa.CheckConstraint("position >= 0", name="position_non_negative"),)
