"""Backlog lists (SPEC §6.9, §7).

The four lists are statuses on a single row rather than separate tables: a game
occupies at most one status at a time, so changing status is an UPDATE.

That single row is also the app's only record of *when* a list changed, because
SPEC §6.11 asks for status changes in the Home feed and this slice deliberately
adds no events table. `status_changed_at` is what makes that readable: it moves
only when `status` does, so a reorder — which is a very ordinary thing to do to a
list you already own — cannot announce itself to your followers as news. It is
also what the feed's cursor is built on, and a sort key that moved on every
unrelated edit would shuffle rows between pages mid-scroll.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import BacklogStatus

if TYPE_CHECKING:
    from app.models.game import Game
    from app.models.user import User


class BacklogItem(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "backlog_items"

    user_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))
    game_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("games.id", ondelete="CASCADE"))
    status: Mapped[BacklogStatus] = mapped_column(sa.Enum(BacklogStatus, name="backlog_status"))
    position: Mapped[int] = mapped_column(sa.Integer, default=0)
    # Server-defaulted rather than set in Python, so a row written by a fixture,
    # a script or a future bulk import still has a truthful value. See the module
    # docstring for why this is not just `updated_at`.
    status_changed_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
    )

    user: Mapped[User] = relationship()
    game: Mapped[Game] = relationship()

    __table_args__ = (
        sa.UniqueConstraint("user_id", "game_id", name="uq_backlog_items_user_id_game_id"),
        sa.CheckConstraint("position >= 0", name="position_non_negative"),
        sa.Index("ix_backlog_items_user_id_status_position", "user_id", "status", "position"),
        # The feed reads every followee's recent changes at once, newest first, so
        # it seeks on this column and never on one user's list.
        sa.Index("ix_backlog_items_status_changed_at", "status_changed_at"),
    )
