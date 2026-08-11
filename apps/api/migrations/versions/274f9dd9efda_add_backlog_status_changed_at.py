"""add backlog status_changed_at

SPEC §6.11 blends backlog status changes into the Home feed, and this slice
derives them from `backlog_items` rather than from an events table. `updated_at`
cannot carry that: it moves when a list is *reordered* too, which would announce
somebody tidying their queue as news and — because it is the feed's sort key —
shuffle rows between pages while they were being read.

Existing rows are backfilled from `created_at` rather than from `now()`, so a
backlog that predates this column does not appear in every follower's feed at
once as though it had all just happened.

Revision ID: 274f9dd9efda
Revises: de134620f0fc
Create Date: 2026-08-04 21:07:37.886904

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "274f9dd9efda"
down_revision: str | None = "de134620f0fc"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "backlog_items",
        sa.Column(
            "status_changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.execute("UPDATE backlog_items SET status_changed_at = created_at")
    op.create_index(
        op.f("ix_backlog_items_status_changed_at"),
        "backlog_items",
        ["status_changed_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_backlog_items_status_changed_at"), table_name="backlog_items")
    op.drop_column("backlog_items", "status_changed_at")
