"""Likes — SPEC §6.10, §8.

The counting is not new: `reviews.interaction_stats` has been reading the likes
table since the reviews slice and reporting zero. So the tests that matter most
here check a *review* response after a like, not just the like endpoint's own
answer — if the two ever disagree, something grew a second way to count.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus, NotificationType
from app.models.review import Like, Review
from app.models.social import Follow
from app.models.user import User
from tests.conftest import EmittedNotification

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


def like_url(review: Review) -> str:
    return f"/api/v1/reviews/{review.id}/like"


def likers_url(review: Review) -> str:
    return f"/api/v1/reviews/{review.id}/likes"


MakeReview = Callable[..., Awaitable[Review]]


async def approve(db: AsyncSession, follower: User, followee: User) -> None:
    db.add(Follow(follower_id=follower.id, followee_id=followee.id, status=FollowStatus.ACCEPTED))
    await db.flush()


async def like_rows(db: AsyncSession, review: Review) -> int:
    return len(
        (await db.execute(sa.select(Like).where(Like.review_id == review.id))).scalars().all()
    )


# --- Liking -----------------------------------------------------------------


async def test_liking_a_review_counts_it(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)

    response = await client.post(like_url(review), headers=auth_headers(fan))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["like_count"] == 1
    assert body["viewer_has_liked"] is True
    assert body["review_id"] == str(review.id)


async def test_liking_twice_is_the_same_as_liking_once(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """A double-tap is not a mistake anyone can learn anything from."""
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)

    first = await client.post(like_url(review), headers=auth_headers(fan))
    second = await client.post(like_url(review), headers=auth_headers(fan))

    assert first.json() == second.json()
    assert await like_rows(db, review) == 1


async def test_unliking_takes_it_back(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)
    await client.post(like_url(review), headers=auth_headers(fan))

    response = await client.delete(like_url(review), headers=auth_headers(fan))

    assert response.json()["like_count"] == 0
    assert response.json()["viewer_has_liked"] is False
    assert await like_rows(db, review) == 0


async def test_unliking_something_you_never_liked_succeeds(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The caller wanted not to have liked it, and they do not."""
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)

    response = await client.delete(like_url(review), headers=auth_headers(fan))

    assert response.status_code == 200, response.text
    assert response.json()["like_count"] == 0


async def test_you_may_like_your_own_review(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.10 does not forbid it, and neither does any other social product."""
    author = await make_user("ripley")
    review = await make_review(author)

    response = await client.post(like_url(review), headers=auth_headers(author))

    assert response.json()["like_count"] == 1


async def test_viewer_has_liked_is_about_the_caller_not_the_review(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley")
    fan = await make_user("hicks")
    bystander = await make_user("bishop")
    review = await make_review(author)
    await client.post(like_url(review), headers=auth_headers(fan))

    seen = (
        await client.get(f"/api/v1/reviews/{review.id}", headers=auth_headers(bystander))
    ).json()

    assert seen["like_count"] == 1
    assert seen["viewer_has_liked"] is False


async def test_a_signed_out_caller_cannot_like(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview
) -> None:
    review = await make_review(await make_user("ripley"))

    assert (await client.post(like_url(review))).status_code == 401


async def test_liking_a_review_that_does_not_exist(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    fan = await make_user("hicks")

    response = await client.post(f"/api/v1/reviews/{uuid.uuid4()}/like", headers=auth_headers(fan))

    assert response.status_code == 404


# --- The counters everything else already renders ---------------------------


async def test_the_review_detail_reports_the_like(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The point of the slice: nothing about the read path changed, and the
    counter that has been reading zero since the reviews slice now moves."""
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)

    before = (await client.get(f"/api/v1/reviews/{review.id}")).json()["like_count"]
    await client.post(like_url(review), headers=auth_headers(fan))
    after = (await client.get(f"/api/v1/reviews/{review.id}", headers=auth_headers(fan))).json()

    assert before == 0
    assert after["like_count"] == 1
    assert after["viewer_has_liked"] is True


async def test_the_profile_grid_reports_it_too(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """Same counting function, reached through a different endpoint — which is
    what makes "do not add a parallel counting path" a tested fact."""
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)
    await client.post(like_url(review), headers=auth_headers(fan))

    page = (
        await client.get(f"/api/v1/users/{author.id}/reviews", headers=auth_headers(fan))
    ).json()

    assert page["items"][0]["id"] == str(review.id)
    assert page["items"][0]["like_count"] == 1
    assert page["items"][0]["viewer_has_liked"] is True


# --- Privacy (SPEC §6.7, §6.10) ---------------------------------------------


async def test_a_private_authors_review_cannot_be_liked_by_a_stranger(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The same gate that hides the review hides the verbs on it — nothing here
    re-implements the rule, it just asks `require_content_access` again."""
    author = await make_user("ripley", is_private=True)
    stranger = await make_user("hicks")
    review = await make_review(author)

    response = await client.post(like_url(review), headers=auth_headers(stranger))

    assert response.status_code == 403
    assert await like_rows(db, review) == 0


async def test_an_approved_follower_may_like_a_private_authors_review(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley", is_private=True)
    fan = await make_user("hicks")
    review = await make_review(author)
    await approve(db, fan, author)

    response = await client.post(like_url(review), headers=auth_headers(fan))

    assert response.status_code == 200, response.text
    assert response.json()["like_count"] == 1


async def test_a_pending_request_does_not_open_the_like_button(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley", is_private=True)
    fan = await make_user("hicks")
    review = await make_review(author)
    db.add(Follow(follower_id=fan.id, followee_id=author.id, status=FollowStatus.PENDING))
    await db.flush()

    assert (await client.post(like_url(review), headers=auth_headers(fan))).status_code == 403


async def test_unliking_is_gated_as_well(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """Otherwise a stranger could probe which reviews a private account has."""
    author = await make_user("ripley", is_private=True)
    stranger = await make_user("hicks")
    review = await make_review(author)

    assert (
        await client.delete(like_url(review), headers=auth_headers(stranger))
    ).status_code == 403


# --- Notifications (SPEC §6.12) ---------------------------------------------


async def test_liking_tells_the_author(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)

    await client.post(like_url(review), headers=auth_headers(fan))

    assert notifications_log == [
        EmittedNotification(
            recipient_id=author.id,
            actor_id=fan.id,
            type=NotificationType.REVIEW_LIKED,
            # The deep-link target: a like is only ever about a review, so it
            # carries one and no comment.
            review_id=review.id,
        )
    ]


async def test_liking_your_own_review_tells_nobody(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    author = await make_user("ripley")
    review = await make_review(author)

    await client.post(like_url(review), headers=auth_headers(author))

    assert notifications_log == []


async def test_liking_twice_tells_the_author_once(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    """The second call writes nothing, so it announces nothing."""
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)

    await client.post(like_url(review), headers=auth_headers(fan))
    await client.post(like_url(review), headers=auth_headers(fan))

    assert len(notifications_log) == 1


async def test_unliking_tells_nobody(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    """SPEC §6.12 has no notification for a like being taken back, and telling
    someone would be worse than not telling them."""
    author = await make_user("ripley")
    fan = await make_user("hicks")
    review = await make_review(author)
    await client.post(like_url(review), headers=auth_headers(fan))
    notifications_log.clear()

    await client.delete(like_url(review), headers=auth_headers(fan))

    assert notifications_log == []


# --- Who liked it -----------------------------------------------------------


async def test_the_likers_list_names_them(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley")
    fan = await make_user("hicks", display_name="Dwayne Hicks")
    review = await make_review(author)
    await client.post(like_url(review), headers=auth_headers(fan))

    page = (await client.get(likers_url(review))).json()

    assert [item["username"] for item in page["items"]] == ["hicks"]
    assert page["items"][0]["display_name"] == "Dwayne Hicks"


async def test_the_newest_liker_comes_first(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
) -> None:
    # Explicit timestamps: rows written in one transaction otherwise share now().
    review = await make_review(await make_user("ripley"))
    base = datetime.now(UTC)
    for index, handle in enumerate(("oldest", "newest")):
        liker = await make_user(handle)
        db.add(
            Like(user_id=liker.id, review_id=review.id, created_at=base + timedelta(minutes=index))
        )
    await db.flush()

    page = (await client.get(likers_url(review))).json()

    assert [item["username"] for item in page["items"]] == ["newest", "oldest"]


async def test_the_likers_list_pages_without_repeating_or_skipping(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
) -> None:
    review = await make_review(await make_user("ripley"))
    base = datetime.now(UTC)
    for index in range(5):
        liker = await make_user(f"fan{index}")
        db.add(
            Like(user_id=liker.id, review_id=review.id, created_at=base - timedelta(minutes=index))
        )
    await db.flush()

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        page = (await client.get(likers_url(review), params=params)).json()
        seen.extend(item["username"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert cursor is None, "pagination did not terminate"
    assert sorted(seen) == [f"fan{index}" for index in range(5)]
    assert len(seen) == len(set(seen))


async def test_the_likers_list_is_gated_by_the_authors_privacy(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley", is_private=True)
    stranger = await make_user("hicks")
    review = await make_review(author)

    assert (await client.get(likers_url(review), headers=auth_headers(stranger))).status_code == 403
    assert (await client.get(likers_url(review))).status_code == 403
