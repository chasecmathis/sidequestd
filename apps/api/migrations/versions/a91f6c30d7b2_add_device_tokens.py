"""add push device tokens

Where a notification goes when the member is not looking at the app. Until now
delivery was in-app only and `notifications` *was* the delivery; this table is
the second half, and the only new state push needs.

It starts empty and stays empty for every member who does not install the native
client or who declines the permission, so nothing is backfilled and nothing
changes for the web.

The unique constraint is on `token` alone rather than on `(user_id, token)`, and
that is the point of the table rather than a detail of it: a phone that changes
hands must not end up addressed by two accounts, so registering a token that
already exists moves it to the new owner.

Revision ID: a91f6c30d7b2
Revises: f4a1c07e3b52
Create Date: 2026-08-21 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "a91f6c30d7b2"
down_revision: str | None = "f4a1c07e3b52"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "device_tokens",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.String(length=512), nullable=False),
        sa.Column("platform", sa.Enum("IOS", "ANDROID", name="device_platform"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_device_tokens_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_tokens")),
        sa.UniqueConstraint("token", name="uq_device_tokens_token"),
    )
    op.create_index("ix_device_tokens_user_id", "device_tokens", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_device_tokens_user_id", table_name="device_tokens")
    op.drop_table("device_tokens")
    sa.Enum(name="device_platform").drop(op.get_bind(), checkfirst=False)
