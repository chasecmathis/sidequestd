"""add game_external_ids

Store-level ids (Steam appids to begin with) for catalog entries, mirrored from
IGDB's `external_games`. This is the join that lets a member's linked Steam
library resolve to catalog rows exactly, rather than by matching store titles
against `games.title` — a claim shown to other members as verified cannot rest
on a match that is merely usually right.

`(source, uid)` is the primary key, so one store id names at most one game. The
table starts empty and fills on the next catalog sync; nothing reads it until a
Steam account is linked, so there is no backfill.

Revision ID: e2b7c41d9a83
Revises: c58e0b31a7d4
Create Date: 2026-08-17 00:00:00.000000

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e2b7c41d9a83"
down_revision: str | None = "c58e0b31a7d4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "game_external_ids",
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("uid", sa.String(length=64), nullable=False),
        sa.Column("game_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(
            ["game_id"],
            ["games.id"],
            name=op.f("fk_game_external_ids_game_id_games"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("source", "uid", name=op.f("pk_game_external_ids")),
    )
    # The library sync resolves a whole page of appids at once by (source, uid),
    # which the primary key serves. This one is for the other direction: the
    # review badge and the profile showcase both start from a game.
    op.create_index(
        op.f("ix_game_external_ids_game_id"),
        "game_external_ids",
        ["game_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_game_external_ids_game_id"), table_name="game_external_ids")
    op.drop_table("game_external_ids")
