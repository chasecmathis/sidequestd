"""In-app notifications (SPEC §6.12, §7)."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, CreatedAtMixin, UUIDPrimaryKeyMixin
from app.models.enums import NotificationType

if TYPE_CHECKING:
    from app.models.review import Comment, Review
    from app.models.user import User


class Notification(UUIDPrimaryKeyMixin, CreatedAtMixin, Base):
    __tablename__ = "notifications"

    recipient_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("users.id", ondelete="CASCADE")
    )
    type: Mapped[NotificationType] = mapped_column(
        sa.Enum(NotificationType, name="notification_type")
    )

    # Nullable target refs — which one is populated depends on `type`.
    review_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("reviews.id", ondelete="CASCADE")
    )
    comment_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("comments.id", ondelete="CASCADE")
    )

    is_read: Mapped[bool] = mapped_column(sa.Boolean, default=False, server_default=sa.false())

    recipient: Mapped[User] = relationship(foreign_keys=[recipient_id])
    actor: Mapped[User | None] = relationship(foreign_keys=[actor_id])

    # One-directional and eager-loaded by the list query rather than lazily here:
    # a notification needs its target to say what it is about ("liked your review
    # of *Hades*"), but a review has no reason to know how many notifications it
    # caused. No back_populates, so nothing is added to `Review` or `Comment`.
    review: Mapped[Review | None] = relationship()
    comment: Mapped[Comment | None] = relationship()

    __table_args__ = (
        sa.Index(
            "ix_notifications_recipient_id_created_at", "recipient_id", sa.text("created_at DESC")
        ),
        # Backs the unread badge count without scanning the whole inbox.
        sa.Index(
            "ix_notifications_recipient_id_unread",
            "recipient_id",
            postgresql_where=sa.text("is_read = false"),
        ),
    )
