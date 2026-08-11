"""Game and user search — SPEC §6.6, and the privacy gate from §6.7."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus
from app.models.game import Game
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User

GAMES = "/api/v1/search/games"
USERS = "/api/v1/search/users"

MakeUser = Callable[..., Awaitable[User]]


# --- Game search -----------------------------------------------------------


async def test_search_matches_a_substring_of_the_title(
    client: AsyncClient, catalog: list[Game]
) -> None:
    response = await client.get(GAMES, params={"q": "witcher"})

    assert response.status_code == 200, response.text
    assert [card["title"] for card in response.json()["items"]] == ["The Witcher 3: Wild Hunt"]


async def test_search_is_case_insensitive(client: AsyncClient, catalog: list[Game]) -> None:
    lower = (await client.get(GAMES, params={"q": "hades"})).json()["items"]
    upper = (await client.get(GAMES, params={"q": "HADES"})).json()["items"]

    assert [card["id"] for card in lower] == [card["id"] for card in upper]
    assert {card["title"] for card in lower} == {"Hades", "Hades II"}


async def test_the_closest_title_ranks_first(client: AsyncClient, catalog: list[Game]) -> None:
    """ "hades" is a better match for "Hades" than for "Hades II"."""
    response = await client.get(GAMES, params={"q": "hades"})

    assert response.json()["items"][0]["title"] == "Hades"


async def test_results_carry_what_a_card_renders(client: AsyncClient, catalog: list[Game]) -> None:
    card = (await client.get(GAMES, params={"q": "celeste"})).json()["items"][0]

    assert card["cover_url"]
    assert card["release_year"] == 2018
    assert "nintendo-switch" in {platform["slug"] for platform in card["platforms"]}


async def test_wildcards_in_the_query_are_escaped(client: AsyncClient, catalog: list[Game]) -> None:
    """'%' must be a literal, not a match-everything."""
    response = await client.get(GAMES, params={"q": "%"})

    assert response.status_code == 200
    assert response.json()["items"] == []


async def test_no_match_is_an_empty_page_not_an_error(
    client: AsyncClient, catalog: list[Game]
) -> None:
    response = await client.get(GAMES, params={"q": "qzxwv"})

    assert response.status_code == 200
    assert response.json() == {"items": [], "next_cursor": None}


async def test_an_empty_query_is_rejected(client: AsyncClient) -> None:
    assert (await client.get(GAMES, params={"q": ""})).status_code == 422
    assert (await client.get(GAMES)).status_code == 422


async def test_search_results_page(client: AsyncClient, catalog: list[Game]) -> None:
    first = (await client.get(GAMES, params={"q": "a", "limit": 3})).json()
    assert first["next_cursor"]

    second = (
        await client.get(GAMES, params={"q": "a", "limit": 3, "cursor": first["next_cursor"]})
    ).json()

    assert not {card["id"] for card in first["items"]} & {card["id"] for card in second["items"]}


# --- User search -----------------------------------------------------------


async def test_users_are_found_by_handle_and_display_name(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user("ripley", display_name="Ellen Ripley")

    by_handle = (await client.get(USERS, params={"q": "ripley"})).json()["items"]
    by_name = (await client.get(USERS, params={"q": "ellen"})).json()["items"]

    assert [hit["username"] for hit in by_handle] == ["ripley"]
    assert [hit["username"] for hit in by_name] == ["ripley"]


async def test_a_handle_match_outranks_a_display_name_match(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user("bishop", display_name="Someone Else")
    await make_user("someone", display_name="Bishop Android")

    response = await client.get(USERS, params={"q": "bishop"})

    assert [hit["username"] for hit in response.json()["items"]] == ["bishop", "someone"]


async def test_deactivated_accounts_are_not_searchable(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user("burke")
    user.is_active = False
    await db.flush()

    response = await client.get(USERS, params={"q": "burke"})

    assert response.json()["items"] == []


# --- Privacy gating (SPEC §6.7) --------------------------------------------


async def test_a_private_account_still_appears_in_search(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Hiding it would make sending a follow request impossible."""
    await make_user("newt", display_name="Rebecca Jorden", is_private=True)

    hits = (await client.get(USERS, params={"q": "newt"})).json()["items"]

    assert len(hits) == 1
    assert hits[0]["username"] == "newt"
    assert hits[0]["is_private"] is True


async def test_a_private_accounts_stats_are_withheld_from_a_stranger(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    private = await make_user("newt", is_private=True)
    db.add(Review(user_id=private.id, game_id=catalog[0].id, rating=8))
    await db.flush()

    hit = (await client.get(USERS, params={"q": "newt"})).json()["items"][0]

    assert hit["review_count"] is None, "a private account leaked a gated stat"


async def test_a_public_accounts_stats_are_visible_to_anyone(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    public = await make_user("hicks")
    db.add(Review(user_id=public.id, game_id=catalog[0].id, rating=9))
    await db.flush()

    hit = (await client.get(USERS, params={"q": "hicks"})).json()["items"][0]

    assert hit["review_count"] == 1


async def test_an_approved_follower_sees_a_private_accounts_stats(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    registered_user: dict[str, object],
    catalog: list[Game],
) -> None:
    private = await make_user("newt", is_private=True)
    db.add(Review(user_id=private.id, game_id=catalog[0].id, rating=7))
    db.add(
        Follow(
            follower_id=registered_user["user"]["id"],  # type: ignore[index]
            followee_id=private.id,
            status=FollowStatus.ACCEPTED,
        )
    )
    await db.flush()

    hit = (
        await client.get(
            USERS,
            params={"q": "newt"},
            headers={"Authorization": f"Bearer {registered_user['access_token']}"},
        )
    ).json()["items"][0]

    assert hit["review_count"] == 1


@pytest.mark.parametrize("status", [FollowStatus.PENDING])
async def test_a_pending_follow_request_does_not_unlock_stats(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    registered_user: dict[str, object],
    catalog: list[Game],
    status: FollowStatus,
) -> None:
    """SPEC §6.7: approval, not the request, is what grants access."""
    private = await make_user("newt", is_private=True)
    db.add(Review(user_id=private.id, game_id=catalog[0].id, rating=7))
    db.add(
        Follow(
            follower_id=registered_user["user"]["id"],  # type: ignore[index]
            followee_id=private.id,
            status=status,
        )
    )
    await db.flush()

    hit = (
        await client.get(
            USERS,
            params={"q": "newt"},
            headers={"Authorization": f"Bearer {registered_user['access_token']}"},
        )
    ).json()["items"][0]

    assert hit["review_count"] is None


async def test_a_private_user_sees_their_own_stats(
    client: AsyncClient, db: AsyncSession, registered_user: dict[str, object], catalog: list[Game]
) -> None:
    user = await db.get(User, registered_user["user"]["id"])  # type: ignore[index]
    assert user is not None
    user.is_private = True
    db.add(Review(user_id=user.id, game_id=catalog[0].id, rating=6))
    await db.flush()

    hit = (
        await client.get(
            USERS,
            params={"q": "ripley"},
            headers={"Authorization": f"Bearer {registered_user['access_token']}"},
        )
    ).json()["items"][0]

    assert hit["review_count"] == 1


async def test_a_stale_token_degrades_to_anonymous_rather_than_401(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user("vasquez")

    response = await client.get(
        USERS, params={"q": "vasquez"}, headers={"Authorization": "Bearer not-a-jwt"}
    )

    assert response.status_code == 200
    assert [hit["username"] for hit in response.json()["items"]] == ["vasquez"]


async def test_the_email_is_never_part_of_a_search_result(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """SPEC §7: email is private."""
    await make_user("ripley", display_name="Ellen Ripley")

    body = (await client.get(USERS, params={"q": "ripley"})).text

    assert "example.com" not in body
    assert "email" not in body
