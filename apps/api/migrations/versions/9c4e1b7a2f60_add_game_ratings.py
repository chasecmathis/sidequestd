"""add game ratings — IGDB's and ours

Two scores, two sources, two columns each.

`igdb_rating` / `igdb_rating_count` mirror IGDB's `total_rating` (its blended
critic-and-user score, 0-100) and `total_rating_count`. They arrive with the
weekly catalog sync, so every existing row holds NULL until that has walked it.

`rating_average` / `rating_count` are ours, denormalised off `reviews` and
rewritten in the same transaction as every review create, update and delete —
see `app.services.reviews.refresh_game_rating` for why they are recomputed
rather than incremented.

The nullability is asymmetric on purpose. `rating_average` is NULL, never 0.0,
on a game nobody has rated, matching `ProfileStatistics.average_rating`: the mean
of nothing is not zero. `rating_count` is NOT NULL because zero reviews is a fact
we always hold. But `igdb_rating_count` *is* nullable, because "IGDB says nobody
rated it" and "we have not asked IGDB about this row yet" are different states,
and the client hides the whole block for the second.

No index: the browse orderings are unchanged (SPEC §6.5 is still title, release
date and trending), and an index nothing sorts or filters on is only a cost to
the sync that writes these columns a few hundred thousand times a week.

Revision ID: 9c4e1b7a2f60
Revises: 274f9dd9efda
Create Date: 2026-08-12 10:12:41.220913

"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "9c4e1b7a2f60"
down_revision: str | None = "274f9dd9efda"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("games", sa.Column("igdb_rating", sa.Float(), nullable=True))
    op.add_column("games", sa.Column("igdb_rating_count", sa.Integer(), nullable=True))
    op.add_column("games", sa.Column("rating_average", sa.Float(), nullable=True))
    # The server default outlives the backfill on purpose: the ORM's `default=0`
    # covers the import path, but only this covers a raw INSERT that never went
    # through SQLAlchemy.
    op.add_column(
        "games",
        sa.Column("rating_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.create_check_constraint(
        "igdb_rating_in_range",
        "games",
        "igdb_rating IS NULL OR (igdb_rating >= 0 AND igdb_rating <= 100)",
    )
    op.create_check_constraint("rating_count_non_negative", "games", "rating_count >= 0")

    # Seed our half from the reviews that already exist. Games with none keep
    # NULL and the zero default, which is exactly the unrated state.
    op.execute(
        """
        UPDATE games AS g
        SET rating_average = r.average,
            rating_count = r.total
        FROM (
            SELECT game_id, avg(rating) AS average, count(*) AS total
            FROM reviews
            GROUP BY game_id
        ) AS r
        WHERE r.game_id = g.id
        """
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_games_rating_count_non_negative"), "games", type_="check")
    op.drop_constraint(op.f("ck_games_igdb_rating_in_range"), "games", type_="check")
    op.drop_column("games", "rating_count")
    op.drop_column("games", "rating_average")
    op.drop_column("games", "igdb_rating_count")
    op.drop_column("games", "igdb_rating")
