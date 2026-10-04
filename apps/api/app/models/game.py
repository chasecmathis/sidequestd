"""Games catalog, mirrored from a third-party source such as IGDB (SPEC §2, §7)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from app.models.search_keys import search_compact, search_key

game_genres = sa.Table(
    "game_genres",
    Base.metadata,
    sa.Column("game_id", sa.ForeignKey("games.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("genre_id", sa.ForeignKey("genres.id", ondelete="CASCADE"), primary_key=True),
)

game_platforms = sa.Table(
    "game_platforms",
    Base.metadata,
    sa.Column("game_id", sa.ForeignKey("games.id", ondelete="CASCADE"), primary_key=True),
    sa.Column("platform_id", sa.ForeignKey("platforms.id", ondelete="CASCADE"), primary_key=True),
)


# Genre and Platform are the two browse facets (SPEC §6.5), and both carry a
# denormalised `game_count`: how many catalog entries reference them.
#
# It is what the facet lists are ordered by, and it gets the `trending_scores`
# treatment rather than the `rating_average` one — recomputed by a job, not on
# every write — because nothing a member does can change it. Only a catalog
# import can, so `app.services.games_import.refresh_facet_counts` rewrites it
# there. The alternative, counting the 420k association rows on demand, costs
# a tenth of a second on the two hottest reads in the app.
#
# No index. Both tables are small enough (23 genres, 215 platforms) that a
# sequential scan and a sort beat one, and the sync writes every row weekly.


class Genre(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "genres"

    name: Mapped[str] = mapped_column(sa.String(80), unique=True)
    slug: Mapped[str] = mapped_column(sa.String(80), unique=True)
    game_count: Mapped[int] = mapped_column(sa.Integer, default=0, server_default=sa.text("0"))


class Platform(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "platforms"

    name: Mapped[str] = mapped_column(sa.String(80), unique=True)
    slug: Mapped[str] = mapped_column(sa.String(80), unique=True)
    game_count: Mapped[int] = mapped_column(sa.Integer, default=0, server_default=sa.text("0"))


class Game(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "games"

    # Stable id in the upstream catalog; lets the import job upsert idempotently.
    external_id: Mapped[str | None] = mapped_column(sa.String(64), unique=True)
    external_source: Mapped[str | None] = mapped_column(sa.String(32))

    title: Mapped[str] = mapped_column(sa.String(300), index=True)
    # What title search matches against; see app.models.search_keys.
    search_key: Mapped[str] = mapped_column(sa.Text, search_key("title"), deferred=True)
    search_compact: Mapped[str] = mapped_column(sa.Text, search_compact("title"), deferred=True)
    slug: Mapped[str] = mapped_column(sa.String(320), unique=True)
    summary: Mapped[str | None] = mapped_column(sa.Text)
    cover_url: Mapped[str | None] = mapped_column(sa.Text)
    release_date: Mapped[date | None] = mapped_column(sa.Date)

    # Upstream's own score, mirrored on the scale IGDB publishes it on — 0-100,
    # deliberately not folded into our 1-10. They are two different measurements
    # taken by two different populations, and a game detail page shows them as
    # two, so converting one into the other here would only invent a precision
    # neither has. Null until the weekly sync has walked this row, which is a
    # different fact from "nobody has rated it upstream" — hence the nullable
    # count beside it.
    igdb_rating: Mapped[float | None] = mapped_column(sa.Float)
    igdb_rating_count: Mapped[int | None] = mapped_column(sa.Integer)

    # Ours, denormalised off `reviews`. Rewritten inside the same transaction as
    # every review write by `app.services.reviews.refresh_game_rating`, so
    # somebody who rates a game and comes back to it sees the number move — which
    # is what rules out the `trending_scores` treatment below.
    #
    # NULL rather than 0.0 while nobody has rated it, matching the profile
    # average in `app.services.users.get_stats`: the mean of nothing is not zero,
    # and calling it zero would draw every unreviewed game as one star.
    rating_average: Mapped[float | None] = mapped_column(sa.Float)
    rating_count: Mapped[int] = mapped_column(sa.Integer, default=0, server_default=sa.text("0"))

    genres: Mapped[list[Genre]] = relationship(secondary=game_genres)
    platforms: Mapped[list[Platform]] = relationship(secondary=game_platforms)

    # Store ids from `game_external_ids` — what the detail page turns into an
    # outbound link, and what a linked Steam library resolves against.
    #
    # Named `store_ids` rather than `external_ids` because `external_id` above is
    # already a column meaning something else entirely (the IGDB game id). A
    # relationship one character away from it would be read as its plural by
    # everyone who came after.
    #
    # `viewonly` because the importer writes this table through
    # `games_import._write_external_ids`, which upserts on the composite key. A
    # writable collection here would give the ORM a second, conflicting opinion
    # about how those rows get created.
    #
    # Deliberately not eager-loaded by `games._with_related`: only GameDetail
    # renders it, and a fourth selectinload on every 20-card browse page is cost
    # for something no card shows.
    store_ids: Mapped[list[GameExternalId]] = relationship(
        order_by="GameExternalId.source", viewonly=True
    )

    __table_args__ = (
        # Title search (SPEC §6.6) matches anywhere in the normalized key, which
        # a plain btree cannot serve: the trigram GIN indexes make the LIKE,
        # fuzzy `<%` and similarity() halves of `services.search` indexable. A
        # query too short to have a trigram uses the prefix btree instead.
        sa.Index(
            "ix_games_search_key_trgm",
            "search_key",
            postgresql_using="gin",
            postgresql_ops={"search_key": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_games_search_compact_trgm",
            "search_compact",
            postgresql_using="gin",
            postgresql_ops={"search_compact": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_games_search_key_prefix",
            "search_key",
            postgresql_ops={"search_key": "text_pattern_ops"},
        ),
        # Discover's "new releases" asks for the twelve highest dates at or below
        # today on every page load. Partial because the undated rows can never
        # answer that question, and upstream leaves a large share of them undated.
        sa.Index(
            "ix_games_release_date_desc",
            sa.text("release_date DESC"),
            postgresql_where=sa.text("release_date IS NOT NULL"),
        ),
        # The one thing standing between a future change of upstream field — to
        # `rating`, or to a source that publishes out of 10 — and a 0-100 meter
        # quietly rendering nonsense.
        sa.CheckConstraint(
            "igdb_rating IS NULL OR (igdb_rating >= 0 AND igdb_rating <= 100)",
            name="igdb_rating_in_range",
        ),
        sa.CheckConstraint("rating_count >= 0", name="rating_count_non_negative"),
    )


# The store this id belongs to. A string rather than an enum because the values
# come from IGDB's own source list, which grows without asking us — a new store
# appearing upstream should widen the mapping, not fail the import.
EXTERNAL_ID_SOURCE_STEAM = "steam"


class GameExternalId(Base):
    """Store-level ids for a catalog entry, mirrored from IGDB's `external_games`.

    This is what lets a linked Steam library resolve to catalog rows *exactly*.
    The alternative — matching "The Witcher 3: Wild Hunt - Game of the Year
    Edition" against `games.title` — is the kind of thing that is right almost
    every time, which is precisely what disqualifies it: the playtime figures it
    feeds are shown to other members as verified, and a claim that is usually
    true is not one worth making.

    `(source, uid)` is the primary key rather than an index on a surrogate, so
    one Steam appid can only ever name one game. IGDB does occasionally carry the
    same store id on a game and its remaster, and the import resolving that to
    two rows would make the lookup ambiguous exactly where it has to be certain.
    """

    __tablename__ = "game_external_ids"

    source: Mapped[str] = mapped_column(sa.String(32), primary_key=True)
    uid: Mapped[str] = mapped_column(sa.String(64), primary_key=True)
    game_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("games.id", ondelete="CASCADE"), index=True
    )

    game: Mapped[Game] = relationship()


class GameAlias(UUIDPrimaryKeyMixin, Base):
    """Another name a game goes by — "GTA V", "BotW" — mirrored from IGDB's
    `alternative_names` so search finds what people actually type (SPEC §6.6).

    Written only by the import (`games_import._write_aliases`), like
    `game_external_ids`. Unique per game on the normalized key, so "GTA V" and
    "gta v" are one row; the unique index also serves lookups by `game_id`.
    """

    __tablename__ = "game_aliases"

    game_id: Mapped[uuid.UUID] = mapped_column(sa.ForeignKey("games.id", ondelete="CASCADE"))
    alias: Mapped[str] = mapped_column(sa.String(300))
    search_key: Mapped[str] = mapped_column(sa.Text, search_key("alias"), deferred=True)
    search_compact: Mapped[str] = mapped_column(sa.Text, search_compact("alias"), deferred=True)

    __table_args__ = (
        sa.UniqueConstraint("game_id", "search_key"),
        sa.Index(
            "ix_game_aliases_search_key_trgm",
            "search_key",
            postgresql_using="gin",
            postgresql_ops={"search_key": "gin_trgm_ops"},
        ),
        sa.Index(
            "ix_game_aliases_search_compact_trgm",
            "search_compact",
            postgresql_using="gin",
            postgresql_ops={"search_compact": "gin_trgm_ops"},
        ),
    )


class TrendingScore(Base):
    """Materialised output of the trending worker (SPEC §6.11, §7)."""

    __tablename__ = "trending_scores"

    game_id: Mapped[uuid.UUID] = mapped_column(
        sa.ForeignKey("games.id", ondelete="CASCADE"), primary_key=True
    )
    window: Mapped[str] = mapped_column(sa.String(16), primary_key=True)
    score: Mapped[float] = mapped_column(sa.Float, default=0.0)
    computed_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), server_default=sa.func.now()
    )

    game: Mapped[Game] = relationship()

    __table_args__ = (sa.Index("ix_trending_scores_window_score", "window", sa.text("score DESC")),)
