"""Games catalog representations (SPEC §6.5, §6.6, §8)."""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, computed_field

from app.models.game import EXTERNAL_ID_SOURCE_STEAM

# How to address a store id, keyed by the source string IGDB publishes.
#
# Two tables rather than one so a source we can name but cannot link — or link
# but have no nice name for — degrades on its own axis instead of dropping out.
STORE_LABELS = {EXTERNAL_ID_SOURCE_STEAM: "Steam"}
STORE_URL_TEMPLATES = {
    EXTERNAL_ID_SOURCE_STEAM: "https://store.steampowered.com/app/{uid}/",
}


class GameSort(enum.StrEnum):
    """Orderings offered by `GET /games` (SPEC §6.5 Browse)."""

    TITLE = "title"
    RELEASE_DATE = "release_date"
    TRENDING = "trending"


class TrendingWindow(enum.StrEnum):
    """Rolling windows the trending worker computes (SPEC §6.11).

    Closed set rather than free text so a typo can't quietly return an empty
    ranking; the durations live in `app.services.trending.TRENDING_WINDOWS`.
    """

    DAY = "24h"
    WEEK = "7d"
    MONTH = "30d"


class GenreRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str


class PlatformRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str


class StoreLink(BaseModel):
    """Where a catalog entry can be bought or launched, from `game_external_ids`.

    The ids arrive with the catalog import — IGDB publishes each game's store
    listings — so this costs nothing to produce beyond addressing them.

    `url` is nullable and the client is expected to drop the nulls.
    `game_external_ids.source` is deliberately a free string rather than an enum,
    so that a store appearing upstream widens the mapping instead of failing an
    import; the consequence is that a source can arrive before anyone here has
    written its URL template. A row we cannot address is a row we do not link,
    which is a better outcome than an import that refuses a game because we do
    not recognise one of its listings.
    """

    model_config = ConfigDict(from_attributes=True)

    source: str = Field(description="Store key as IGDB publishes it, e.g. 'steam'")
    uid: str = Field(description="The store's own id for the game, e.g. a Steam appid")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def label(self) -> str:
        """The store's name. Falls back to the raw key rather than to nothing."""
        return STORE_LABELS.get(self.source, self.source)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def url(self) -> str | None:
        """The listing, or null for a source with no template — see the note above.

        The digit check is not redundant with the importer's own validation. This
        value originates upstream and ends up in an href a reader clicks, so the
        one place it becomes a URL is worth making the place that refuses to
        build a strange one.
        """
        template = STORE_URL_TEMPLATES.get(self.source)
        if template is None or not self.uid.isdigit():
            return None
        return template.format(uid=self.uid)


class GameSummary(BaseModel):
    """The card shape used by browse and search results.

    Deliberately narrow: SPEC §6.6 asks for cover art, release year and platform
    on a result, and shipping the long `summary` text in a 20-item page would be
    most of the payload for something no card renders.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    slug: str
    title: str
    cover_url: str | None
    release_date: date | None
    platforms: list[PlatformRef]

    rating_average: float | None = Field(
        default=None,
        description="Mean sidequestd rating, on the stored 1-10 scale. Null until "
        "somebody rates it — the mean of nothing is not zero.",
    )
    rating_count: int = Field(
        default=0, description="How many sidequestd reviews the average is taken over"
    )
    igdb_rating: float | None = Field(
        default=None,
        description="IGDB's blended critic-and-user score, 0-100. Deliberately not "
        "converted to the 1-10 scale: it is a different measurement by a different "
        "population, and clients render it as one. Null when IGDB has no score for "
        "the game, or when the weekly catalog sync has not reached this row yet.",
    )
    igdb_rating_count: int | None = Field(
        default=None,
        description="How many IGDB ratings their score is over. Null, rather than 0, "
        "because 'nobody rated it upstream' and 'we have not asked yet' are different.",
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def release_year(self) -> int | None:
        """Precomputed so every client renders the same year for a given date."""
        return self.release_date.year if self.release_date else None


class GameDetail(GameSummary):
    """Everything the Game Detail screen needs (SPEC §5)."""

    # `populate_by_name` because the alias below replaces the field name during
    # validation, and tests construct this by name.
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    summary: str | None
    genres: list[GenreRef]
    external_id: str | None
    external_source: str | None
    created_at: datetime

    # The alias is what lets the router stay `GameDetail.model_validate(game)`
    # while the ORM side keeps the name that describes what it holds: the
    # relationship is a list of ids, and only this schema turns them into links.
    store_links: list[StoreLink] = Field(
        default_factory=list,
        validation_alias=AliasChoices("store_links", "store_ids"),
        description="Store listings for this game. Empty until the catalog import "
        "has reached the row; entries with a null url are not addressable and "
        "should not be rendered. Absent from GameSummary on purpose — no card "
        "shows it, and a browse page should not pay for it.",
    )


class TrendingGame(BaseModel):
    """A trending entry: the card plus the score that ranked it (SPEC §6.11)."""

    game: GameSummary
    score: float
    window: TrendingWindow = Field(description="Rolling window the score was computed over")


class DiscoverResponse(BaseModel):
    """The Discover tab's first paint (SPEC §6.5).

    Every section is a plain list of cards, `recommended` included: the ranking
    that produced it is the server's business, and a score on the wire is a
    number a client would be tempted to show. See `app.services.recommendations`
    for how the order is arrived at.
    """

    trending: list[TrendingGame]
    new_releases: list[GameSummary]
    recommended: list[GameSummary] = Field(
        description="Personalised for the caller, or trending and popular "
        "all-time for a caller with no ratings, favorites or session."
    )
    genres: list[GenreRef]
    platforms: list[PlatformRef]
