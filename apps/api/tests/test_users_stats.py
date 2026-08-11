"""Profile stats — SPEC §6.8.

Mostly written straight to the database, because what is under test is the
aggregation rather than the endpoints that produce the rows. The exception is at
the bottom: `backlog_count` and `completed_count` were computed defensively
against a table nothing wrote to yet, so one test drives the real backlog
endpoints end to end to show the two figures now move for the reason they say.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus, FollowStatus
from app.models.game import Game
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


def stats_url(user: User) -> str:
    return f"/api/v1/users/{user.id}/stats"


def bucket(body: dict[str, object], rating: int) -> int:
    buckets = body["rating_distribution"]
    return next(entry["count"] for entry in buckets if entry["rating"] == rating)  # type: ignore[index,union-attr]


# --- The zero-data case ----------------------------------------------------


async def test_a_brand_new_account_reports_zeroes_rather_than_erroring(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """Reviews and backlog arrive in later slices, so this is the normal case today."""
    user = await make_user("ripley")

    response = await client.get(stats_url(user))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["review_count"] == 0
    assert body["games_reviewed"] == 0
    assert body["total_playtime_minutes"] == 0
    assert body["completed_count"] == 0
    assert body["backlog_count"] == 0


async def test_an_unrated_account_has_a_null_average_not_a_zero(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """An average of nothing is not 0.0, and a 0.0 would render as a one-star user."""
    user = await make_user("ripley")

    assert (await client.get(stats_url(user))).json()["average_rating"] is None


async def test_the_distribution_is_always_ten_zero_filled_buckets(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """So a client can draw the axis without checking for holes."""
    user = await make_user("ripley")

    buckets = (await client.get(stats_url(user))).json()["rating_distribution"]

    assert [entry["rating"] for entry in buckets] == list(range(1, 11))
    assert all(entry["count"] == 0 for entry in buckets)


# --- Aggregation -----------------------------------------------------------


async def test_review_counts_and_average(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    user = await make_user("ripley")
    for game, rating in zip(catalog[:3], (10, 8, 6), strict=True):
        db.add(Review(user_id=user.id, game_id=game.id, rating=rating))
    await db.flush()

    body = (await client.get(stats_url(user))).json()

    assert body["review_count"] == 3
    assert body["games_reviewed"] == 3
    assert body["average_rating"] == 8.0


async def test_the_rating_distribution_counts_each_score(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    user = await make_user("ripley")
    for game, rating in zip(catalog[:3], (9, 9, 4), strict=True):
        db.add(Review(user_id=user.id, game_id=game.id, rating=rating))
    await db.flush()

    body = (await client.get(stats_url(user))).json()

    assert bucket(body, 9) == 2
    assert bucket(body, 4) == 1
    assert bucket(body, 10) == 0


async def test_playtime_sums_only_the_reviews_that_recorded_it(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    """`playtime_minutes` is nullable — SPEC §6.8 says "if provided"."""
    user = await make_user("ripley")
    db.add(Review(user_id=user.id, game_id=catalog[0].id, rating=8, playtime_minutes=600))
    db.add(Review(user_id=user.id, game_id=catalog[1].id, rating=8, playtime_minutes=None))
    db.add(Review(user_id=user.id, game_id=catalog[2].id, rating=8, playtime_minutes=120))
    await db.flush()

    assert (await client.get(stats_url(user))).json()["total_playtime_minutes"] == 720


async def test_backlog_counts_come_from_the_right_lists(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    """`backlog_count` is the To Be Played list specifically, not all four."""
    user = await make_user("ripley")
    statuses = (
        BacklogStatus.TO_BE_PLAYED,
        BacklogStatus.TO_BE_PLAYED,
        BacklogStatus.COMPLETED,
        BacklogStatus.PLAYING,
        BacklogStatus.DROPPED,
    )
    for game, status in zip(catalog[:5], statuses, strict=True):
        db.add(BacklogItem(user_id=user.id, game_id=game.id, status=status, position=0))
    await db.flush()

    body = (await client.get(stats_url(user))).json()

    assert body["backlog_count"] == 2
    assert body["completed_count"] == 1


async def test_the_backlog_endpoints_move_the_backlog_figures(
    client: AsyncClient,
    registered_user: dict[str, object],
    catalog: list[Game],
) -> None:
    """SPEC §6.8's two backlog figures, driven the way a user drives them.

    The aggregation above has been right since the schema slice, but nothing had
    ever written a row through the API to prove the two ends agree about what a
    "backlog" and a "completed" are — `backlog_count` is the To Be Played list
    alone, so a game that reaches Completed leaves one figure as it joins the
    other.
    """
    headers = {"Authorization": f"Bearer {registered_user['access_token']}"}
    user_id = registered_user["user"]["id"]  # type: ignore[index]
    url = f"/api/v1/users/{user_id}/stats"

    for game in catalog[:3]:
        response = await client.put(
            f"/api/v1/backlog/{game.id}", headers=headers, json={"status": "TO_BE_PLAYED"}
        )
        assert response.status_code == 200, response.text

    added = (await client.get(url, headers=headers)).json()
    assert added["backlog_count"] == 3
    assert added["completed_count"] == 0

    await client.put(
        f"/api/v1/backlog/{catalog[0].id}", headers=headers, json={"status": "COMPLETED"}
    )

    finished = (await client.get(url, headers=headers)).json()
    assert finished["backlog_count"] == 2
    assert finished["completed_count"] == 1


async def test_another_users_activity_is_not_counted(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    user = await make_user("ripley")
    other = await make_user("hicks")
    db.add(Review(user_id=other.id, game_id=catalog[0].id, rating=10))
    await db.flush()

    assert (await client.get(stats_url(user))).json()["review_count"] == 0


async def test_member_since_is_the_account_creation_date(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user("ripley")

    body = (await client.get(stats_url(user))).json()

    assert body["member_since"].startswith(user.created_at.date().isoformat())


# --- Privacy (SPEC §6.7) ---------------------------------------------------


async def test_a_private_accounts_stats_are_refused_to_a_stranger(
    client: AsyncClient, make_user: MakeUser
) -> None:
    user = await make_user("newt", is_private=True)

    response = await client.get(stats_url(user))

    assert response.status_code == 403


async def test_an_approved_follower_may_read_them(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    user = await make_user("newt", is_private=True)
    follower = await make_user("hicks")
    db.add(Follow(follower_id=follower.id, followee_id=user.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.get(stats_url(user), headers=auth_headers(follower))

    assert response.status_code == 200


async def test_a_pending_request_does_not_unlock_them(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    user = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    db.add(Follow(follower_id=hopeful.id, followee_id=user.id, status=FollowStatus.PENDING))
    await db.flush()

    response = await client.get(stats_url(user), headers=auth_headers(hopeful))

    assert response.status_code == 403


async def test_the_owner_may_always_read_their_own(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    user = await make_user("newt", is_private=True)

    response = await client.get(stats_url(user), headers=auth_headers(user))

    assert response.status_code == 200


async def test_stats_for_an_unknown_user_are_a_404(client: AsyncClient) -> None:
    assert (await client.get(f"/api/v1/users/{uuid.uuid4()}/stats")).status_code == 404
