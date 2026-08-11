"""Likes and comments — SPEC §6.10, §8.

Two roots, so no prefix and the paths say which is which — the same shape as
`app.api.v1.social`. `/reviews/{id}/…` is where an interaction is *made*, because
it only means anything against a review; `/comments/{id}` is where one is changed,
because editing your own words does not depend on what they are attached to.

Their own router rather than more endpoints in `reviews.py`: what a review *is*
and what people do to it are separate concerns with separate authorisation rules
— a review is owner-only to change and open to read, a comment is owner-only to
change and gated by somebody else's privacy to make.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query, status

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.models.review import Comment
from app.schemas.interactions import (
    CommentCreate,
    CommentItem,
    CommentThread,
    CommentUpdate,
    ReviewInteractions,
)
from app.schemas.pagination import CursorPage
from app.schemas.user import UserPublic
from app.services import interactions as interactions_service
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.services.reviews import InteractionStats

router = APIRouter(tags=["interactions"])

ReviewId = Annotated[uuid.UUID, Path(description="Review id")]
CommentId = Annotated[uuid.UUID, Path(description="Comment id")]
PageLimit = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Results per page")]
Cursor = Annotated[str | None, Query(description="From a previous page")]


def _interactions_payload(review_id: uuid.UUID, stats: InteractionStats) -> ReviewInteractions:
    return ReviewInteractions(
        review_id=review_id,
        like_count=stats.like_count,
        comment_count=stats.comment_count,
        viewer_has_liked=stats.viewer_has_liked,
    )


def comment_payload(comment: Comment) -> CommentItem:
    return CommentItem.model_validate(comment)


# --- Likes ------------------------------------------------------------------


@router.post(
    "/reviews/{review_id}/like",
    response_model=ReviewInteractions,
    summary="Like a review",
    responses={
        403: {"description": "The author is private and you are not approved"},
        404: {},
    },
)
async def like_review(
    db: DbSession, current_user: CurrentUser, review_id: ReviewId
) -> ReviewInteractions:
    """SPEC §6.10. Safe to repeat: liking something you already liked reports the
    count you already have, and does not notify the author a second time.

    The response is the review's whole footer, so the button and the number it
    sits next to move together without re-reading the review.
    """
    stats = await interactions_service.like(db, current_user, review_id)
    return _interactions_payload(review_id, stats)


@router.delete(
    "/reviews/{review_id}/like",
    response_model=ReviewInteractions,
    summary="Take back a like",
    responses={
        403: {"description": "The author is private and you are not approved"},
        404: {},
    },
)
async def unlike_review(
    db: DbSession, current_user: CurrentUser, review_id: ReviewId
) -> ReviewInteractions:
    """Succeeds even when there was no like to remove."""
    stats = await interactions_service.unlike(db, current_user, review_id)
    return _interactions_payload(review_id, stats)


@router.get(
    "/reviews/{review_id}/likes",
    response_model=CursorPage[UserPublic],
    summary="Who liked this review",
    responses={
        403: {"description": "The author is private and you are not approved"},
        404: {},
    },
)
async def read_likers(
    db: DbSession,
    viewer: OptionalUser,
    review_id: ReviewId,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[UserPublic]:
    """Most recent first. Public shells only — liking is not an introduction, so
    it grants no more visibility of the liker than search already does."""
    page = await interactions_service.list_likers(
        db, review_id, viewer_id=viewer.id if viewer else None, cursor=cursor, limit=limit
    )
    return CursorPage(
        items=[UserPublic.model_validate(user) for user in page.items],
        next_cursor=page.next_cursor,
    )


# --- Comments ---------------------------------------------------------------


@router.post(
    "/reviews/{review_id}/comments",
    response_model=CommentItem,
    status_code=status.HTTP_201_CREATED,
    summary="Comment on a review, or reply to a comment",
    responses={
        400: {"description": "Replying to a reply — SPEC §6.10 allows one level"},
        403: {"description": "The author is private and you are not approved"},
        404: {"description": "No such review, or no such parent comment on it"},
    },
)
async def create_comment(
    db: DbSession, current_user: CurrentUser, review_id: ReviewId, payload: CommentCreate
) -> CommentItem:
    """SPEC §6.10. Omit `parent_comment_id` for a top-level comment; pass a
    top-level comment's id to reply to it."""
    comment = await interactions_service.create_comment(db, current_user, review_id, payload)
    return comment_payload(comment)


@router.get(
    "/reviews/{review_id}/comments",
    response_model=CursorPage[CommentThread],
    summary="The comment thread",
    responses={
        403: {"description": "The author is private and you are not approved"},
        404: {},
    },
)
async def read_comments(
    db: DbSession,
    viewer: OptionalUser,
    review_id: ReviewId,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[CommentThread]:
    """Oldest first, because it is a conversation.

    The page counts *top-level* comments: each one arrives with all of its
    replies, so `limit=20` is twenty threads rather than twenty rows, and a
    popular comment can never push its own replies onto the next page.
    """
    page = await interactions_service.list_comments(
        db, review_id, viewer_id=viewer.id if viewer else None, cursor=cursor, limit=limit
    )
    return CursorPage(
        items=[
            CommentThread(
                **comment_payload(thread.comment).model_dump(exclude={"edited"}),
                replies=[comment_payload(reply) for reply in thread.replies],
            )
            for thread in page.items
        ],
        next_cursor=page.next_cursor,
    )


@router.patch(
    "/comments/{comment_id}",
    response_model=CommentItem,
    summary="Edit your comment",
    responses={403: {"description": "Not your comment"}, 404: {}},
)
async def update_comment(
    db: DbSession, current_user: CurrentUser, comment_id: CommentId, payload: CommentUpdate
) -> CommentItem:
    """Moves `updated_at`, which is what `edited` on the response reads from."""
    comment = await interactions_service.update_comment(db, current_user, comment_id, payload)
    return comment_payload(comment)


@router.delete(
    "/comments/{comment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete your comment",
    responses={403: {"description": "Not your comment"}, 404: {}},
)
async def delete_comment(db: DbSession, current_user: CurrentUser, comment_id: CommentId) -> None:
    """Deleting a top-level comment takes its replies with it."""
    await interactions_service.delete_comment(db, current_user, comment_id)
