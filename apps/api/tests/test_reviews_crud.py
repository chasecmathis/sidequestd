"""Creating, reading, editing and deleting a review — SPEC §6.3, §8."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus
from app.models.game import Game
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User
from tests.conftest import PNG_1PX, FakeObjectStore

REVIEWS = "/api/v1/reviews"

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


@pytest.fixture
def headers(registered_user: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {registered_user['access_token']}"}


async def post_review(
    client: AsyncClient, headers: dict[str, str], game: Game, **fields: object
) -> dict[str, object]:
    payload: dict[str, object] = {"game_id": str(game.id), "rating": 8, **fields}
    response = await client.post(REVIEWS, headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return dict(response.json())


# --- Creating ---------------------------------------------------------------


async def test_reviewing_a_game(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(
        client, headers, catalog[0], review_text="Astonishing.", playtime_minutes=930
    )

    assert review["rating"] == 8
    assert review["review_text"] == "Astonishing."
    assert review["playtime_minutes"] == 930
    assert review["game"]["id"] == str(catalog[0].id)  # type: ignore[index]


async def test_the_rating_is_also_reported_in_stars(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    # SPEC §6.3 stores 1-10 and displays 0.5-5.0. Both are on the wire so four
    # clients cannot each invent their own halving.
    review = await post_review(client, headers, catalog[0], rating=7)

    assert review["stars"] == 3.5


async def test_a_review_starts_with_no_media_and_no_interactions(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0])

    assert review["media"] == []
    assert review["media_count"] == 0
    assert review["like_count"] == 0
    assert review["comment_count"] == 0
    assert review["viewer_has_liked"] is False


async def test_the_grid_thumbnail_falls_back_to_the_cover_art(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    # SPEC §6.2's grid has to render a tile for a review with no photos at all.
    game = next(game for game in catalog if game.cover_url)

    review = await post_review(client, headers, game)

    assert review["thumbnail_url"] == game.cover_url


async def test_text_and_playtime_are_optional(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0])

    assert review["review_text"] is None
    assert review["playtime_minutes"] is None


async def test_reviewing_the_same_game_twice_is_a_conflict(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    # SPEC §6.3: one review per user per game, and the way forward is to edit.
    await post_review(client, headers, catalog[0])

    response = await client.post(
        REVIEWS, headers=headers, json={"game_id": str(catalog[0].id), "rating": 4}
    )

    assert response.status_code == 409
    assert response.json()["field"] == "game_id"
    assert "edit" in response.json()["detail"].lower()


async def test_two_people_may_review_the_same_game(
    client: AsyncClient,
    headers: dict[str, str],
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    await post_review(client, headers, catalog[0])

    other = await make_user("hicks")
    await post_review(client, auth_headers(other), catalog[0])


async def test_reviewing_a_game_that_is_not_in_the_catalog_is_a_404(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    response = await client.post(
        REVIEWS, headers=headers, json={"game_id": str(uuid.uuid4()), "rating": 8}
    )

    assert response.status_code == 404


@pytest.mark.parametrize("rating", [0, 11, -1])
async def test_ratings_outside_the_scale_are_rejected(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game], rating: int
) -> None:
    response = await client.post(
        REVIEWS, headers=headers, json={"game_id": str(catalog[0].id), "rating": rating}
    )

    assert response.status_code == 422


async def test_negative_playtime_is_rejected(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    response = await client.post(
        REVIEWS,
        headers=headers,
        json={"game_id": str(catalog[0].id), "rating": 8, "playtime_minutes": -5},
    )

    assert response.status_code == 422


async def test_reviewing_requires_signing_in(client: AsyncClient, catalog: list[Game]) -> None:
    response = await client.post(REVIEWS, json={"game_id": str(catalog[0].id), "rating": 8})

    assert response.status_code == 401


# --- Reading ----------------------------------------------------------------


async def test_a_review_is_readable_signed_out(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0], review_text="Worth it.")

    response = await client.get(f"{REVIEWS}/{review['id']}")

    assert response.status_code == 200
    assert response.json()["review_text"] == "Worth it."


async def test_the_detail_carries_the_author_and_the_game(
    client: AsyncClient,
    headers: dict[str, str],
    catalog: list[Game],
    registered_user: dict[str, object],
) -> None:
    # SPEC §6.3 lists both on the detail screen, so neither should need a second call.
    review = await post_review(client, headers, catalog[0])

    body = (await client.get(f"{REVIEWS}/{review['id']}")).json()

    assert body["author"]["username"] == "ripley"
    assert body["game"]["title"] == catalog[0].title
    assert body["game"]["platforms"] is not None


async def test_the_author_shell_never_leaks_their_email(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0])

    body = (await client.get(f"{REVIEWS}/{review['id']}")).json()

    assert "email" not in body["author"]


async def test_an_unknown_review_is_a_404(client: AsyncClient) -> None:
    assert (await client.get(f"{REVIEWS}/{uuid.uuid4()}")).status_code == 404


# --- Privacy (SPEC §6.3 "reviews respect author privacy in all surfaces") ---


@pytest.fixture
async def private_review(
    client: AsyncClient,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> tuple[User, dict[str, object]]:
    author = await make_user("newt", is_private=True)
    review = await post_review(client, auth_headers(author), catalog[0])
    return author, review


async def test_a_private_authors_review_is_hidden_from_strangers(
    client: AsyncClient, private_review: tuple[User, dict[str, object]]
) -> None:
    _, review = private_review

    response = await client.get(f"{REVIEWS}/{review['id']}")

    assert response.status_code == 403


async def test_an_approved_follower_may_read_it(
    client: AsyncClient,
    db: AsyncSession,
    private_review: tuple[User, dict[str, object]],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    author, review = private_review
    follower = await make_user("bishop")
    db.add(Follow(follower_id=follower.id, followee_id=author.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.get(f"{REVIEWS}/{review['id']}", headers=auth_headers(follower))

    assert response.status_code == 200


async def test_a_pending_request_is_not_yet_access(
    client: AsyncClient,
    db: AsyncSession,
    private_review: tuple[User, dict[str, object]],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    author, review = private_review
    asker = await make_user("burke")
    db.add(Follow(follower_id=asker.id, followee_id=author.id, status=FollowStatus.PENDING))
    await db.flush()

    response = await client.get(f"{REVIEWS}/{review['id']}", headers=auth_headers(asker))

    assert response.status_code == 403


async def test_the_author_can_always_read_their_own(
    client: AsyncClient,
    private_review: tuple[User, dict[str, object]],
    auth_headers: AuthHeaders,
) -> None:
    author, review = private_review

    response = await client.get(f"{REVIEWS}/{review['id']}", headers=auth_headers(author))

    assert response.status_code == 200


# --- Editing ----------------------------------------------------------------


async def test_editing_the_rating(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0], rating=8)

    response = await client.patch(f"{REVIEWS}/{review['id']}", headers=headers, json={"rating": 4})

    assert response.status_code == 200
    assert response.json()["rating"] == 4
    assert response.json()["stars"] == 2.0


async def test_an_omitted_field_is_left_alone(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0], review_text="Kept.")

    body = (
        await client.patch(f"{REVIEWS}/{review['id']}", headers=headers, json={"rating": 10})
    ).json()

    assert body["review_text"] == "Kept."


async def test_an_explicit_null_clears_the_text(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    # The distinction the whole PATCH shape exists for: absent means "leave it",
    # null means "delete what is there".
    review = await post_review(client, headers, catalog[0], review_text="Second thoughts.")

    body = (
        await client.patch(f"{REVIEWS}/{review['id']}", headers=headers, json={"review_text": None})
    ).json()

    assert body["review_text"] is None


async def test_the_rating_cannot_be_cleared(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    # A review without a rating is not a review — SPEC §6.3 makes the text and the
    # playtime the optional parts, not the score.
    review = await post_review(client, headers, catalog[0])

    response = await client.patch(
        f"{REVIEWS}/{review['id']}", headers=headers, json={"rating": None}
    )

    assert response.status_code == 422


async def test_the_game_cannot_be_swapped(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    # Repointing an existing review would rewrite what anyone who already
    # responded to it was responding to.
    review = await post_review(client, headers, catalog[0])

    response = await client.patch(
        f"{REVIEWS}/{review['id']}", headers=headers, json={"game_id": str(catalog[1].id)}
    )

    assert response.status_code == 422


async def test_editing_moves_the_updated_timestamp(
    client: AsyncClient, db: AsyncSession, headers: dict[str, str], catalog: list[Game]
) -> None:
    """SPEC §6.3: "editing updates timestamps".

    The row is aged by an hour first because `updated_at` defaults to `now()`,
    which in Postgres is the *transaction* clock — and the whole test runs inside
    one transaction, so a create and an edit would otherwise be stamped
    identically no matter what the mapper does. Against a real server each
    request is its own transaction and the difference is real; here, backdating
    is what makes the onupdate observable at all.
    """
    review = await post_review(client, headers, catalog[0])
    review_id = uuid.UUID(str(review["id"]))
    stamp = sa.select(Review.updated_at).where(Review.id == review_id)

    await db.execute(
        sa.update(Review)
        .where(Review.id == review_id)
        .values(updated_at=sa.text("now() - interval '1 hour'"))
    )
    await db.flush()
    aged = await db.scalar(stamp)

    body = (
        await client.patch(f"{REVIEWS}/{review['id']}", headers=headers, json={"rating": 2})
    ).json()

    stored = await db.scalar(stamp)
    assert stored > aged
    # And the caller is told the new time, not the one the object was loaded with:
    # a stale timestamp in the response would show as an un-edited review until
    # the next reload.
    assert datetime.fromisoformat(str(body["updated_at"])) == stored
    assert body["created_at"] == review["created_at"]


async def test_an_empty_patch_changes_nothing(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0], review_text="Unchanged.")

    body = (await client.patch(f"{REVIEWS}/{review['id']}", headers=headers, json={})).json()

    assert body["rating"] == review["rating"]
    assert body["review_text"] == "Unchanged."


async def test_someone_elses_review_is_not_yours_to_edit(
    client: AsyncClient,
    headers: dict[str, str],
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    review = await post_review(client, headers, catalog[0])
    intruder = await make_user("vasquez")

    response = await client.patch(
        f"{REVIEWS}/{review['id']}", headers=auth_headers(intruder), json={"rating": 1}
    )

    assert response.status_code == 403


async def test_editing_requires_signing_in(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0])

    response = await client.patch(f"{REVIEWS}/{review['id']}", json={"rating": 1})

    assert response.status_code == 401


# --- Deleting ---------------------------------------------------------------


async def test_deleting_your_review(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0])

    response = await client.delete(f"{REVIEWS}/{review['id']}", headers=headers)

    assert response.status_code == 204
    assert (await client.get(f"{REVIEWS}/{review['id']}")).status_code == 404


async def test_deleting_frees_the_game_to_be_reviewed_again(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0])
    await client.delete(f"{REVIEWS}/{review['id']}", headers=headers)

    await post_review(client, headers, catalog[0], rating=2)


async def test_deleting_removes_the_stored_media(
    client: AsyncClient,
    headers: dict[str, str],
    catalog: list[Game],
    object_store: FakeObjectStore,
) -> None:
    # SPEC §6.3 attaches media to the review, so the bucket must not keep it after
    # the review is gone.
    review = await post_review(client, headers, catalog[0])
    await client.post(
        f"{REVIEWS}/{review['id']}/media",
        headers=headers,
        files={"file": ("shot.png", PNG_1PX, "image/png")},
    )
    assert object_store.keys

    await client.delete(f"{REVIEWS}/{review['id']}", headers=headers)

    assert object_store.objects == {}
    assert len(object_store.deleted) == 1


async def test_deleting_also_removes_the_generated_thumbnail(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    catalog: list[Game],
    object_store: FakeObjectStore,
) -> None:
    from app.services import media as media_service

    review = await post_review(client, headers, catalog[0])
    item = (
        await client.post(
            f"{REVIEWS}/{review['id']}/media",
            headers=headers,
            files={"file": ("shot.png", PNG_1PX, "image/png")},
        )
    ).json()
    await media_service.process_media(db, uuid.UUID(item["id"]))
    assert len(object_store.keys) == 2

    await client.delete(f"{REVIEWS}/{review['id']}", headers=headers)

    assert object_store.objects == {}


async def test_someone_elses_review_is_not_yours_to_delete(
    client: AsyncClient,
    headers: dict[str, str],
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    review = await post_review(client, headers, catalog[0])
    intruder = await make_user("gorman")

    response = await client.delete(f"{REVIEWS}/{review['id']}", headers=auth_headers(intruder))

    assert response.status_code == 403
    assert (await client.get(f"{REVIEWS}/{review['id']}")).status_code == 200


# --- The game's average (SPEC §5) -------------------------------------------
#
# Read back through the games endpoint rather than off the ORM object, so these
# prove the figure reached the database and not merely an attribute in session.

GAMES = "/api/v1/games"


async def game_scores(client: AsyncClient, game: Game) -> tuple[float | None, int]:
    body = (await client.get(f"{GAMES}/{game.id}")).json()
    return body["rating_average"], body["rating_count"]


async def test_a_review_moves_the_game_s_average(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    assert await game_scores(client, catalog[0]) == (None, 0)

    await post_review(client, headers, catalog[0], rating=8)

    assert await game_scores(client, catalog[0]) == (8.0, 1)


async def test_the_average_is_the_mean_of_every_review(
    client: AsyncClient,
    headers: dict[str, str],
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    await post_review(client, headers, catalog[0], rating=8)
    await post_review(client, auth_headers(await make_user("vasquez")), catalog[0], rating=6)

    assert await game_scores(client, catalog[0]) == (7.0, 2)


async def test_editing_a_rating_moves_the_average(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    review = await post_review(client, headers, catalog[0], rating=8)

    await client.patch(f"{REVIEWS}/{review['id']}", headers=headers, json={"rating": 4})

    assert await game_scores(client, catalog[0]) == (4.0, 1)


async def test_editing_only_the_text_leaves_the_average_alone(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """Guards the gate: a text-only PATCH should not touch the game at all."""
    review = await post_review(client, headers, catalog[0], rating=8)

    await client.patch(
        f"{REVIEWS}/{review['id']}", headers=headers, json={"review_text": "Second thoughts."}
    )

    assert await game_scores(client, catalog[0]) == (8.0, 1)


async def test_deleting_the_last_review_leaves_no_average_rather_than_zero(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """The regression this feature is most likely to grow: 0.0 would draw one star."""
    review = await post_review(client, headers, catalog[0], rating=8)

    await client.delete(f"{REVIEWS}/{review['id']}", headers=headers)

    assert await game_scores(client, catalog[0]) == (None, 0)


async def test_rating_one_game_leaves_the_others_alone(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await post_review(client, headers, catalog[0], rating=8)

    assert await game_scores(client, catalog[1]) == (None, 0)


async def test_the_count_is_recomputed_rather_than_incremented(
    client: AsyncClient,
    headers: dict[str, str],
    catalog: list[Game],
    make_user: MakeUser,
    make_review: Callable[..., Awaitable[Review]],
) -> None:
    """A review the service never saw still has to be counted.

    An increment would report 1 here — right only by luck, and permanently wrong
    the first time any other path writes a review.
    """
    await make_review(await make_user("hicks"), game=catalog[0], rating=6)

    await post_review(client, headers, catalog[0], rating=8)

    assert await game_scores(client, catalog[0]) == (7.0, 2)


async def test_the_new_review_s_own_response_already_carries_the_average(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """`expire_on_commit=False` would otherwise serialise the pre-review figures."""
    review = await post_review(client, headers, catalog[0], rating=8)

    game = review["game"]
    assert game["rating_average"] == 8.0  # type: ignore[index]
    assert game["rating_count"] == 1  # type: ignore[index]
