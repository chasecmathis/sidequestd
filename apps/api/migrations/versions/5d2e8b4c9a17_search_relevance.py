"""search relevance: normalized search keys and game aliases

Revision ID: 5d2e8b4c9a17
Revises: a91f6c30d7b2
Create Date: 2026-10-04 00:00:00.000000

Search (SPEC §6.6) moves from ILIKE over the raw columns to matching over
normalized keys, so "pokemon" finds "Pokémon" and "spiderman" finds
"Spider-Man", and gains `game_aliases` so "GTA V" finds Grand Theft Auto V.
The design is `.context/decisions/2026-10-search-relevance.md`.

`search_normalize` is the one definition of "normalized": the generated columns
call it and the search service runs each query through it, so the two cannot
disagree. A generated column needs an IMMUTABLE function. Plain
`unaccent(text)` is only STABLE because it finds its dictionary through the
search_path, so the dictionary is named explicitly here, and every other name
is schema-qualified for the same reason: a restore runs with an empty
search_path. `[:alnum:]` rather than `a-z0-9` keeps non-Latin names searchable.

The indexes on the two populated tables are built CONCURRENTLY so the catalog
stays readable while they build. Adding the stored columns still rewrites
`games` and `users` under a brief exclusive lock (deployment.md §3).
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "5d2e8b4c9a17"
down_revision: str | None = "a91f6c30d7b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# `\:` because sa.text would otherwise read `:alnum` as a bind parameter.
CREATE_NORMALIZE = r"""
CREATE FUNCTION public.search_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$
    SELECT pg_catalog.btrim(pg_catalog.regexp_replace(
        pg_catalog.lower(public.unaccent('public.unaccent'::regdictionary, value)),
        '[^[\:alnum\:]]+', ' ', 'g'))
$$
"""

# (table, source column, key column, compact column, nullable)
KEYED_COLUMNS = [
    ("games", "title", "search_key", "search_compact", False),
    ("users", "username", "username_key", "username_compact", False),
    ("users", "display_name", "display_name_key", "display_name_compact", True),
]

# (index, table, column, opclass, access method) — every one of these is on a
# table that already holds rows, so they are built concurrently.
POPULATED_INDEXES = [
    ("ix_games_search_key_trgm", "games", "search_key", "gin_trgm_ops", "gin"),
    ("ix_games_search_compact_trgm", "games", "search_compact", "gin_trgm_ops", "gin"),
    ("ix_games_search_key_prefix", "games", "search_key", "text_pattern_ops", "btree"),
    ("ix_users_username_key_trgm", "users", "username_key", "gin_trgm_ops", "gin"),
    ("ix_users_username_compact_trgm", "users", "username_compact", "gin_trgm_ops", "gin"),
    ("ix_users_username_key_prefix", "users", "username_key", "text_pattern_ops", "btree"),
    ("ix_users_display_name_key_trgm", "users", "display_name_key", "gin_trgm_ops", "gin"),
    (
        "ix_users_display_name_compact_trgm",
        "users",
        "display_name_compact",
        "gin_trgm_ops",
        "gin",
    ),
    (
        "ix_users_display_name_key_prefix",
        "users",
        "display_name_key",
        "text_pattern_ops",
        "btree",
    ),
]

# The indexes this revision replaces, as de134620f0fc created them.
REPLACED_INDEXES = [
    ("ix_games_title_trgm", "games", "title"),
    ("ix_users_username_trgm", "users", "username"),
    ("ix_users_display_name_trgm", "users", "display_name"),
]


def _key(column: str) -> sa.Computed:
    return sa.Computed(f"public.search_normalize({column})", persisted=True)


def _compact(column: str) -> sa.Computed:
    return sa.Computed(f"replace(public.search_normalize({column}), ' ', '')", persisted=True)


def upgrade() -> None:
    op.execute(sa.text("CREATE EXTENSION IF NOT EXISTS unaccent"))
    op.execute(sa.text(CREATE_NORMALIZE))

    for table, source, key, compact, nullable in KEYED_COLUMNS:
        op.add_column(table, sa.Column(key, sa.Text(), _key(source), nullable=nullable))
        op.add_column(table, sa.Column(compact, sa.Text(), _compact(source), nullable=nullable))

    op.create_table(
        "game_aliases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("game_id", sa.Uuid(), nullable=False),
        sa.Column("alias", sa.String(length=300), nullable=False),
        sa.Column("search_key", sa.Text(), _key("alias"), nullable=False),
        sa.Column("search_compact", sa.Text(), _compact("alias"), nullable=False),
        sa.ForeignKeyConstraint(
            ["game_id"],
            ["games.id"],
            name=op.f("fk_game_aliases_game_id_games"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_game_aliases")),
        sa.UniqueConstraint(
            "game_id", "search_key", name=op.f("uq_game_aliases_game_id_search_key")
        ),
    )
    op.create_index(
        "ix_game_aliases_search_key_trgm",
        "game_aliases",
        ["search_key"],
        postgresql_using="gin",
        postgresql_ops={"search_key": "gin_trgm_ops"},
    )
    op.create_index(
        "ix_game_aliases_search_compact_trgm",
        "game_aliases",
        ["search_compact"],
        postgresql_using="gin",
        postgresql_ops={"search_compact": "gin_trgm_ops"},
    )

    with op.get_context().autocommit_block():
        for name, table, column, opclass, using in POPULATED_INDEXES:
            op.create_index(
                name,
                table,
                [column],
                postgresql_using=using,
                postgresql_ops={column: opclass},
                postgresql_concurrently=True,
            )

    for name, table, _ in REPLACED_INDEXES:
        op.drop_index(name, table_name=table)


def downgrade() -> None:
    # unaccent is left installed, as pg_trgm is by de134620f0fc: a shared
    # database object something else may have started using.
    for name, table, column in REPLACED_INDEXES:
        op.create_index(
            name,
            table,
            [column],
            postgresql_using="gin",
            postgresql_ops={column: "gin_trgm_ops"},
        )

    op.drop_table("game_aliases")
    # Dropping a column takes its indexes with it.
    for table, _, key, compact, _ in KEYED_COLUMNS:
        op.drop_column(table, compact)
        op.drop_column(table, key)

    op.execute(sa.text("DROP FUNCTION public.search_normalize(text)"))
