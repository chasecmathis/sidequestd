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
AuthHeaders = Callable[[User], dict[str, str]]


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
    """ "re" is a prefix of two seed titles (Returnal, Red Dead Redemption 2).

    A query this short matches title prefixes only — see
    `test_search_relevance.py` — so it is two results, a page each.
    """
    first = (await client.get(GAMES, params={"q": "re", "limit": 1})).json()
    assert first["next_cursor"]

    second = (
        await client.get(GAMES, params={"q": "re", "limit": 1, "cursor": first["next_cursor"]})
    ).json()

    assert len(first["items"]) == len(second["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert second["next_cursor"] is None


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


async def _usernames(
    client: AsyncClient, query: str, headers: dict[str, str] | None = None
) -> list[str]:
    response = await client.get(USERS, params={"q": query}, headers=headers or {})
    assert response.status_code == 200, response.text
    return [hit["username"] for hit in response.json()["items"]]


async def test_a_leading_at_sign_is_ignored(client: AsyncClient, make_user: MakeUser) -> None:
    """People paste handles the way the app prints them."""
    await make_user("ripley")

    assert await _usernames(client, "@ripley") == ["ripley"]


async def test_a_bare_at_sign_finds_nobody(client: AsyncClient, make_user: MakeUser) -> None:
    await make_user("ripley")

    assert await _usernames(client, "@") == []


@pytest.mark.parametrize("query", ["ripley88", "ripley 88", "ripley_88"])
async def test_punctuation_in_a_handle_is_optional(
    client: AsyncClient, make_user: MakeUser, query: str
) -> None:
    await make_user("ripley_88")

    assert await _usernames(client, query) == ["ripley_88"]


async def test_display_names_match_without_their_accents(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user("wash", display_name="Zoë Washburne")

    assert await _usernames(client, "zoe") == ["wash"]


@pytest.mark.parametrize("query", ["山田", "山田太郎"])
async def test_non_latin_display_names_stay_searchable(
    client: AsyncClient, make_user: MakeUser, query: str
) -> None:
    await make_user("yamada", display_name="山田 太郎")

    assert await _usernames(client, query) == ["yamada"]


# --- The follow graph ------------------------------------------------------
#
# Candidates here share a text score ("kane" against kane_a … kane_e), so the
# follow graph is the only thing that can order them. Tests that expect *no*
# boost compare against the signed-out order, which is ranked by text alone.


async def _follow(
    db: AsyncSession,
    follower: User,
    followee: User,
    status: FollowStatus = FollowStatus.ACCEPTED,
) -> None:
    db.add(Follow(follower_id=follower.id, followee_id=followee.id, status=status))
    await db.flush()


async def test_people_closer_in_the_follow_graph_rank_first(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    viewer = await make_user("viewer")
    await make_user("kane_a")  # a stranger
    friend_of_friend = await make_user("kane_b")
    follower = await make_user("kane_c")
    followed = await make_user("kane_d")
    mutual = await make_user("kane_e")
    middle = await make_user("lambert")

    await _follow(db, viewer, middle)
    await _follow(db, middle, friend_of_friend)
    await _follow(db, follower, viewer)
    await _follow(db, viewer, followed)
    await _follow(db, viewer, mutual)
    await _follow(db, mutual, viewer)

    assert await _usernames(client, "kane", auth_headers(viewer)) == [
        "kane_e",
        "kane_d",
        "kane_c",
        "kane_b",
        "kane_a",
    ]


async def _kanes(make_user: MakeUser, count: int) -> list[User]:
    """`count` users with equal text scores, in the order a signed-out search
    ranks them: ties break on id, descending.

    So a test can give the *first* the stranger's role and the rest roles that
    must earn nothing — any boost they wrongly earn lifts one above the
    stranger, which changes the order every time rather than when the random
    ids happen to fall that way.
    """
    users = [await make_user(f"kane_{letter}") for letter in "abcdefgh"[:count]]
    return sorted(users, key=lambda user: user.id, reverse=True)


async def test_a_pending_follow_counts_for_nothing(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """SPEC §6.7: approval, not the request, is what connects two people."""
    viewer = await make_user("viewer")
    kanes = await _kanes(make_user, 4)
    _, requested, via_requested, requester = kanes
    middle = await make_user("lambert")

    await _follow(db, viewer, requested, FollowStatus.PENDING)
    await _follow(db, viewer, middle, FollowStatus.PENDING)
    await _follow(db, middle, via_requested)
    await _follow(db, requester, viewer, FollowStatus.PENDING)

    expected = [user.username for user in kanes]
    assert await _usernames(client, "kane") == expected
    assert await _usernames(client, "kane", auth_headers(viewer)) == expected


async def test_no_path_runs_through_a_private_account_the_viewer_does_not_follow(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Its following list is gated, so ranking by it would leak what it gates."""
    viewer = await make_user("viewer")
    kanes = await _kanes(make_user, 2)
    private = await make_user("lambert", is_private=True)

    await _follow(db, private, kanes[1])
    await _follow(db, viewer, private, FollowStatus.PENDING)

    assert await _usernames(client, "kane", auth_headers(viewer)) == [
        user.username for user in kanes
    ]


async def test_the_viewer_gets_no_boost_from_a_path_back_to_themselves(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    kanes = await _kanes(make_user, 2)
    viewer = kanes[1]
    friend = await make_user("lambert")

    await _follow(db, viewer, friend)
    await _follow(db, friend, viewer)

    assert await _usernames(client, "kane", auth_headers(viewer)) == [
        user.username for user in kanes
    ]


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
