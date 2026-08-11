"""Comments and replies — SPEC §6.10, §8.

One level of threading is the rule the whole file circles: a reply attaches to a
top-level comment, a reply to a reply is refused, and deleting the top takes the
level below it. Everything else is ownership and the author-privacy gate the
reviews slice already built.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus, NotificationType
from app.models.review import Comment, Review
from app.models.social import Follow
from app.models.user import User
from tests.conftest import EmittedNotification

MakeUser = Callable[..., Awaitable[User]]
MakeReview = Callable[..., Awaitable[Review]]
AuthHeaders = Callable[[User], dict[str, str]]


def comments_url(review: Review) -> str:
    return f"/api/v1/reviews/{review.id}/comments"


def comment_url(comment_id: str) -> str:
    return f"/api/v1/comments/{comment_id}"


async def approve(db: AsyncSession, follower: User, followee: User) -> None:
    db.add(Follow(follower_id=follower.id, followee_id=followee.id, status=FollowStatus.ACCEPTED))
    await db.flush()


async def post_comment(
    client: AsyncClient,
    review: Review,
    author: User,
    auth_headers: AuthHeaders,
    text: str = "Astonishing.",
    parent_comment_id: str | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {"text": text}
    if parent_comment_id is not None:
        payload["parent_comment_id"] = parent_comment_id

    response = await client.post(comments_url(review), headers=auth_headers(author), json=payload)
    assert response.status_code == 201, response.text
    return dict(response.json())


async def comment_rows(db: AsyncSession, review: Review) -> int:
    return len(
        (await db.execute(sa.select(Comment).where(Comment.review_id == review.id))).scalars().all()
    )


# --- Commenting -------------------------------------------------------------


async def test_commenting_on_a_review(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")

    comment = await post_comment(client, review, hicks, auth_headers, text="Same.")

    assert comment["text"] == "Same."
    assert comment["review_id"] == str(review.id)
    assert comment["parent_comment_id"] is None
    assert comment["author"]["username"] == "hicks"  # type: ignore[index]
    assert comment["edited"] is False


async def test_a_comment_needs_some_text(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    """Whitespace is stripped before the length check, so "   " is empty."""
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")

    response = await client.post(
        comments_url(review), headers=auth_headers(hicks), json={"text": "   "}
    )

    assert response.status_code == 422


async def test_a_comment_is_capped_at_500_characters(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")

    response = await client.post(
        comments_url(review), headers=auth_headers(hicks), json={"text": "x" * 501}
    )

    assert response.status_code == 422


async def test_the_review_now_reports_the_comment(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    """`comment_count` has been reading zero since the reviews slice. Nothing
    about that read path changed here; it just has something to count."""
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")

    before = (await client.get(f"/api/v1/reviews/{review.id}")).json()["comment_count"]
    await post_comment(client, review, hicks, auth_headers)
    after = (await client.get(f"/api/v1/reviews/{review.id}")).json()["comment_count"]

    assert (before, after) == (0, 1)


async def test_replies_count_towards_the_total(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    """A reply is a comment. The footer says how much conversation there is, not
    how many threads it is divided into."""
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    parent = await post_comment(client, review, hicks, auth_headers)
    await post_comment(client, review, hicks, auth_headers, parent_comment_id=str(parent["id"]))

    assert (await client.get(f"/api/v1/reviews/{review.id}")).json()["comment_count"] == 2


async def test_a_signed_out_caller_cannot_comment(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview
) -> None:
    review = await make_review(await make_user("ripley"))

    assert (await client.post(comments_url(review), json={"text": "Hi"})).status_code == 401


async def test_commenting_on_a_review_that_does_not_exist(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    hicks = await make_user("hicks")

    response = await client.post(
        f"/api/v1/reviews/{uuid.uuid4()}/comments", headers=auth_headers(hicks), json={"text": "Hi"}
    )

    assert response.status_code == 404


# --- One level of threading (SPEC §6.10) ------------------------------------


async def test_replying_to_a_top_level_comment(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    bishop = await make_user("bishop")
    parent = await post_comment(client, review, hicks, auth_headers)

    reply = await post_comment(
        client, review, bishop, auth_headers, text="Agreed.", parent_comment_id=str(parent["id"])
    )

    assert reply["parent_comment_id"] == parent["id"]


async def test_replying_to_a_reply_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.10 stops at one level. Refused rather than silently re-parented to
    the top of the thread: moving a reply changes who it reads as answering."""
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    parent = await post_comment(client, review, hicks, auth_headers)
    reply = await post_comment(
        client, review, hicks, auth_headers, parent_comment_id=str(parent["id"])
    )

    response = await client.post(
        comments_url(review),
        headers=auth_headers(hicks),
        json={"text": "And another thing", "parent_comment_id": str(reply["id"])},
    )

    assert response.status_code == 400
    assert "top-level" in response.json()["detail"]
    assert await comment_rows(db, review) == 2


async def test_replying_to_a_comment_on_another_review_is_not_found(
    client: AsyncClient,
    catalog: list[object],
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """A 404 rather than a validation error: from here it is a comment that does
    not exist on *this* review, and saying more would leak the other one."""
    ripley = await make_user("ripley")
    hicks = await make_user("hicks")
    first = await make_review(ripley)
    second = await make_review(ripley, game=catalog[1])
    elsewhere = await post_comment(client, second, hicks, auth_headers)

    response = await client.post(
        comments_url(first),
        headers=auth_headers(hicks),
        json={"text": "Wrong thread", "parent_comment_id": str(elsewhere["id"])},
    )

    assert response.status_code == 404


# --- Reading the thread -----------------------------------------------------


async def test_the_thread_nests_replies_under_their_parent(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    bishop = await make_user("bishop")
    parent = await post_comment(client, review, hicks, auth_headers, text="Astonishing.")
    await post_comment(
        client, review, bishop, auth_headers, text="Agreed.", parent_comment_id=str(parent["id"])
    )

    page = (await client.get(comments_url(review))).json()

    assert len(page["items"]) == 1, "a reply is not a second thread"
    assert page["items"][0]["text"] == "Astonishing."
    assert [reply["text"] for reply in page["items"][0]["replies"]] == ["Agreed."]
    assert page["items"][0]["replies"][0]["author"]["username"] == "bishop"


async def test_the_thread_reads_oldest_first(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, make_review: MakeReview
) -> None:
    """Unlike every other list in the app. A comment section is a conversation,
    and a reply before the thing it answers only makes sense in hindsight."""
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    # Explicit timestamps: rows written in one transaction otherwise share now().
    base = datetime.now(UTC)
    for index, text in enumerate(("first", "second")):
        db.add(
            Comment(
                review_id=review.id,
                user_id=hicks.id,
                text=text,
                created_at=base + timedelta(minutes=index),
                updated_at=base + timedelta(minutes=index),
            )
        )
    await db.flush()

    page = (await client.get(comments_url(review))).json()

    assert [item["text"] for item in page["items"]] == ["first", "second"]


async def test_the_thread_pages_by_top_level_comment(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, make_review: MakeReview
) -> None:
    """A limit of two means two threads, replies included — so a popular comment
    can never push its own replies onto the next page."""
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    base = datetime.now(UTC)
    for index in range(5):
        db.add(
            Comment(
                review_id=review.id,
                user_id=hicks.id,
                text=f"comment {index}",
                created_at=base + timedelta(minutes=index),
                updated_at=base + timedelta(minutes=index),
            )
        )
    await db.flush()

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(5):
        params = {"limit": 2} | ({"cursor": cursor} if cursor else {})
        page = (await client.get(comments_url(review), params=params)).json()
        seen.extend(item["text"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert cursor is None, "pagination did not terminate"
    assert seen == [f"comment {index}" for index in range(5)]


async def test_the_thread_is_readable_signed_out(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    review = await make_review(await make_user("ripley"))
    await post_comment(client, review, await make_user("hicks"), auth_headers)

    response = await client.get(comments_url(review))

    assert response.status_code == 200
    assert len(response.json()["items"]) == 1


# --- Editing and deleting your own (SPEC §6.10) -----------------------------


async def test_editing_your_comment(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    comment = await post_comment(client, review, hicks, auth_headers, text="Astonishng.")

    response = await client.patch(
        comment_url(str(comment["id"])), headers=auth_headers(hicks), json={"text": "Astonishing."}
    )

    assert response.status_code == 200, response.text
    assert response.json()["text"] == "Astonishing."


async def test_editing_marks_the_comment_as_edited(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.10 asks for timestamps on an edit. `edited` is derived from them
    here rather than in four clients that would each round the comparison.

    Backdated first, for the reason spelled out in
    `test_reviews_crud.test_editing_moves_the_updated_timestamp`: `now()` is the
    transaction clock and this whole test is one transaction, so a post and an
    edit would otherwise be stamped identically however the mapper behaves.
    """
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    comment = await post_comment(client, review, hicks, auth_headers)

    await db.execute(
        sa.update(Comment)
        .where(Comment.id == uuid.UUID(str(comment["id"])))
        .values(
            created_at=sa.text("now() - interval '1 hour'"),
            updated_at=sa.text("now() - interval '1 hour'"),
        )
    )
    await db.flush()

    edited = (
        await client.patch(
            comment_url(str(comment["id"])), headers=auth_headers(hicks), json={"text": "Reworded."}
        )
    ).json()

    assert edited["edited"] is True
    assert edited["updated_at"] > edited["created_at"]


async def test_you_cannot_edit_someone_elses_comment(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    bishop = await make_user("bishop")
    comment = await post_comment(client, review, hicks, auth_headers)

    response = await client.patch(
        comment_url(str(comment["id"])), headers=auth_headers(bishop), json={"text": "Not mine."}
    )

    assert response.status_code == 403


async def test_the_review_author_cannot_edit_comments_on_their_review(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    """Moderating other people's words is a product decision SPEC §6.10 does not
    make; allowing it by accident here would be making it."""
    ripley = await make_user("ripley")
    review = await make_review(ripley)
    comment = await post_comment(client, review, await make_user("hicks"), auth_headers)

    response = await client.patch(
        comment_url(str(comment["id"])), headers=auth_headers(ripley), json={"text": "Rewritten."}
    )

    assert response.status_code == 403


async def test_deleting_your_comment(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    comment = await post_comment(client, review, hicks, auth_headers)

    response = await client.delete(comment_url(str(comment["id"])), headers=auth_headers(hicks))

    assert response.status_code == 204
    assert await comment_rows(db, review) == 0
    assert (await client.get(f"/api/v1/reviews/{review.id}")).json()["comment_count"] == 0


async def test_deleting_a_comment_takes_its_replies_with_it(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The alternative is replies to something nobody can read."""
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    bishop = await make_user("bishop")
    parent = await post_comment(client, review, hicks, auth_headers)
    await post_comment(client, review, bishop, auth_headers, parent_comment_id=str(parent["id"]))

    await client.delete(comment_url(str(parent["id"])), headers=auth_headers(hicks))

    assert await comment_rows(db, review) == 0


async def test_deleting_a_reply_leaves_its_parent_alone(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    parent = await post_comment(client, review, hicks, auth_headers, text="Astonishing.")
    reply = await post_comment(
        client, review, hicks, auth_headers, parent_comment_id=str(parent["id"])
    )

    await client.delete(comment_url(str(reply["id"])), headers=auth_headers(hicks))

    page = (await client.get(comments_url(review))).json()
    assert [item["text"] for item in page["items"]] == ["Astonishing."]
    assert page["items"][0]["replies"] == []


async def test_you_cannot_delete_someone_elses_comment(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    review = await make_review(await make_user("ripley"))
    comment = await post_comment(client, review, await make_user("hicks"), auth_headers)
    bishop = await make_user("bishop")

    response = await client.delete(comment_url(str(comment["id"])), headers=auth_headers(bishop))

    assert response.status_code == 403
    assert await comment_rows(db, review) == 1


async def test_editing_a_comment_that_does_not_exist(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    hicks = await make_user("hicks")

    response = await client.patch(
        comment_url(str(uuid.uuid4())), headers=auth_headers(hicks), json={"text": "Hello?"}
    )

    assert response.status_code == 404


async def test_you_may_still_delete_your_comment_after_losing_access(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """Words you cannot reach and cannot retract would be a worse outcome than
    letting a former follower delete their own comment."""
    author = await make_user("ripley", is_private=True)
    hicks = await make_user("hicks")
    await approve(db, hicks, author)
    review = await make_review(author)
    comment = await post_comment(client, review, hicks, auth_headers)

    await db.execute(
        sa.delete(Follow).where(Follow.follower_id == hicks.id, Follow.followee_id == author.id)
    )
    await db.flush()

    response = await client.delete(comment_url(str(comment["id"])), headers=auth_headers(hicks))

    assert response.status_code == 204


# --- Privacy (SPEC §6.7, §6.10) ---------------------------------------------


async def test_a_stranger_cannot_comment_on_a_private_authors_review(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    author = await make_user("ripley", is_private=True)
    stranger = await make_user("hicks")
    review = await make_review(author)

    response = await client.post(
        comments_url(review), headers=auth_headers(stranger), json={"text": "Let me in"}
    )

    assert response.status_code == 403
    assert await comment_rows(db, review) == 0


async def test_an_approved_follower_may_comment(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The gate reads the follow edge the social slice writes; nothing here knows
    what a follow is."""
    author = await make_user("ripley", is_private=True)
    fan = await make_user("hicks")
    review = await make_review(author)
    await approve(db, fan, author)

    await post_comment(client, review, fan, auth_headers)

    assert (await client.get(comments_url(review), headers=auth_headers(fan))).status_code == 200


async def test_reading_the_thread_is_gated_too(
    client: AsyncClient, make_user: MakeUser, make_review: MakeReview, auth_headers: AuthHeaders
) -> None:
    author = await make_user("ripley", is_private=True)
    stranger = await make_user("hicks")
    review = await make_review(author)

    assert (
        await client.get(comments_url(review), headers=auth_headers(stranger))
    ).status_code == 403
    assert (await client.get(comments_url(review))).status_code == 403


# --- Notifications (SPEC §6.12) ---------------------------------------------


async def test_commenting_tells_the_review_author(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    author = await make_user("ripley")
    hicks = await make_user("hicks")
    review = await make_review(author)

    comment = await post_comment(client, review, hicks, auth_headers)

    assert notifications_log == [
        EmittedNotification(
            recipient_id=author.id,
            actor_id=hicks.id,
            type=NotificationType.REVIEW_COMMENTED,
            # Both targets: the review is what the notification is *about*, the
            # comment is what the reader is taken to.
            review_id=review.id,
            comment_id=uuid.UUID(str(comment["id"])),
        )
    ]


async def test_commenting_on_your_own_review_tells_nobody(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    author = await make_user("ripley")
    review = await make_review(author)

    await post_comment(client, review, author, auth_headers)

    assert notifications_log == []


async def test_a_reply_tells_both_the_author_and_the_person_answered(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    author = await make_user("ripley")
    hicks = await make_user("hicks")
    bishop = await make_user("bishop")
    review = await make_review(author)
    parent = await post_comment(client, review, hicks, auth_headers)
    notifications_log.clear()

    reply = await post_comment(
        client, review, bishop, auth_headers, parent_comment_id=str(parent["id"])
    )

    # Both point at the reply rather than at the comment it answers: that is where
    # the new words are, and it is where a reader tapping either one wants to land.
    assert notifications_log == [
        EmittedNotification(
            recipient_id=author.id,
            actor_id=bishop.id,
            type=NotificationType.REVIEW_COMMENTED,
            review_id=review.id,
            comment_id=uuid.UUID(str(reply["id"])),
        ),
        EmittedNotification(
            recipient_id=hicks.id,
            actor_id=bishop.id,
            type=NotificationType.COMMENT_REPLIED,
            review_id=review.id,
            comment_id=uuid.UUID(str(reply["id"])),
        ),
    ]


async def test_replying_to_the_review_author_tells_them_once(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    """They are both the review's author and the person being answered. One
    event, not two — REVIEW_COMMENTED already says a reply landed."""
    author = await make_user("ripley")
    hicks = await make_user("hicks")
    review = await make_review(author)
    parent = await post_comment(client, review, author, auth_headers)
    notifications_log.clear()

    await post_comment(client, review, hicks, auth_headers, parent_comment_id=str(parent["id"]))

    assert [entry.type for entry in notifications_log] == [NotificationType.REVIEW_COMMENTED]


async def test_replying_to_yourself_tells_only_the_review_author(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    author = await make_user("ripley")
    hicks = await make_user("hicks")
    review = await make_review(author)
    parent = await post_comment(client, review, hicks, auth_headers)
    notifications_log.clear()

    await post_comment(client, review, hicks, auth_headers, parent_comment_id=str(parent["id"]))

    assert [entry.recipient_id for entry in notifications_log] == [author.id]


async def test_editing_and_deleting_tell_nobody(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    """SPEC §6.12 announces a comment, not every revision of one."""
    review = await make_review(await make_user("ripley"))
    hicks = await make_user("hicks")
    comment = await post_comment(client, review, hicks, auth_headers)
    notifications_log.clear()

    await client.patch(
        comment_url(str(comment["id"])), headers=auth_headers(hicks), json={"text": "Reworded."}
    )
    await client.delete(comment_url(str(comment["id"])), headers=auth_headers(hicks))

    assert notifications_log == []
