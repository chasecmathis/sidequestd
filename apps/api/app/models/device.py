"""Where a push notification is delivered (SPEC §6.12, §7).

One row per installed app that has been granted the permission. The token is the
address — an `ExponentPushToken[…]` string the Expo push service resolves to an
APNs or FCM registration — and it is the only thing here that matters; the
platform and the timestamps exist to make the table debuggable rather than to
route anything.

Three properties are load-bearing, and each of them is a bug that a device table
without it eventually has:

* **The token is globally unique, not unique per member.** A phone that signs
  out and a colleague signs in on keeps the same token, and if the row were keyed
  on `(user_id, token)` the device would end up addressed by two accounts at
  once — one of whom would be reading the other's notifications on a lock screen.
  Registering an existing token therefore *moves* it to the caller.
* **`last_seen_at` is written on every registration.** Expo's tokens do not
  expire on a clock, but the ones that stop working stop working silently, and
  the age of a row is the only signal available for sweeping a table that
  otherwise grows for ever.
* **Deleting the member deletes the row.** Cascade rather than a nullable
  `user_id`: an address with nobody at the other end is not a device, it is a
  way to send somebody else's notification to a stranger's phone.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDPrimaryKeyMixin
from app.models.enums import DevicePlatform

if TYPE_CHECKING:
    from app.models.user import User


class DeviceToken(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "device_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))

    # `ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]` is 41 characters today, and the
    # column is sized for the raw APNs/FCM strings the same endpoint accepts —
    # an FCM registration token runs past 160. Text would do; a bound is here so
    # a client that posts a whole JWT by mistake is refused by the database
    # rather than stored.
    token: Mapped[str] = mapped_column(sa.String(512))
    platform: Mapped[DevicePlatform] = mapped_column(
        sa.Enum(DevicePlatform, name="device_platform")
    )

    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    # Bumped by every registration, which the client does on each cold start —
    # so this is "when this app was last opened by someone signed in", which is
    # the closest thing to liveness available without sending a probe.
    last_seen_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )

    user: Mapped[User] = relationship()

    __table_args__ = (
        # See the note above: one device, one owner, and re-registering hands it
        # over rather than duplicating it.
        sa.UniqueConstraint("token", name="uq_device_tokens_token"),
        # The send path starts from a recipient and asks for their addresses.
        sa.Index("ix_device_tokens_user_id", "user_id"),
    )
