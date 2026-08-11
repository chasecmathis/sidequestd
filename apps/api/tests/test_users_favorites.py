"""The curated favorite-games list — SPEC §6.2."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from app.models.game import Game
from app.models.user import MAX_FAVORITE_GAMES, User

FAVORITES = "/api/v1/users/me/favorites"

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


@pytest.fixture
def headers(registered_user: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {registered_user['access_token']}"}


async def _pin(client: AsyncClient, headers: dict[str, str], game: Game) -> list[dict[str, object]]:
    response = await client.post(FAVORITES, headers=headers, json={"game_id": str(game.id)})
    assert response.status_code == 201, response.text
    return list(response.json())


def titles(entries: list[dict[str, object]]) -> list[str]:
    return [entry["game"]["title"] for entry in entries]  # type: ignore[index]


# --- Adding ----------------------------------------------------------------


async def test_pinning_a_game(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    entries = await _pin(client, headers, catalog[0])

    assert len(entries) == 1
    assert entries[0]["position"] == 0
    assert entries[0]["game"]["id"] == str(catalog[0].id)  # type: ignore[index]


async def test_the_card_carries_what_the_profile_renders(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    game = next(game for game in catalog if game.title == "Celeste")

    card = (await _pin(client, headers, game))[0]["game"]

    assert card["release_year"] == 2018  # type: ignore[index]
    assert card["platforms"]  # type: ignore[index]


async def test_games_are_appended_in_the_order_they_were_pinned(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await _pin(client, headers, catalog[0])
    await _pin(client, headers, catalog[1])
    entries = await _pin(client, headers, catalog[2])

    assert [entry["position"] for entry in entries] == [0, 1, 2]
    assert titles(entries) == [catalog[0].title, catalog[1].title, catalog[2].title]


async def test_pinning_the_same_game_twice_is_a_conflict(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await _pin(client, headers, catalog[0])

    response = await client.post(FAVORITES, headers=headers, json={"game_id": str(catalog[0].id)})

    assert response.status_code == 409
    assert response.json()["field"] == "game_id"


async def test_pinning_a_game_that_is_not_in_the_catalog_is_a_404(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    response = await client.post(FAVORITES, headers=headers, json={"game_id": str(uuid.uuid4())})

    assert response.status_code == 404


async def test_the_list_is_capped(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """SPEC §6.2 calls this "a short pinned/curated list"."""
    for game in catalog[:MAX_FAVORITE_GAMES]:
        await _pin(client, headers, game)

    response = await client.post(
        FAVORITES, headers=headers, json={"game_id": str(catalog[MAX_FAVORITE_GAMES].id)}
    )

    assert response.status_code == 409
    assert str(MAX_FAVORITE_GAMES) in response.json()["detail"]


# --- Removing --------------------------------------------------------------


async def test_unpinning_a_game(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await _pin(client, headers, catalog[0])
    await _pin(client, headers, catalog[1])

    response = await client.delete(f"{FAVORITES}/{catalog[0].id}", headers=headers)

    assert response.status_code == 200
    assert titles(response.json()) == [catalog[1].title]


async def test_removing_closes_the_gap_in_the_positions(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """Positions stay dense, so the next add lands at the end rather than on top
    of an existing entry."""
    for game in catalog[:3]:
        await _pin(client, headers, game)

    remaining = (await client.delete(f"{FAVORITES}/{catalog[0].id}", headers=headers)).json()

    assert [entry["position"] for entry in remaining] == [0, 1]

    after_add = await _pin(client, headers, catalog[3])
    assert [entry["position"] for entry in after_add] == [0, 1, 2]


async def test_unpinning_something_that_is_not_pinned_is_a_404(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    response = await client.delete(f"{FAVORITES}/{catalog[0].id}", headers=headers)

    assert response.status_code == 404


# --- Reordering ------------------------------------------------------------


async def test_reordering(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    for game in catalog[:3]:
        await _pin(client, headers, game)
    reversed_ids = [str(game.id) for game in reversed(catalog[:3])]

    response = await client.put(FAVORITES, headers=headers, json={"game_ids": reversed_ids})

    assert response.status_code == 200, response.text
    entries = response.json()
    assert [entry["game"]["id"] for entry in entries] == reversed_ids
    assert [entry["position"] for entry in entries] == [0, 1, 2]


async def test_the_new_order_survives_a_reread(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    for game in catalog[:3]:
        await _pin(client, headers, game)
    reversed_ids = [str(game.id) for game in reversed(catalog[:3])]
    await client.put(FAVORITES, headers=headers, json={"game_ids": reversed_ids})

    entries = (await client.get(FAVORITES, headers=headers)).json()

    assert [entry["game"]["id"] for entry in entries] == reversed_ids


async def test_a_reorder_that_drops_a_game_is_rejected(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """A partial list means the client is stale; applying it would silently unpin."""
    for game in catalog[:3]:
        await _pin(client, headers, game)

    response = await client.put(FAVORITES, headers=headers, json={"game_ids": [str(catalog[0].id)]})

    assert response.status_code == 400
    assert len((await client.get(FAVORITES, headers=headers)).json()) == 3


async def test_a_reorder_that_introduces_a_new_game_is_rejected(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await _pin(client, headers, catalog[0])

    response = await client.put(
        FAVORITES,
        headers=headers,
        json={"game_ids": [str(catalog[0].id), str(catalog[1].id)]},
    )

    assert response.status_code == 400


async def test_a_reorder_with_a_duplicate_is_rejected(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """Two slots for one game has no meaning, and the set check alone would miss it."""
    await _pin(client, headers, catalog[0])
    await _pin(client, headers, catalog[1])

    response = await client.put(
        FAVORITES,
        headers=headers,
        json={"game_ids": [str(catalog[0].id), str(catalog[0].id)]},
    )

    assert response.status_code == 400


# --- Ownership -------------------------------------------------------------


async def test_favorites_require_authentication(client: AsyncClient, catalog: list[Game]) -> None:
    assert (await client.get(FAVORITES)).status_code == 401
    assert (await client.post(FAVORITES, json={"game_id": str(catalog[0].id)})).status_code == 401


async def test_one_users_favorites_are_not_anothers(
    client: AsyncClient,
    headers: dict[str, str],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    await _pin(client, headers, catalog[0])
    other = await make_user("hicks")

    assert (await client.get(FAVORITES, headers=auth_headers(other))).json() == []


async def test_favorites_appear_on_the_public_profile(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await _pin(client, headers, catalog[0])

    body = (await client.get("/api/v1/users/ripley")).json()

    assert titles(body["favorite_games"]) == [catalog[0].title]
