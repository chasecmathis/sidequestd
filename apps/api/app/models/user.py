"""User account and profile-adjacent models (SPEC §7)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.search_keys import search_compact, search_key

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

    # What user search matches against; see app.models.search_keys.
    username_key: Mapped[str] = mapped_column(sa.Text, search_key("username"), deferred=True)
    username_compact: Mapped[str] = mapped_column(
        sa.Text, search_compact("username"), deferred=True
    )
    display_name_key: Mapped[str | None] = mapped_column(
        sa.Text, search_key("display_name"), deferred=True
    )
    display_name_compact: Mapped[str | None] = mapped_column(
        sa.Text, search_compact("display_name"), deferred=True
    )

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
        # User search (SPEC §6.6) matches the normalized keys of either name; see
        # the note on the equivalent indexes over games.search_key. Every branch
        # of the filter needs one: a single unindexed branch turns the planner's
        # BitmapOr into a sequential scan.
        sa.Index(
            "ix_users_username_key_trgm",
            "username_key",
            postgresql_using="gin",
            postgresql_ops={"username_key": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_users_username_compact_trgm",
            "username_compact",
            postgresql_using="gin",
            postgresql_ops={"username_compact": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_users_display_name_key_trgm",
            "display_name_key",
            postgresql_using="gin",
            postgresql_ops={"display_name_key": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_users_display_name_compact_trgm",
            "display_name_compact",
            postgresql_using="gin",
            postgresql_ops={"display_name_compact": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_users_username_key_prefix",
            "username_key",
            postgresql_ops={"username_key": "text_pattern_ops"},
        ),
        sa.Index(
            "ix_users_display_name_key_prefix",
            "display_name_key",
            postgresql_ops={"display_name_key": "text_pattern_ops"},
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
