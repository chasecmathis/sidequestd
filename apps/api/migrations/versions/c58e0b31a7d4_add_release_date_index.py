"""add a partial descending index on games.release_date

Discover's "new releases" section (SPEC §6.5) now asks for the twelve highest
release dates *at or below today* — the unbounded version filled the section
with announcements, since IGDB publishes `first_release_date` for games that are
years from shipping. Bounded, the query is a top-12 over an ordered range, which
without an index is a seq scan and sort of the whole catalog (~310k rows) on
every load of the first screen a member sees.

Partial rather than plain: a large share of the catalog is undated, and those
rows can never answer this question. DESC to match the ordering the section
reads in, so the scan runs forward off the index.

Revision ID: c58e0b31a7d4
Revises: b7f1c93ad4e2
Create Date: 2026-08-17 11:02:18.914733

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "c58e0b31a7d4"
down_revision: str | None = "b7f1c93ad4e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Hand-written: autogenerate does not render expression or partial indexes.
    op.create_index(
        "ix_games_release_date_desc",
        "games",
        [sa.text("release_date DESC")],
        unique=False,
        postgresql_where=sa.text("release_date IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_games_release_date_desc", table_name="games")
