"""Reviews and the interactions attached to them (SPEC §6.3, §6.10, §7)."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import MediaType, ProcessingStatus

if TYPE_CHECKING:
    from app.models.game import Game
    from app.models.user import User

# SPEC §6.3: 5 stars in half-star stops, stored as a 0-10 integer.
MIN_RATING = 1
MAX_RATING = 10
MAX_MEDIA_PER_REVIEW = 10
COMMENT_MAX_LENGTH = 500
REVIEW_TEXT_MAX_LENGTH = 5000


class Review(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "reviews"

    user_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))
    game_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("games.id", ondelete="CASCADE"))
    rating: Mapped[int] = mapped_column(sa.SmallInteger)
    review_text: Mapped[str | None] = mapped_column(sa.String(REVIEW_TEXT_MAX_LENGTH))
    playtime_minutes: Mapped[int | None] = mapped_column(sa.Integer)

    author: Mapped[User] = relationship()
    game: Mapped[Game] = relationship()
    media: Mapped[list[ReviewMedia]] = relationship(
        back_populates="review", cascade="all, delete-orphan", order_by="ReviewMedia.position"
    )
    comments: Mapped[list[Comment]] = relationship(
        back_populates="review", cascade="all, delete-orphan"
    )
    likes: Mapped[list[Like]] = relationship(back_populates="review", cascade="all, delete-orphan")

    __table_args__ = (
        # SPEC §6.3: one review per user per game.
        sa.UniqueConstraint("user_id", "game_id", name="uq_reviews_user_id_game_id"),
        sa.CheckConstraint(f"rating BETWEEN {MIN_RATING} AND {MAX_RATING}", name="rating_in_range"),
        sa.CheckConstraint(
            "playtime_minutes IS NULL OR playtime_minutes >= 0", name="playtime_non_negative"
        ),
        # Profile grids and the feed both page by author/newest-first.
        sa.Index("ix_reviews_user_id_created_at", "user_id", sa.text("created_at DESC")),
        sa.Index("ix_reviews_game_id_created_at", "game_id", sa.text("created_at DESC")),
    )


class ReviewMedia(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "review_media"

    review_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("reviews.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[MediaType] = mapped_column(sa.Enum(MediaType, name="media_type"))
    url: Mapped[str] = mapped_column(sa.Text)
    thumbnail_url: Mapped[str | None] = mapped_column(sa.Text)
    width: Mapped[int | None] = mapped_column(sa.Integer)
    height: Mapped[int | None] = mapped_column(sa.Integer)
    duration_seconds: Mapped[float | None] = mapped_column(sa.Float)
    alt_text: Mapped[str | None] = mapped_column(sa.String(500))
    position: Mapped[int] = mapped_column(sa.Integer, default=0)
    processing_status: Mapped[ProcessingStatus] = mapped_column(
        sa.Enum(ProcessingStatus, name="processing_status"),
        default=ProcessingStatus.PENDING,
        server_default=ProcessingStatus.PENDING.value,
    )

    review: Mapped[Review] = relationship(back_populates="media")

    __table_args__ = (
        sa.CheckConstraint(
            f"position >= 0 AND position < {MAX_MEDIA_PER_REVIEW}", name="position_in_range"
        ),
        sa.UniqueConstraint("review_id", "position", name="uq_review_media_review_id_position"),
    )


class Like(CreatedAtMixin, Base):
    __tablename__ = "likes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    review_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("reviews.id", ondelete="CASCADE"), primary_key=True
    )

    user: Mapped[User] = relationship()
    review: Mapped[Review] = relationship(back_populates="likes")

    __table_args__ = (sa.Index("ix_likes_review_id_created_at", "review_id", "created_at"),)


class Comment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One level of threading is enough for MVP (SPEC §6.10)."""

    __tablename__ = "comments"

    review_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("reviews.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))
    parent_comment_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("comments.id", ondelete="CASCADE")
    )
    text: Mapped[str] = mapped_column(sa.String(COMMENT_MAX_LENGTH))

    review: Mapped[Review] = relationship(back_populates="comments")
    author: Mapped[User] = relationship()
    replies: Mapped[list[Comment]] = relationship(
        back_populates="parent", cascade="all, delete-orphan"
    )
    parent: Mapped[Comment | None] = relationship(
        back_populates="replies", remote_side="Comment.id"
    )

    __table_args__ = (
        sa.CheckConstraint("char_length(text) BETWEEN 1 AND 500", name="text_length"),
        sa.Index("ix_comments_review_id_created_at", "review_id", "created_at"),
    )
