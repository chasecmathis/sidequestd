"""Search relevance (SPEC §6.6): the queries the ranking weights are tuned against.

Each case is something a person types and the game they meant. The catalog is
built by hand rather than taken from the seed fixture because ranking is about
near-misses — two Marios, a Witcher and a Witcheye — and about popularity, which
the fixture does not carry. When a weight in `app.services.search` changes, this
file is what says whether it changed for the better.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.game import Game, GameAlias
from app.services.games_import import slugify

GAMES = "/api/v1/search/games"

# (title, IGDB rating count, aliases)
CATALOG: list[tuple[str, int | None, tuple[str, ...]]] = [
    ("Super Mario Odyssey", 3000, ()),
    ("Mario's Super Picross", 40, ()),
    ("Marvel's Spider-Man 2", 900, ()),
    ("Pokémon Scarlet", 800, ()),
    ("The Witcher 3: Wild Hunt", 4000, ("TW3", "Witcher 3")),
    ("Witcheye", 10, ()),
    ("Grand Theft Auto V", 4900, ("GTA V",)),
    ("Final Fantasy VII", 2500, ("FF7",)),
    ("Elden Ring", 4800, ()),
    ("Half-Life 2", 3000, ()),
    ("Hades", 3500, ()),
    ("Hades II", 900, ()),
    ("Halo Infinite", 1500, ()),
    ("Celeste", 10, ()),
    ("Celeste Classic", 4000, ()),
]


@pytest.fixture(autouse=True)
async def ranked_catalog(db: AsyncSession) -> None:
    for title, rating_count, aliases in CATALOG:
        game = Game(title=title, slug=slugify(title), igdb_rating_count=rating_count)
        db.add(game)
        await db.flush()
        db.add_all(GameAlias(game_id=game.id, alias=alias) for alias in aliases)
    await db.flush()


async def _titles(client: AsyncClient, query: str, **params: Any) -> list[str]:
    response = await client.get(GAMES, params={"q": query, **params})
    assert response.status_code == 200, response.text
    return [card["title"] for card in response.json()["items"]]


async def _every_page(client: AsyncClient, query: str, *, limit: int) -> list[str]:
    titles: list[str] = []
    cursor: str | None = None
    while True:
        params: dict[str, Any] = {"q": query, "limit": limit}
        if cursor:
            params["cursor"] = cursor
        body = (await client.get(GAMES, params=params)).json()
        titles += [card["title"] for card in body["items"]]
        cursor = body["next_cursor"]
        if cursor is None:
            return titles


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        pytest.param("pokemon", "Pokémon Scarlet", id="accents"),
        pytest.param("spiderman", "Marvel's Spider-Man 2", id="punctuation-joined"),
        pytest.param("spider man", "Marvel's Spider-Man 2", id="punctuation-spaced"),
        pytest.param("halflife", "Half-Life 2", id="hyphen-joined"),
        pytest.param("witcher wild hunt", "The Witcher 3: Wild Hunt", id="non-contiguous"),
        pytest.param("wild hunt witcher", "The Witcher 3: Wild Hunt", id="word-order"),
        pytest.param("eldin ring", "Elden Ring", id="typo"),
        pytest.param("witchr", "The Witcher 3: Wild Hunt", id="typo-popular-first"),
        pytest.param("gta v", "Grand Theft Auto V", id="alias"),
        pytest.param("tw3", "The Witcher 3: Wild Hunt", id="alias-abbreviation"),
        pytest.param("ff 7", "Final Fantasy VII", id="alias-short-words"),
        pytest.param("mario", "Super Mario Odyssey", id="popularity"),
        pytest.param("celeste", "Celeste", id="exact-beats-popularity"),
        pytest.param("hades", "Hades", id="closer-title"),
    ],
)
async def test_the_game_meant_ranks_first(client: AsyncClient, query: str, expected: str) -> None:
    assert (await _titles(client, query))[:1] == [expected]


async def test_a_game_matched_by_title_and_alias_appears_once(client: AsyncClient) -> None:
    assert (await _titles(client, "witcher 3")).count("The Witcher 3: Wild Hunt") == 1


async def test_a_typo_tolerance_does_not_admit_unrelated_titles(client: AsyncClient) -> None:
    assert await _titles(client, "qzxwv") == []


async def test_a_short_query_matches_the_start_of_titles(client: AsyncClient) -> None:
    """Too short for a trigram index, so only a prefix is matched (and indexed)."""
    assert set(await _titles(client, "ha")) == {"Hades", "Hades II", "Half-Life 2", "Halo Infinite"}


async def test_a_short_query_is_not_fuzzy(client: AsyncClient) -> None:
    assert await _titles(client, "hz") == []


@pytest.mark.parametrize("query", ["!!!", "@", "--"])
async def test_a_query_with_nothing_searchable_in_it_is_an_empty_page(
    client: AsyncClient, query: str
) -> None:
    """It passed validation, so it is a search that found nothing, not a 422."""
    response = await client.get(GAMES, params={"q": query})

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}


@pytest.mark.parametrize("query", ["witcher", "ha"])
async def test_paging_a_ranked_search_neither_repeats_nor_skips(
    client: AsyncClient, query: str
) -> None:
    """The cursor carries the blended score, alias matches included."""
    assert await _every_page(client, query, limit=1) == await _titles(client, query, limit=50)
