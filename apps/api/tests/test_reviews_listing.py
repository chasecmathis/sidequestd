"""The profile reviews grid — `GET /users/{id}/reviews` (SPEC §6.2, §8)."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus
from app.models.game import Game
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User
from app.services import media as media_service
from tests.conftest import PNG_4X2, FakeObjectStore

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


def reviews_url(user: User) -> str:
    return f"/api/v1/users/{user.id}/reviews"


async def write_review(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    game: Game,
    *,
    minutes_ago: int = 0,
) -> dict[str, object]:
    """Post a review and, optionally, backdate it.

    Backdating matters because `created_at` defaults to `now()`, which in Postgres
    is the *transaction* clock: everything a single test writes would otherwise
    carry an identical timestamp, and "newest first" would be untestable.
    """
    response = await client.post(
        "/api/v1/reviews", headers=headers, json={"game_id": str(game.id), "rating": 8}
    )
    assert response.status_code == 201, response.text
    body = dict(response.json())

    if minutes_ago:
        await db.execute(
            sa.update(Review)
            .where(Review.id == uuid.UUID(str(body["id"])))
            .values(created_at=sa.text(f"now() - interval '{minutes_ago} minutes'"))
        )
        await db.flush()
    return body


@pytest.fixture
async def author(make_user: MakeUser) -> User:
    return await make_user("ripley", display_name="Ellen Ripley")


@pytest.fixture
def author_headers(author: User, auth_headers: AuthHeaders) -> dict[str, str]:
    return auth_headers(author)


# --- Ordering and paging ----------------------------------------------------


async def test_an_author_with_nothing_yet_gets_an_empty_page(
    client: AsyncClient, author: User
) -> None:
    body = (await client.get(reviews_url(author))).json()

    assert body["items"] == []
    assert body["next_cursor"] is None


async def test_reviews_come_back_newest_first(
    client: AsyncClient,
    db: AsyncSession,
    author: User,
    author_headers: dict[str, str],
    catalog: list[Game],
) -> None:
    oldest = await write_review(client, db, author_headers, catalog[0], minutes_ago=30)
    middle = await write_review(client, db, author_headers, catalog[1], minutes_ago=20)
    newest = await write_review(client, db, author_headers, catalog[2], minutes_ago=10)

    items = (await client.get(reviews_url(author))).json()["items"]

    assert [item["id"] for item in items] == [newest["id"], middle["id"], oldest["id"]]


async def test_paging_repeats_nothing_and_skips_nothing(
    client: AsyncClient,
    db: AsyncSession,
    author: User,
    author_headers: dict[str, str],
    catalog: list[Game],
) -> None:
    for index in range(5):
        await write_review(client, db, author_headers, catalog[index], minutes_ago=60 - index)

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(3):
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = (await client.get(reviews_url(author), params=params)).json()
        seen.extend(item["id"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert len(seen) == 5
    assert len(set(seen)) == 5
    assert cursor is None


async def test_a_hand_edited_cursor_is_rejected(client: AsyncClient, author: User) -> None:
    response = await client.get(reviews_url(author), params={"cursor": "not-a-cursor"})

    assert response.status_code == 400


async def test_only_this_authors_reviews_are_listed(
    client: AsyncClient,
    db: AsyncSession,
    author: User,
    author_headers: dict[str, str],
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    await write_review(client, db, author_headers, catalog[0])
    other = await make_user("hicks")
    await write_review(client, db, auth_headers(other), catalog[1])

    items = (await client.get(reviews_url(author))).json()["items"]

    assert len(items) == 1
    assert items[0]["author"]["username"] == "ripley"


async def test_narrowing_to_one_game(
    client: AsyncClient,
    db: AsyncSession,
    author: User,
    author_headers: dict[str, str],
    catalog: list[Game],
) -> None:
    # How a client that just hit the one-review-per-game conflict finds the review
    # it should be editing instead.
    await write_review(client, db, author_headers, catalog[0])
    wanted = await write_review(client, db, author_headers, catalog[1])

    body = (await client.get(reviews_url(author), params={"game": str(catalog[1].id)})).json()

    assert [item["id"] for item in body["items"]] == [wanted["id"]]


async def test_narrowing_to_an_unreviewed_game_is_empty_not_an_error(
    client: AsyncClient, author: User, catalog: list[Game]
) -> None:
    body = (await client.get(reviews_url(author), params={"game": str(catalog[0].id)})).json()

    assert body["items"] == []


async def test_an_unknown_author_is_a_404(client: AsyncClient) -> None:
    assert (await client.get(f"/api/v1/users/{uuid.uuid4()}/reviews")).status_code == 404


# --- What a grid tile carries -----------------------------------------------


async def test_a_tile_carries_the_game_and_the_rating(
    client: AsyncClient,
    db: AsyncSession,
    author: User,
    author_headers: dict[str, str],
    catalog: list[Game],
) -> None:
    await write_review(client, db, author_headers, catalog[0])

    item = (await client.get(reviews_url(author))).json()["items"][0]

    assert item["game"]["title"] == catalog[0].title
    assert item["rating"] == 8
    assert item["stars"] == 4.0


async def test_a_tile_uses_the_media_thumbnail_once_it_exists(
    client: AsyncClient,
    db: AsyncSession,
    author: User,
    author_headers: dict[str, str],
    catalog: list[Game],
    object_store: FakeObjectStore,
) -> None:
    review = await write_review(client, db, author_headers, catalog[0])
    upload = await client.post(
        f"/api/v1/reviews/{review['id']}/media",
        headers=author_headers,
        files={"file": ("shot.png", PNG_4X2, "image/png")},
    )
    await media_service.process_media(db, uuid.UUID(upload.json()["id"]))

    item = (await client.get(reviews_url(author))).json()["items"][0]

    assert item["thumbnail_url"].endswith("_thumb.jpg")
    assert item["media_count"] == 1


async def test_interaction_counts_are_wired_and_read_zero(
    client: AsyncClient,
    db: AsyncSession,
    author: User,
    author_headers: dict[str, str],
    catalog: list[Game],
) -> None:
    # Likes and comments are the Interactions slice; the fields exist now so the
    # clients do not have to change shape when they start moving.
    await write_review(client, db, author_headers, catalog[0])

    item = (await client.get(reviews_url(author), headers=author_headers)).json()["items"][0]

    assert item["like_count"] == 0
    assert item["comment_count"] == 0
    assert item["viewer_has_liked"] is False


# --- Privacy (SPEC §6.7) ----------------------------------------------------


@pytest.fixture
async def private_author(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> User:
    author = await make_user("newt", is_private=True)
    await write_review(client, db, auth_headers(author), catalog[0])
    return author


async def test_a_private_grid_is_withheld_from_strangers(
    client: AsyncClient, private_author: User
) -> None:
    # 403 rather than an empty page: an empty list would read as "they have
    # written nothing", which is a different and untrue statement.
    response = await client.get(reviews_url(private_author))

    assert response.status_code == 403


async def test_an_approved_follower_sees_the_grid(
    client: AsyncClient,
    db: AsyncSession,
    private_author: User,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    follower = await make_user("bishop")
    db.add(
        Follow(
            follower_id=follower.id,
            followee_id=private_author.id,
            status=FollowStatus.ACCEPTED,
        )
    )
    await db.flush()

    response = await client.get(reviews_url(private_author), headers=auth_headers(follower))

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1


async def test_a_pending_request_does_not_open_the_grid(
    client: AsyncClient,
    db: AsyncSession,
    private_author: User,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    asker = await make_user("burke")
    db.add(Follow(follower_id=asker.id, followee_id=private_author.id, status=FollowStatus.PENDING))
    await db.flush()

    response = await client.get(reviews_url(private_author), headers=auth_headers(asker))

    assert response.status_code == 403


async def test_the_author_always_sees_their_own_grid(
    client: AsyncClient, private_author: User, auth_headers: AuthHeaders
) -> None:
    response = await client.get(reviews_url(private_author), headers=auth_headers(private_author))

    assert response.status_code == 200
