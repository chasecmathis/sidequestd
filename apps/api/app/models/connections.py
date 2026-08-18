"""Linked platform accounts and the game libraries synced from them.

A member links the platform they actually play on — Steam, to begin with — and
the app stops having to take their word for how long they played something. That
is the whole point of the slice: `reviews.playtime_minutes` is a self-report, and
a figure the platform itself published is not.

Two tables, and the split matters. `platform_accounts` is the link: who the
member is upstream, and whether the link is healthy. `platform_library_items` is
what that link produced, which is large, entirely derived, and safe to throw away
and rebuild on the next sync. Deleting the link takes the library with it.

Nothing here stores a third-party credential. Steam's OpenID flow returns an
identifier and nothing else — no access token, no refresh token, no scope grant —
so the only secret this feature has is one app-level Web API key that lives in
the environment. That is a deliberate reason to have started with Steam.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.enums import ConnectionProvider, LibraryMatchSource, PlatformSyncStatus

if TYPE_CHECKING:
    from app.models.game import Game
    from app.models.user import User


class PlatformAccount(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """One member's link to one platform."""

    __tablename__ = "platform_accounts"

    user_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("users.id", ondelete="CASCADE"))
    provider: Mapped[ConnectionProvider] = mapped_column(
        sa.Enum(ConnectionProvider, name="connection_provider")
    )
    # SteamID64 for Steam. A string rather than a bigint because it is an opaque
    # identifier from someone else's namespace, and the next provider's will not
    # be numeric at all.
    provider_account_id: Mapped[str] = mapped_column(sa.String(64))

    # Mirrored for display so a profile can render the link without calling out
    # to the platform on every page load. Refreshed by the sync, and allowed to
    # go stale in between — a persona name is not worth a request in the read
    # path, which is the same rule the games catalog follows.
    provider_username: Mapped[str | None] = mapped_column(sa.String(120))
    provider_avatar_url: Mapped[str | None] = mapped_column(sa.Text)
    profile_url: Mapped[str | None] = mapped_column(sa.Text)

    # The member's own switch for whether the link shows on their profile.
    # Separate from `users.is_private`, which gates who may see the profile at
    # all: someone can be happy to be seen and still not want their play habits
    # on display. Hiding it also withdraws the verified badge from their reviews,
    # because the badge is derived from this link rather than stored on them.
    is_visible: Mapped[bool] = mapped_column(sa.Boolean, default=True, server_default=sa.true())

    connected_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    # Null until the first sync finishes. Also the cooldown clock for a manual
    # re-sync, so it is written on every attempt rather than only on success.
    last_synced_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))
    last_sync_status: Mapped[PlatformSyncStatus | None] = mapped_column(
        sa.Enum(PlatformSyncStatus, name="platform_sync_status")
    )

    user: Mapped[User] = relationship()
    library_items: Mapped[list[PlatformLibraryItem]] = relationship(
        back_populates="platform_account",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )

    __table_args__ = (
        # One link per provider per member.
        sa.UniqueConstraint("user_id", "provider", name="uq_platform_accounts_user_id_provider"),
        # And one member per upstream account. This is the constraint the whole
        # verified claim rests on: without it two profiles could link the same
        # Steam library and both wear its hours, which would make the badge
        # evidence of nothing. The API turns the conflict into a 409 rather than
        # letting it surface as a failed write.
        sa.UniqueConstraint(
            "provider", "provider_account_id", name="uq_platform_accounts_provider_account"
        ),
    )


class PlatformLibraryItem(UUIDPrimaryKeyMixin, Base):
    """One game in a synced library, with the platform's own playtime figure."""

    __tablename__ = "platform_library_items"

    platform_account_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("platform_accounts.id", ondelete="CASCADE")
    )
    # Steam appid. Kept even when it resolves to nothing, so a game the catalog
    # has not imported yet starts counting the moment it arrives instead of
    # needing a full re-sync to be noticed.
    provider_game_id: Mapped[str] = mapped_column(sa.String(64))
    provider_title: Mapped[str | None] = mapped_column(sa.String(300))

    game_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.ForeignKey("games.id", ondelete="SET NULL")
    )
    # Null exactly when `game_id` is. Read `EXTERNAL_ID` as "safe to show as
    # verified" and `TITLE` as "close enough to list, not close enough to claim".
    match_source: Mapped[LibraryMatchSource | None] = mapped_column(
        sa.Enum(LibraryMatchSource, name="library_match_source")
    )

    # Minutes, which is the unit Steam reports and the unit
    # `reviews.playtime_minutes` already stores. No conversion anywhere.
    playtime_minutes: Mapped[int] = mapped_column(
        sa.Integer, default=0, server_default=sa.text("0")
    )
    last_played_at: Mapped[datetime | None] = mapped_column(sa.DateTime(timezone=True))

    first_synced_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )
    last_synced_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )

    platform_account: Mapped[PlatformAccount] = relationship(back_populates="library_items")
    game: Mapped[Game | None] = relationship()

    __table_args__ = (
        # The upsert key: a re-sync updates the row for an appid rather than
        # adding a second one.
        sa.UniqueConstraint(
            "platform_account_id",
            "provider_game_id",
            name="uq_platform_library_items_account_game",
        ),
        # The verified badge starts from a game and asks whether this author has
        # it. Partial because an unresolved row can never answer that, and a
        # large share of any real library is unresolved — free-to-play junk,
        # tools, and soundtracks the catalog has no entry for.
        sa.Index(
            "ix_platform_library_items_game_id",
            "game_id",
            postgresql_where=sa.text("game_id IS NOT NULL"),
        ),
        # The profile showcase asks one account for its longest-played games.
        sa.Index(
            "ix_platform_library_items_account_playtime",
            "platform_account_id",
            sa.text("playtime_minutes DESC"),
        ),
        sa.CheckConstraint("playtime_minutes >= 0", name="playtime_minutes_non_negative"),
        # A resolved row has to say how it resolved: `match_source` is what the
        # badge consults to decide whether a match is exact enough to show as
        # verified, and a match that never said would have to be either trusted
        # blindly or silently dropped.
        #
        # Deliberately one-directional. The symmetric form — `(game_id IS NULL) =
        # (match_source IS NULL)` — cannot coexist with `ON DELETE SET NULL` on
        # `game_id`: dropping a game nulls the id, leaves the source behind, and
        # the delete fails on its own constraint. That would make a catalog
        # re-import impossible for as long as one member had a linked library.
        # The residue it permits is a source with no id, which every reader
        # ignores because they all start from `game_id`.
        sa.CheckConstraint(
            "game_id IS NULL OR match_source IS NOT NULL",
            name="match_source_accompanies_game",
        ),
    )
