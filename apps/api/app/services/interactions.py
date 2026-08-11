"""Likes and comments (SPEC §6.10, §8).

The counting already existed. `app.services.reviews.interaction_stats` has been
reading the `likes` and `comments` tables since the reviews slice and reporting
zero because nothing wrote to them; this module writes to them, and every review
response starts moving on its own. Nothing here counts anything a second time —
`_stats` below goes through that same function, so a like recorded here and a
like rendered on a feed row can never be two different numbers.

Two rules shape the rest:

* **Interactions inherit the review author's privacy** (SPEC §6.7, §6.10). Every
  entry point resolves the review through `_accessible_review`, which is
  `users.require_content_access` again — so a private author's review cannot be
  liked, listed or commented on by someone they have not approved, for the same
  reason it cannot be read.
* **One level of threading** (SPEC §6.10). A reply's parent must be a top-level
  comment on the same review; replying to a reply is refused rather than quietly
  re-parented, because moving a reply changes who it reads as answering.

Notifications go through `app.services.notifications.emit`, before the commit, so
they land in the transaction that caused them. Nobody is ever told about their
own action — `emit` is called only after the recipient has been compared against
the actor.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.enums import NotificationType
from app.models.review import Comment, Like, Review
from app.models.user import User
from app.schemas.interactions import CommentCreate, CommentUpdate
from app.services import notifications
from app.services import reviews as reviews_service
from app.services import users as users_service
from app.services.exceptions import (
    CommentDepthError,
    CommentNotFoundError,
    NotCommentOwnerError,
    ReviewNotFoundError,
)
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    fetch_keyset_page,
)
from app.services.reviews import InteractionStats


@dataclass(frozen=True, slots=True)
class CommentThread:
    """A top-level comment with everything hanging off it.

    Whole rather than paged: one level of threading bounds the subtree, and a
    reply the client has to fetch separately is a reply that renders late.
    """

    comment: Comment
    replies: Sequence[Comment]


# --- Reaching a review ------------------------------------------------------


async def _accessible_review(
    db: AsyncSession, review_id: uuid.UUID, viewer_id: uuid.UUID | None
) -> Review:
    """The review, if this viewer is allowed to interact with it at all.

    Gating on the *author* rather than the review is what makes a private
    account's whole output disappear at once. The author is joined in because
    every caller then needs it — to check the privacy, and to know who to notify.
    """
    review = await db.scalar(
        sa.select(Review).where(Review.id == review_id).options(selectinload(Review.author))
    )
    if review is None:
        raise ReviewNotFoundError

    await users_service.require_content_access(db, review.author, viewer_id)
    return review


async def _stats(
    db: AsyncSession, review_id: uuid.UUID, viewer_id: uuid.UUID | None
) -> InteractionStats:
    """The counters as every other endpoint computes them, for one review."""
    stats = await reviews_service.interaction_stats(db, [review_id], viewer_id)
    return stats.get(review_id, reviews_service.NO_INTERACTIONS)


# --- Likes (SPEC §6.10) -----------------------------------------------------


async def like(db: AsyncSession, user: User, review_id: uuid.UUID) -> InteractionStats:
    """Like a review, or confirm that you already had.

    Idempotent for the same reason following is: a double-tap is not a mistake
    the user can learn anything from, and a retried request should not turn a
    successful like into a 409. The insert is skipped when the row is there, so
    the author is not notified twice for one like.
    """
    review = await _accessible_review(db, review_id, user.id)

    existing = await db.get(Like, {"user_id": user.id, "review_id": review.id})
    if existing is None:
        db.add(Like(user_id=user.id, review_id=review.id))
        if review.user_id != user.id:
            await notifications.emit(
                db,
                recipient_id=review.user_id,
                actor_id=user.id,
                type=NotificationType.REVIEW_LIKED,
                review_id=review.id,
            )
        await db.commit()

    return await _stats(db, review.id, user.id)


async def unlike(db: AsyncSession, user: User, review_id: uuid.UUID) -> InteractionStats:
    """Take a like back. Unliking something you never liked is a success: the
    caller wanted not to have liked it, and they do not."""
    review = await _accessible_review(db, review_id, user.id)

    existing = await db.get(Like, {"user_id": user.id, "review_id": review.id})
    if existing is not None:
        await db.delete(existing)
        await db.commit()

    return await _stats(db, review.id, user.id)


async def list_likers(
    db: AsyncSession,
    review_id: uuid.UUID,
    *,
    viewer_id: uuid.UUID | None,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[User]:
    """Who liked it, most recent first (SPEC §6.10).

    Deactivated accounts are left out, the same way they are left out of the
    follower lists — the like still counts, but there is no profile to open.
    """
    review = await _accessible_review(db, review_id, viewer_id)

    statement = (
        sa.select(User, Like.created_at)
        .join(Like, Like.user_id == User.id)
        .where(Like.review_id == review.id, User.is_active.is_(True))
    )
    return await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=Like.created_at,
            id_column=User.id,
            bind_type=sa.DateTime(timezone=True),
            parse=datetime.fromisoformat,
            descending=True,
        ),
        cursor=cursor,
        limit=limit,
    )


# --- Comments (SPEC §6.10) --------------------------------------------------


async def _load_comment(db: AsyncSession, comment_id: uuid.UUID) -> Comment:
    comment = await db.scalar(
        sa.select(Comment).where(Comment.id == comment_id).options(selectinload(Comment.author))
    )
    if comment is None:
        raise CommentNotFoundError
    return comment


async def _parent_for(db: AsyncSession, review: Review, parent_id: uuid.UUID) -> Comment:
    """Resolve the comment a reply is aimed at, and refuse a second level.

    A parent on another review is a 404 rather than a validation error: from the
    client's side it is a comment that does not exist *here*, and saying more
    would confirm the contents of a review the caller may not be able to read.
    """
    parent = await db.get(Comment, parent_id)
    if parent is None or parent.review_id != review.id:
        raise CommentNotFoundError
    if parent.parent_comment_id is not None:
        raise CommentDepthError
    return parent


async def create_comment(
    db: AsyncSession, user: User, review_id: uuid.UUID, data: CommentCreate
) -> Comment:
    """Comment on a review, or reply to a comment on one (SPEC §6.10)."""
    review = await _accessible_review(db, review_id, user.id)
    parent = (
        None
        if data.parent_comment_id is None
        else await _parent_for(db, review, data.parent_comment_id)
    )

    comment = Comment(
        review_id=review.id,
        user_id=user.id,
        parent_comment_id=parent.id if parent else None,
        text=data.text,
    )
    db.add(comment)
    # Flushed before the notifications so `comment.id` exists to point them at:
    # the id is a client-side column default, which is applied on flush, and a
    # notification that cannot name the comment it is about is one the reader
    # cannot follow back to the conversation.
    await db.flush()

    # The review's author hears about anything said on their review, including
    # replies to other people — it is their review the conversation is under.
    if review.user_id != user.id:
        await notifications.emit(
            db,
            recipient_id=review.user_id,
            actor_id=user.id,
            type=NotificationType.REVIEW_COMMENTED,
            review_id=review.id,
            comment_id=comment.id,
        )
    # And the person being answered hears about it too, unless they are one of
    # the two people who already know: the author, who was just told, or the
    # replier themselves.
    if parent is not None and parent.user_id not in {user.id, review.user_id}:
        await notifications.emit(
            db,
            recipient_id=parent.user_id,
            actor_id=user.id,
            type=NotificationType.COMMENT_REPLIED,
            review_id=review.id,
            comment_id=comment.id,
        )

    await db.commit()
    return await _load_comment(db, comment.id)


async def _replies_for(
    db: AsyncSession, parent_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, list[Comment]]:
    """Every reply to a page of top-level comments, in one query.

    Batched over the page rather than fetched per row, the same way
    `reviews.interaction_stats` is — a page of twenty comments should cost two
    queries, not twenty-one.
    """
    if not parent_ids:
        return {}

    rows = await db.execute(
        sa.select(Comment)
        .where(Comment.parent_comment_id.in_(parent_ids))
        .options(selectinload(Comment.author))
        .order_by(Comment.created_at, Comment.id)
    )

    grouped: dict[uuid.UUID, list[Comment]] = {parent_id: [] for parent_id in parent_ids}
    for reply in rows.scalars().all():
        # The WHERE clause already guarantees a parent; the column is nullable in
        # general, so the id is read into a local to narrow it.
        parent_id = reply.parent_comment_id
        if parent_id is not None:
            grouped[parent_id].append(reply)
    return grouped


async def list_comments(
    db: AsyncSession,
    review_id: uuid.UUID,
    *,
    viewer_id: uuid.UUID | None,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[CommentThread]:
    """Top-level comments with their replies, oldest first.

    Ascending, unlike every other list in the app: a comment section is a
    conversation, and reading a reply before the thing it replies to is only
    coherent if you already know how it ended. `ix_comments_review_id_created_at`
    is in that order, so the keyset walks the index forwards.
    """
    review = await _accessible_review(db, review_id, viewer_id)

    statement = (
        sa.select(Comment, Comment.created_at)
        .where(Comment.review_id == review.id, Comment.parent_comment_id.is_(None))
        .options(selectinload(Comment.author))
    )
    page = await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=Comment.created_at,
            id_column=Comment.id,
            bind_type=sa.DateTime(timezone=True),
            parse=datetime.fromisoformat,
            descending=False,
        ),
        cursor=cursor,
        limit=limit,
    )

    replies = await _replies_for(db, [comment.id for comment in page.items])
    return KeysetPage(
        items=[
            CommentThread(comment=comment, replies=replies.get(comment.id, []))
            for comment in page.items
        ],
        next_cursor=page.next_cursor,
    )


async def _owned_comment(db: AsyncSession, user: User, comment_id: uuid.UUID) -> Comment:
    """Load a comment the caller is allowed to change.

    No privacy check: this is the caller's own text. Someone who commented and
    was then removed as a follower can still delete what they said, which is the
    only reading of "delete by owner" that does not trap words on a screen the
    person who wrote them can no longer reach.
    """
    comment = await _load_comment(db, comment_id)
    if comment.user_id != user.id:
        raise NotCommentOwnerError
    return comment


async def update_comment(
    db: AsyncSession, user: User, comment_id: uuid.UUID, data: CommentUpdate
) -> Comment:
    """Owner-only edit. `updated_at` moves, which is what `edited` is read from."""
    comment = await _owned_comment(db, user, comment_id)

    comment.text = data.text
    await db.commit()
    return await _load_comment(db, comment.id)


async def delete_comment(db: AsyncSession, user: User, comment_id: uuid.UUID) -> None:
    """Owner-only delete.

    A top-level comment takes its replies with it (`cascade="all, delete-orphan"`
    on `Comment.replies`). The alternative — orphaned replies to something nobody
    can read — is worse than losing them, and one level of threading means the
    author of a top-level comment can see everything they are removing.
    """
    comment = await _owned_comment(db, user, comment_id)

    await db.delete(comment)
    await db.commit()
