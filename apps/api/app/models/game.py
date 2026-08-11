"""Games catalog, mirrored from a third-party source such as IGDB (SPEC §2, §7)."""

from __future__ import annotations

import uuid
from datetime import date, datetime

import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

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


class Genre(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "genres"

    name: Mapped[str] = mapped_column(sa.String(80), unique=True)
    slug: Mapped[str] = mapped_column(sa.String(80), unique=True)


class Platform(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "platforms"

    name: Mapped[str] = mapped_column(sa.String(80), unique=True)
    slug: Mapped[str] = mapped_column(sa.String(80), unique=True)


class Game(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "games"

    # Stable id in the upstream catalog; lets the import job upsert idempotently.
    external_id: Mapped[str | None] = mapped_column(sa.String(64), unique=True)
    external_source: Mapped[str | None] = mapped_column(sa.String(32))

    title: Mapped[str] = mapped_column(sa.String(300), index=True)
    slug: Mapped[str] = mapped_column(sa.String(320), unique=True)
    summary: Mapped[str | None] = mapped_column(sa.Text)
    cover_url: Mapped[str | None] = mapped_column(sa.Text)
    release_date: Mapped[date | None] = mapped_column(sa.Date)

    genres: Mapped[list[Genre]] = relationship(secondary=game_genres)
    platforms: Mapped[list[Platform]] = relationship(secondary=game_platforms)

    __table_args__ = (
        # Title search (SPEC §6.6) matches anywhere in the string, which the plain
        # btree on `title` cannot serve. A trigram GIN index makes both the
        # ILIKE '%…%' filter and the similarity() ranking indexable.
        sa.Index(
            "ix_games_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
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
