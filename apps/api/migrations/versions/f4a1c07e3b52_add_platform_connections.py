"""add platform account links and synced libraries

The link a member makes to the platform they actually play on, and the library
that link produces. Together with `game_external_ids` these are what let a review
carry a playtime figure the platform published rather than one the author typed.

Both tables start empty, and nothing reads them until a member links an account,
so there is nothing to backfill.

Note the two unique constraints on `platform_accounts`. One member per provider
is the obvious one. One *provider account* per member is the load-bearing one:
without it two profiles could link the same Steam library and both display its
hours as verified, which would make the badge evidence of nothing.

Revision ID: f4a1c07e3b52
Revises: e2b7c41d9a83
Create Date: 2026-08-17 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "f4a1c07e3b52"
down_revision: str | None = "e2b7c41d9a83"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "platform_accounts",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("provider", sa.Enum("STEAM", name="connection_provider"), nullable=False),
        sa.Column("provider_account_id", sa.String(length=64), nullable=False),
        sa.Column("provider_username", sa.String(length=120), nullable=True),
        sa.Column("provider_avatar_url", sa.Text(), nullable=True),
        sa.Column("profile_url", sa.Text(), nullable=True),
        sa.Column("is_visible", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column(
            "connected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "last_sync_status",
            sa.Enum("OK", "PROFILE_PRIVATE", "FAILED", name="platform_sync_status"),
            nullable=True,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_platform_accounts_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_platform_accounts")),
        sa.UniqueConstraint("user_id", "provider", name="uq_platform_accounts_user_id_provider"),
        sa.UniqueConstraint(
            "provider", "provider_account_id", name="uq_platform_accounts_provider_account"
        ),
    )

    op.create_table(
        "platform_library_items",
        sa.Column("platform_account_id", sa.Uuid(), nullable=False),
        sa.Column("provider_game_id", sa.String(length=64), nullable=False),
        sa.Column("provider_title", sa.String(length=300), nullable=True),
        sa.Column("game_id", sa.Uuid(), nullable=True),
        sa.Column(
            "match_source",
            sa.Enum("EXTERNAL_ID", "TITLE", name="library_match_source"),
            nullable=True,
        ),
        sa.Column("playtime_minutes", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_played_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "first_synced_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_synced_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.CheckConstraint(
            "playtime_minutes >= 0",
            name=op.f("ck_platform_library_items_playtime_minutes_non_negative"),
        ),
        # One-directional on purpose: a resolved row must say how it resolved,
        # but the reverse cannot be required alongside `ON DELETE SET NULL` on
        # game_id — dropping a game would then fail on this very constraint and
        # a catalog re-import would be impossible once anyone had a library.
        sa.CheckConstraint(
            "game_id IS NULL OR match_source IS NOT NULL",
            name=op.f("ck_platform_library_items_match_source_accompanies_game"),
        ),
        sa.ForeignKeyConstraint(
            ["platform_account_id"],
            ["platform_accounts.id"],
            name=op.f("fk_platform_library_items_platform_account_id_platform_accounts"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["game_id"],
            ["games.id"],
            name=op.f("fk_platform_library_items_game_id_games"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_platform_library_items")),
        sa.UniqueConstraint(
            "platform_account_id",
            "provider_game_id",
            name="uq_platform_library_items_account_game",
        ),
    )
    # Partial: an unresolved row can never answer "does this author own this
    # game", and a large share of any real library is unresolved.
    op.create_index(
        "ix_platform_library_items_game_id",
        "platform_library_items",
        ["game_id"],
        unique=False,
        postgresql_where=sa.text("game_id IS NOT NULL"),
    )
    op.create_index(
        "ix_platform_library_items_account_playtime",
        "platform_library_items",
        ["platform_account_id", sa.text("playtime_minutes DESC")],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        "ix_platform_library_items_account_playtime", table_name="platform_library_items"
    )
    op.drop_index("ix_platform_library_items_game_id", table_name="platform_library_items")
    op.drop_table("platform_library_items")
    op.drop_table("platform_accounts")
    # Dropped explicitly: Postgres keeps an enum type after the last table using
    # it goes, so a re-run of the upgrade would fail on a type that already
    # exists. `sa.Enum(...).create()` on the way up is implicit in create_table,
    # but the way down is not symmetrical.
    for name in ("library_match_source", "platform_sync_status", "connection_provider"):
        op.execute(sa.text(f"DROP TYPE IF EXISTS {name}"))
