"""Follow graph (SPEC §6.7, §7)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin
from app.models.enums import FollowStatus

if TYPE_CHECKING:
    from app.models.user import User


class Follow(CreatedAtMixin, Base):
    """Directed follow edge. PENDING for private targets, ACCEPTED otherwise."""

    __tablename__ = "follows"

    follower_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    followee_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    status: Mapped[FollowStatus] = mapped_column(sa.Enum(FollowStatus, name="follow_status"))
    responded_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    follower: Mapped[User] = relationship(foreign_keys=[follower_id])
    followee: Mapped[User] = relationship(foreign_keys=[followee_id])

    __table_args__ = (
        sa.CheckConstraint("follower_id <> followee_id", name="no_self_follow"),
        # Feed and follower-list queries read the edge from both directions.
        sa.Index("ix_follows_followee_id_status", "followee_id", "status"),
        sa.Index("ix_follows_follower_id_status", "follower_id", "status"),
    )
