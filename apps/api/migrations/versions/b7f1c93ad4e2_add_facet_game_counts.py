"""add game_count to genres and platforms

The browse facets (SPEC §6.5) used to come back alphabetically, which on a real
IGDB import is close to useless: the catalog carries 215 platforms, and the
first eight by name are "1292 Advanced Programmable Video System", "3DO", "64DD"
and five AY-3-86xx chips, while PC, Switch and PlayStation sit hundreds of rows
below the fold. Ordering by how much of the catalog a facet actually covers puts
the eight anybody would filter by in the collapsed row.

Denormalised rather than aggregated per request. The count only moves when a
catalog import moves it, and the `GROUP BY` over `game_platforms` costs ~110ms
measured against a 310k-game catalog — twice over, on `/games/discover`, which
is the first screen a signed-in member loads.

Backfilled here so the ordering is right the moment this deploys, rather than
whenever the weekly sync next runs. From then on
`app.services.games_import.refresh_facet_counts` keeps it current.

No index: 23 rows and 215 rows respectively, so the planner will seq scan and
sort either way, and the sync rewrites every row weekly.

Revision ID: b7f1c93ad4e2
Revises: 9c4e1b7a2f60
Create Date: 2026-08-13 09:41:07.583210

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7f1c93ad4e2"
down_revision: str | None = "9c4e1b7a2f60"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# The server default outlives the backfill on purpose: a facet created by the
# import between the migration and the next `refresh_facet_counts` needs a
# value, and 0 sorts it last, which is where an unknown facet belongs.
_FACETS = (("genres", "game_genres", "genre_id"), ("platforms", "game_platforms", "platform_id"))


def upgrade() -> None:
    for table, association, column in _FACETS:
        op.add_column(
            table,
            sa.Column("game_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        )
        op.execute(
            f"""
            UPDATE {table} AS f
            SET game_count = c.total
            FROM (
                SELECT {column} AS facet_id, count(*) AS total
                FROM {association}
                GROUP BY {column}
            ) AS c
            WHERE c.facet_id = f.id
            """  # noqa: S608 — the interpolated names are the literals above.
        )


def downgrade() -> None:
    for table, _association, _column in _FACETS:
        op.drop_column(table, "game_count")
