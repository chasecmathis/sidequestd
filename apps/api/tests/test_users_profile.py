"""Public profiles and the privacy shell — SPEC §6.2, §6.7."""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus
from app.models.game import Game
from app.models.review import Review
from app.models.social import Follow
from app.models.user import FavoriteGame, User

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


def profile_url(username: str) -> str:
    return f"/api/v1/users/{username}"


# --- The public shell ------------------------------------------------------


async def test_a_profile_is_readable_signed_out(client: AsyncClient, make_user: MakeUser) -> None:
    await make_user("ripley", display_name="Ellen Ripley", bio="Nostromo, warrant officer.")

    response = await client.get(profile_url("ripley"))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["username"] == "ripley"
    assert body["display_name"] == "Ellen Ripley"
    assert body["bio"] == "Nostromo, warrant officer."
    assert body["can_view_content"] is True
    assert body["is_viewer"] is False


async def test_the_lookup_is_case_insensitive(client: AsyncClient, make_user: MakeUser) -> None:
    """Handles are stored lower-cased, and a link may arrive capitalised."""
    await make_user("ripley")

    assert (await client.get(profile_url("RIPLEY"))).status_code == 200


async def test_an_unknown_handle_is_a_404(client: AsyncClient) -> None:
    assert (await client.get(profile_url("nobody"))).status_code == 404


async def test_a_deactivated_account_has_no_profile(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user("burke")
    user.is_active = False
    await db.flush()

    assert (await client.get(profile_url("burke"))).status_code == 404


async def test_a_profile_never_carries_the_email_or_password(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """SPEC §7: email is private, and the hash is private to the database."""
    await make_user("ripley")

    body = (await client.get(profile_url("ripley"))).text

    assert "example.com" not in body
    assert "hashed_password" not in body


async def test_your_own_profile_is_flagged_as_yours(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    """The web client keys its "Edit profile" affordance off this."""
    response = await client.get(
        profile_url("ripley"),
        headers={"Authorization": f"Bearer {registered_user['access_token']}"},
    )

    assert response.json()["is_viewer"] is True


# --- Follower counts -------------------------------------------------------


async def test_follower_and_following_counts(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("ripley")
    fan = await make_user("hicks")
    idol = await make_user("bishop")
    db.add(Follow(follower_id=fan.id, followee_id=subject.id, status=FollowStatus.ACCEPTED))
    db.add(Follow(follower_id=subject.id, followee_id=idol.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    body = (await client.get(profile_url("ripley"))).json()

    assert body["follower_count"] == 1
    assert body["following_count"] == 1


async def test_a_pending_request_is_not_yet_a_follower(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    subject = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    db.add(Follow(follower_id=hopeful.id, followee_id=subject.id, status=FollowStatus.PENDING))
    await db.flush()

    assert (await client.get(profile_url("newt"))).json()["follower_count"] == 0


# --- Private accounts (SPEC §6.7) ------------------------------------------


async def test_a_private_profile_returns_its_shell_not_a_403(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser
) -> None:
    """A stranger has to be able to see who they are about to request to follow."""
    subject = await make_user("newt", display_name="Rebecca Jorden", bio="Survivor.")
    subject.is_private = True
    fan = await make_user("hicks")
    db.add(Follow(follower_id=fan.id, followee_id=subject.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.get(profile_url("newt"))

    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] == "Rebecca Jorden"
    assert body["bio"] == "Survivor."
    assert body["follower_count"] == 1


async def test_a_private_profile_withholds_stats_and_favorites_from_a_stranger(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    subject = await make_user("newt", is_private=True)
    db.add(Review(user_id=subject.id, game_id=catalog[0].id, rating=9))
    db.add(FavoriteGame(user_id=subject.id, game_id=catalog[0].id, position=0))
    await db.flush()

    body = (await client.get(profile_url("newt"))).json()

    assert body["can_view_content"] is False
    assert body["stats"] is None
    assert body["favorite_games"] == []


async def test_an_approved_follower_sees_a_private_profiles_content(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    subject = await make_user("newt", is_private=True)
    follower = await make_user("hicks")
    db.add(Review(user_id=subject.id, game_id=catalog[0].id, rating=9))
    db.add(FavoriteGame(user_id=subject.id, game_id=catalog[0].id, position=0))
    db.add(Follow(follower_id=follower.id, followee_id=subject.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    body = (await client.get(profile_url("newt"), headers=auth_headers(follower))).json()

    assert body["can_view_content"] is True
    assert body["stats"]["review_count"] == 1
    assert len(body["favorite_games"]) == 1


async def test_a_pending_follower_still_sees_only_the_shell(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    """SPEC §6.7: approval, not the request, is what grants access."""
    subject = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    db.add(Review(user_id=subject.id, game_id=catalog[0].id, rating=9))
    db.add(Follow(follower_id=hopeful.id, followee_id=subject.id, status=FollowStatus.PENDING))
    await db.flush()

    body = (await client.get(profile_url("newt"), headers=auth_headers(hopeful))).json()

    assert body["can_view_content"] is False
    assert body["stats"] is None


async def test_a_private_user_sees_their_own_content(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    subject = await make_user("newt", is_private=True)
    db.add(Review(user_id=subject.id, game_id=catalog[0].id, rating=9))
    await db.flush()

    body = (await client.get(profile_url("newt"), headers=auth_headers(subject))).json()

    assert body["can_view_content"] is True
    assert body["stats"]["review_count"] == 1


async def test_a_stale_token_degrades_to_anonymous_rather_than_401(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user("ripley")

    response = await client.get(
        profile_url("ripley"), headers={"Authorization": "Bearer not-a-jwt"}
    )

    assert response.status_code == 200
    assert response.json()["is_viewer"] is False


# --- Route precedence ------------------------------------------------------


async def test_the_literal_routes_are_not_swallowed_by_the_handle_route(
    client: AsyncClient, registered_user: dict[str, object]
) -> None:
    """`/users/me` and `/users/username-available` must not be read as handles."""
    headers = {"Authorization": f"Bearer {registered_user['access_token']}"}

    assert (await client.get("/api/v1/users/me", headers=headers)).status_code == 200
    assert (
        await client.get("/api/v1/users/username-available", params={"username": "someone"})
    ).status_code == 200
