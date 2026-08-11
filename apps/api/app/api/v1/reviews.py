"""Review endpoints — SPEC §6.3, §8.

Reads are open to signed-out callers and gated on the author's privacy; writes
need the owner. Media upload sits under its review rather than standing alone, so
there is no window in which an uploaded file belongs to nobody and no way to
attach one to someone else's review.

Likes and comments are counted in the responses but have no verbs here — the
Interactions slice adds those.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, File, Form, Path, UploadFile, status

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.models.review import ReviewMedia
from app.schemas.game import GameSummary
from app.schemas.review import (
    ReviewCreate,
    ReviewDetail,
    ReviewMediaItem,
    ReviewSummary,
    ReviewUpdate,
)
from app.schemas.user import UserPublic
from app.services import media as media_service
from app.services import reviews as reviews_service
from app.services.exceptions import FileTooLargeError
from app.services.reviews import ReviewWithStats

router = APIRouter(prefix="/reviews", tags=["reviews"])

ReviewId = Annotated[uuid.UUID, Path(description="Review id")]

# The largest any review attachment may be. The per-kind caps in SPEC §6.3 are
# applied after sniffing; this one only exists to refuse an enormous body before
# it is read into memory.
_MAX_UPLOAD_BYTES = max(policy.max_bytes for policy in media_service.REVIEW_POLICIES)


def media_payload(item: ReviewMedia) -> ReviewMediaItem:
    return ReviewMediaItem.model_validate(item)


def summary_payload(entry: ReviewWithStats) -> ReviewSummary:
    """The grid/feed shape. Shared with the users router, which pages the same rows."""
    review = entry.review
    media = sorted(review.media, key=lambda item: item.position)
    # Tile on the first thumbnail there is, and on the game's cover art until one
    # exists — a review whose only media is a clip, or is still processing, still
    # has to render as something (SPEC §6.2).
    thumbnail = next((item.thumbnail_url for item in media if item.thumbnail_url), None)

    return ReviewSummary(
        id=review.id,
        author=UserPublic.model_validate(review.author),
        game=GameSummary.model_validate(review.game),
        rating=review.rating,
        review_text=review.review_text,
        playtime_minutes=review.playtime_minutes,
        created_at=review.created_at,
        updated_at=review.updated_at,
        like_count=entry.stats.like_count,
        comment_count=entry.stats.comment_count,
        viewer_has_liked=entry.stats.viewer_has_liked,
        media_count=len(media),
        thumbnail_url=thumbnail or review.game.cover_url,
    )


def detail_payload(entry: ReviewWithStats) -> ReviewDetail:
    """The summary plus the carousel itself.

    `stars` is excluded because it is computed on the way out, not an input —
    passing it back in would be silently ignored rather than checked.
    """
    return ReviewDetail(
        **summary_payload(entry).model_dump(exclude={"stars"}),
        media=[media_payload(item) for item in sorted(entry.review.media, key=_position)],
    )


def _position(item: ReviewMedia) -> int:
    return item.position


@router.post(
    "",
    response_model=ReviewDetail,
    status_code=status.HTTP_201_CREATED,
    summary="Review a game",
    responses={
        404: {"description": "No such game in the catalog"},
        409: {"description": "You have already reviewed this game"},
    },
)
async def create_review(
    db: DbSession, current_user: CurrentUser, payload: ReviewCreate
) -> ReviewDetail:
    """SPEC §6.3. Media is attached afterwards, one file at a time, so the review
    exists (and is recoverable) before any upload can fail."""
    return detail_payload(await reviews_service.create_review(db, current_user, payload))


@router.get(
    "/{review_id}",
    response_model=ReviewDetail,
    summary="Full review detail",
    responses={403: {"description": "The author is private and you are not approved"}, 404: {}},
)
async def read_review(db: DbSession, viewer: OptionalUser, review_id: ReviewId) -> ReviewDetail:
    """Readable signed-out, subject to the author's privacy (SPEC §6.3, §6.7).

    `viewer_has_liked` is false for an anonymous caller because there is nobody to
    have liked it, not because the like state is unknown.
    """
    entry = await reviews_service.get_review(db, review_id, viewer.id if viewer else None)
    return detail_payload(entry)


@router.patch(
    "/{review_id}",
    response_model=ReviewDetail,
    summary="Edit your review",
    responses={403: {"description": "Not your review"}, 404: {}},
)
async def update_review(
    db: DbSession, current_user: CurrentUser, review_id: ReviewId, payload: ReviewUpdate
) -> ReviewDetail:
    """Omitted fields are left alone; an explicit null clears the text or the
    playtime. Editing moves `updated_at` (SPEC §6.3)."""
    return detail_payload(await reviews_service.update_review(db, current_user, review_id, payload))


@router.delete(
    "/{review_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete your review",
    responses={403: {"description": "Not your review"}, 404: {}},
)
async def delete_review(db: DbSession, current_user: CurrentUser, review_id: ReviewId) -> None:
    """Takes the attached photos and clips out of the bucket with it."""
    await reviews_service.delete_review(db, current_user, review_id)


# --- Media (SPEC §6.3) ------------------------------------------------------


@router.post(
    "/{review_id}/media",
    response_model=ReviewMediaItem,
    status_code=status.HTTP_201_CREATED,
    summary="Attach a photo or clip",
    responses={
        400: {"description": "Clip longer than the limit, or unreadable"},
        403: {"description": "Not your review"},
        409: {"description": "Too many items, or a second video"},
        413: {"description": "File exceeds the size limit for its kind"},
        415: {"description": "Not a format we accept"},
    },
)
async def upload_media(
    db: DbSession,
    current_user: CurrentUser,
    background: BackgroundTasks,
    review_id: ReviewId,
    file: Annotated[UploadFile, File(description="JPEG, PNG, WebP, GIF, MP4 or MOV")],
    alt_text: Annotated[
        str | None, Form(description="Describes the image for screen readers (SPEC §9)")
    ] = None,
) -> ReviewMediaItem:
    """Store the file and queue it for processing (SPEC §6.3).

    Returns immediately with `processing_status: PENDING`; the thumbnail and
    dimensions appear once the worker has run, which a client sees by re-reading
    the review. The declared content type and filename are ignored — see
    `app.services.storage`.
    """
    # Starlette knows the size before anything is read, so a body far past every
    # policy is refused without materialising it.
    if file.size is not None and file.size > _MAX_UPLOAD_BYTES:
        raise FileTooLargeError(_MAX_UPLOAD_BYTES)

    item = await reviews_service.attach_media(
        db, current_user, review_id, await file.read(), alt_text=alt_text
    )
    # No queue yet (SPEC §6.11 wants a worker): the task runs after this response,
    # and `app.cli.process_media` sweeps up anything a restart interrupts.
    background.add_task(media_service.process_in_background, item.id)
    return media_payload(item)


@router.delete(
    "/{review_id}/media/{media_id}",
    response_model=list[ReviewMediaItem],
    summary="Remove a photo or clip",
    responses={403: {"description": "Not your review"}, 404: {}},
)
async def delete_media(
    db: DbSession,
    current_user: CurrentUser,
    review_id: ReviewId,
    media_id: Annotated[uuid.UUID, Path(description="Media item id")],
) -> list[ReviewMediaItem]:
    """Returns the remaining carousel, renumbered, so the client never has to
    guess what the order became."""
    remaining = await reviews_service.detach_media(db, current_user, review_id, media_id)
    return [media_payload(item) for item in remaining]
