"""Games catalog browse, filter, sort and detail — SPEC §6.5, §8."""

from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.game import Game, Genre, game_genres
from app.schemas.game import StoreLink
from tests.conftest import SEED_GAME_COUNT

BROWSE = "/api/v1/games"


async def test_browse_returns_a_page_of_cards(client: AsyncClient, catalog: list[Game]) -> None:
    response = await client.get(BROWSE, params={"limit": 5})

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["items"]) == 5
    assert body["next_cursor"]

    card = body["items"][0]
    # SPEC §6.6: cover art, release year and platform are what a card renders —
    # plus the two scores, which the card's meta line needs and which cost four
    # numbers rather than the paragraph below.
    assert {
        "id",
        "slug",
        "title",
        "cover_url",
        "release_date",
        "release_year",
        "platforms",
        "rating_average",
        "rating_count",
        "igdb_rating",
        "igdb_rating_count",
    } <= set(card)
    # The long summary belongs to the detail view, not to a 20-item page.
    assert "summary" not in card


async def test_an_unrated_game_reports_no_average_rather_than_zero(
    client: AsyncClient, catalog: list[Game]
) -> None:
    """Nobody has reviewed the seed catalog, and a mean of nothing is not zero.

    `is None` rather than `== 0` on purpose: a well-meaning coalesce would pass
    the second and draw every unreviewed game in the catalog as one star.
    """
    card = (await client.get(BROWSE, params={"limit": 1})).json()["items"][0]

    assert card["rating_average"] is None
    assert card["rating_count"] == 0


async def test_the_upstream_score_reaches_the_client(
    client: AsyncClient, catalog: list[Game]
) -> None:
    """The fixture carries scores for most entries and none for a few."""
    cards = (await client.get(BROWSE, params={"limit": 50})).json()["items"]

    scored = [card for card in cards if card["igdb_rating"] is not None]
    assert scored, "the seed fixture should leave some games scored"
    assert [card for card in cards if card["igdb_rating"] is None]
    assert all(0 <= card["igdb_rating"] <= 100 for card in scored)


async def test_detail_carries_the_same_two_scores(client: AsyncClient, catalog: list[Game]) -> None:
    body = (await client.get(f"{BROWSE}/{catalog[0].id}")).json()

    assert {"rating_average", "rating_count", "igdb_rating", "igdb_rating_count"} <= set(body)


async def test_browse_is_open_to_signed_out_callers(
    client: AsyncClient, catalog: list[Game]
) -> None:
    """The catalog is not user content, so nothing here is gated."""
    response = await client.get(BROWSE)

    assert response.status_code == 200
    assert response.json()["items"]


async def test_release_year_is_derived_from_the_release_date(
    client: AsyncClient, catalog: list[Game]
) -> None:
    response = await client.get(BROWSE, params={"limit": 50})

    for card in response.json()["items"]:
        expected = int(card["release_date"][:4]) if card["release_date"] else None
        assert card["release_year"] == expected


# --- Sorting ---------------------------------------------------------------


async def test_default_sort_is_alphabetical(client: AsyncClient, catalog: list[Game]) -> None:
    titles = [
        card["title"] for card in (await client.get(BROWSE, params={"limit": 50})).json()["items"]
    ]

    assert titles == sorted(titles)


async def test_release_date_sort_is_newest_first(client: AsyncClient, catalog: list[Game]) -> None:
    response = await client.get(BROWSE, params={"sort": "release_date", "limit": 50})

    dates = [card["release_date"] for card in response.json()["items"]]
    assert dates == sorted(dates, reverse=True)


async def test_undated_games_sort_last_rather_than_disappearing(
    client: AsyncClient, db, catalog: list[Game]
) -> None:
    """A NULL release date must not drop the row from a newest-first list."""
    db.add(Game(title="Untitled Sequel", slug="untitled-sequel", release_date=None))
    await db.flush()

    response = await client.get(BROWSE, params={"sort": "release_date", "limit": 50})

    titles = [card["title"] for card in response.json()["items"]]
    assert titles[-1] == "Untitled Sequel"


async def test_unknown_sort_is_rejected(client: AsyncClient) -> None:
    response = await client.get(BROWSE, params={"sort": "vibes"})

    assert response.status_code == 422


# --- Filtering -------------------------------------------------------------


async def test_filtering_by_genre(client: AsyncClient, catalog: list[Game]) -> None:
    response = await client.get(BROWSE, params={"genre": "indie", "limit": 50})

    items = response.json()["items"]
    assert items
    assert len(items) < SEED_GAME_COUNT, "an unfiltered result would prove nothing"
    titles = {card["title"] for card in items}
    assert {"Celeste", "Hollow Knight", "Stardew Valley"} <= titles


async def test_repeated_genres_are_or_ed_within_the_facet(
    client: AsyncClient, catalog: list[Game]
) -> None:
    indie = {
        c["title"]
        for c in (await client.get(BROWSE, params={"genre": "indie", "limit": 50})).json()["items"]
    }
    puzzle = {
        c["title"]
        for c in (await client.get(BROWSE, params={"genre": "puzzle", "limit": 50})).json()["items"]
    }

    both = await client.get(BROWSE, params=[("genre", "indie"), ("genre", "puzzle"), ("limit", 50)])

    assert {card["title"] for card in both.json()["items"]} == indie | puzzle


async def test_genre_and_platform_are_and_ed_across_facets(
    client: AsyncClient, catalog: list[Game]
) -> None:
    response = await client.get(
        BROWSE, params={"genre": "indie", "platform": "nintendo-switch", "limit": 50}
    )

    items = response.json()["items"]
    assert items
    for card in items:
        assert "nintendo-switch" in {platform["slug"] for platform in card["platforms"]}


async def test_unknown_facet_slug_returns_an_empty_page(
    client: AsyncClient, catalog: list[Game]
) -> None:
    response = await client.get(BROWSE, params={"genre": "no-such-genre"})

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}


# --- Cursor pagination -----------------------------------------------------


@pytest.mark.parametrize("sort", ["title", "release_date", "trending"])
async def test_paging_walks_every_game_exactly_once(
    client: AsyncClient, catalog: list[Game], sort: str
) -> None:
    seen: list[str] = []
    cursor: str | None = None

    for _ in range(20):  # generous bound; the loop breaks on the last page
        params: dict[str, object] = {"limit": 5, "sort": sort}
        if cursor:
            params["cursor"] = cursor
        body = (await client.get(BROWSE, params=params)).json()
        seen.extend(card["id"] for card in body["items"])
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert cursor is None, "pagination did not terminate"
    assert len(seen) == SEED_GAME_COUNT
    assert len(set(seen)) == SEED_GAME_COUNT, "a game was returned on two pages"


async def test_the_last_page_reports_no_cursor(client: AsyncClient, catalog: list[Game]) -> None:
    response = await client.get(BROWSE, params={"limit": SEED_GAME_COUNT})

    assert len(response.json()["items"]) == SEED_GAME_COUNT
    assert response.json()["next_cursor"] is None


async def test_the_cursor_carries_the_filter_nowhere(
    client: AsyncClient, catalog: list[Game]
) -> None:
    """Cursors are positions, not saved queries — the caller resends the filter."""
    first = (await client.get(BROWSE, params={"genre": "indie", "limit": 2})).json()
    second = await client.get(
        BROWSE, params={"genre": "indie", "limit": 2, "cursor": first["next_cursor"]}
    )

    assert second.status_code == 200
    first_ids = {card["id"] for card in first["items"]}
    assert not first_ids & {card["id"] for card in second.json()["items"]}


@pytest.mark.parametrize("cursor", ["not-base64", "e30", "", "IntcInhcIjogMX0i"])
async def test_a_corrupt_cursor_is_a_400_not_a_500(client: AsyncClient, cursor: str) -> None:
    response = await client.get(BROWSE, params={"cursor": cursor})

    assert response.status_code == 400
    assert "cursor" in response.json()["detail"].lower()


async def test_limit_is_capped(client: AsyncClient) -> None:
    assert (await client.get(BROWSE, params={"limit": 500})).status_code == 422
    assert (await client.get(BROWSE, params={"limit": 0})).status_code == 422


# --- Detail ----------------------------------------------------------------


async def test_game_detail_includes_genres_platforms_and_summary(
    client: AsyncClient, catalog: list[Game]
) -> None:
    listed = (await client.get(BROWSE, params={"limit": 50})).json()["items"]
    witcher = next(card for card in listed if card["title"] == "The Witcher 3: Wild Hunt")

    response = await client.get(f"{BROWSE}/{witcher['id']}")

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["title"] == "The Witcher 3: Wild Hunt"
    assert body["summary"]
    assert {genre["slug"] for genre in body["genres"]} == {"role-playing-rpg", "adventure"}
    assert "nintendo-switch" in {platform["slug"] for platform in body["platforms"]}
    assert body["external_source"] == "seed"


async def test_unknown_game_is_a_404(client: AsyncClient) -> None:
    response = await client.get(f"{BROWSE}/{uuid.uuid4()}")

    assert response.status_code == 404


# --- Store links -----------------------------------------------------------


async def _detail(client: AsyncClient, title: str) -> dict[str, object]:
    listed = (await client.get(BROWSE, params={"limit": 50})).json()["items"]
    card = next(item for item in listed if item["title"] == title)
    response = await client.get(f"{BROWSE}/{card['id']}")
    assert response.status_code == 200, response.text
    return response.json()


async def test_detail_addresses_the_steam_listing(client: AsyncClient, catalog: list[Game]) -> None:
    """The appid from the catalog import, turned into somewhere a reader can go."""
    body = await _detail(client, "Portal 2")

    assert body["store_links"] == [
        {
            "source": "steam",
            "uid": "620",
            "label": "Steam",
            "url": "https://store.steampowered.com/app/620/",
        }
    ]


async def test_a_game_sold_nowhere_we_know_of_reports_no_links(
    client: AsyncClient, catalog: list[Game]
) -> None:
    """Three of the seed entries are Nintendo exclusives with no store id at all.

    An empty list rather than an error or a missing key: "we have no listing for
    this" is an ordinary state, not a failure, and the client renders it by
    leaving the metadata line exactly as it was.
    """
    body = await _detail(client, "Super Mario Odyssey")

    assert body["store_links"] == []


async def test_a_card_does_not_carry_store_links(client: AsyncClient, catalog: list[Game]) -> None:
    """The reason `store_ids` is loaded in `get_game` and not in `_with_related`.

    Nothing in a browse grid renders a store link, and a regression that put the
    field back on the summary would cost every 20-card page an extra query in
    silence.
    """
    card = (await client.get(BROWSE, params={"limit": 1})).json()["items"][0]

    assert "store_links" not in card


def test_a_store_id_we_cannot_address_is_not_a_link() -> None:
    """`source` is a free string so a new store widens the mapping rather than
    failing an import — which means one can arrive before its URL template does.

    The non-numeric case is the same guard from the other side: this value comes
    from upstream and ends up in an href, so the one place it becomes a URL is
    the place that refuses to build a strange one.
    """
    unknown_store = StoreLink(source="itch", uid="12345")
    assert unknown_store.url is None
    # Still named as usefully as we can manage, rather than dropped entirely.
    assert unknown_store.label == "itch"

    malformed = StoreLink(source="steam", uid="620; DROP TABLE games")
    assert malformed.url is None


async def test_a_non_uuid_id_does_not_shadow_the_literal_routes(client: AsyncClient) -> None:
    """`/games/trending` must not be parsed as `/games/{game_id}`."""
    assert (await client.get(f"{BROWSE}/trending")).status_code == 200
    assert (await client.get(f"{BROWSE}/genres")).status_code == 200
    assert (await client.get(f"{BROWSE}/not-a-uuid")).status_code == 422


# --- Taxonomy --------------------------------------------------------------


async def test_genres_and_platforms_are_listed_for_the_browse_filters(
    client: AsyncClient, catalog: list[Game]
) -> None:
    genres = (await client.get(f"{BROWSE}/genres")).json()
    platforms = (await client.get(f"{BROWSE}/platforms")).json()

    assert {genre["slug"] for genre in genres} >= {"indie", "puzzle", "role-playing-rpg"}
    assert {platform["slug"] for platform in platforms} >= {"nintendo-switch", "playstation-5"}


async def test_facets_lead_with_the_ones_the_catalog_actually_uses(
    client: AsyncClient, catalog: list[Game]
) -> None:
    """Alphabetical is the wrong order for a list the client collapses (SPEC §6.5).

    It would open this fixture on Nintendo Switch and three PlayStations; on a
    real IGDB import it opens on "1292 Advanced Programmable Video System" and
    four AY-3-86xx chips, with PC three hundred rows below the fold.
    """
    platforms = (await client.get(f"{BROWSE}/platforms")).json()

    assert [platform["name"] for platform in platforms] == [
        "PC (Microsoft Windows)",  # on 20 of the fixture's 24 games
        "Nintendo Switch",  # 13
        "PlayStation 5",  # 12
        "PlayStation 4",  # 9
        "Xbox Series X|S",  # 8
        "Xbox One",  # 7
        # Two apiece, so the tie falls to the name — without that, rows sharing
        # a count come back in whatever order the scan produced them, and a
        # facet list that reshuffles between identical requests reads as a bug.
        "PlayStation 3",
        "Xbox 360",
        "Wii U",  # 1
    ]


async def test_the_genre_order_is_the_one_the_catalog_supports(
    client: AsyncClient, db: AsyncSession, catalog: list[Game]
) -> None:
    """Checked against the association table rather than the denormalised column,
    so a recount that stopped running would fail this rather than agree with itself."""
    counted = (
        await db.execute(
            sa.select(Genre.name, sa.func.count(game_genres.c.game_id))
            .outerjoin(game_genres, game_genres.c.genre_id == Genre.id)
            .group_by(Genre.id)
        )
    ).all()

    genres = (await client.get(f"{BROWSE}/genres")).json()

    expected = [name for name, _ in sorted(counted, key=lambda row: (-row[1], row[0]))]
    assert [genre["name"] for genre in genres] == expected


async def test_a_genre_nothing_is_filed_under_sorts_last(
    client: AsyncClient, db: AsyncSession, catalog: list[Game]
) -> None:
    """A facet can outlive the games behind it — `delete_all_games` leaves the
    lookup rows, and IGDB retires categories. It belongs under "Show all"."""
    db.add(Genre(name="Aaardvark Sim", slug="aaardvark-sim"))
    await db.commit()

    genres = (await client.get(f"{BROWSE}/genres")).json()

    assert genres[-1]["name"] == "Aaardvark Sim"


async def test_discover_carries_the_facets_in_the_same_order(
    client: AsyncClient, catalog: list[Game]
) -> None:
    """Discover is where the chips are actually drawn, and it reads its own copy."""
    discover = (await client.get(f"{BROWSE}/discover")).json()
    platforms = (await client.get(f"{BROWSE}/platforms")).json()

    assert [platform["slug"] for platform in discover["platforms"]] == [
        platform["slug"] for platform in platforms
    ]
