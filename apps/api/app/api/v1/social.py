"""Follow actions — SPEC §6.7, §8.

Every route here writes to the graph, so every one of them needs a signed-in
caller. The reads live elsewhere: follower and following lists hang off
`/users/{id}` (they are properties of a profile), and the viewer's own standing
with an account arrives on that profile as `viewer_follow_state`.

SPEC §8 puts these at two roots — `/follow/…` for edges the caller owns and
`/followers/…` for edges pointing at them — which is the distinction that matters
for authorisation, so the router carries no prefix and the paths say it. The
`/follow/requests…` routes are declared before `/follow/{user_id}` for the usual
reason: a literal segment must not be read as an id.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.api.deps import CurrentUser, DbSession
from app.schemas.pagination import CursorPage
from app.schemas.social import FollowRequest, FollowResult
from app.schemas.user import UserPublic
from app.services import social as social_service
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE

router = APIRouter(tags=["social"])

UserId = Annotated[uuid.UUID, Path(description="The other user's id")]
PageLimit = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Results per page")]
Cursor = Annotated[str | None, Query(description="From a previous page")]


# --- Requests you have received --------------------------------------------


@router.get(
    "/follow/requests",
    response_model=CursorPage[FollowRequest],
    summary="Follow requests awaiting your approval",
)
async def read_follow_requests(
    db: DbSession,
    current_user: CurrentUser,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[FollowRequest]:
    """SPEC §6.7, newest first.

    Only ever populated for a private account: a public one accepts follows
    outright, so it has nothing to approve. Requests the caller has *sent* are not
    here — those show as `REQUESTED` on the profile they were sent to.
    """
    page = await social_service.list_requests(db, current_user.id, cursor=cursor, limit=limit)
    return CursorPage(
        items=[
            FollowRequest(
                user=UserPublic.model_validate(entry.user), requested_at=entry.requested_at
            )
            for entry in page.items
        ],
        next_cursor=page.next_cursor,
    )


@router.post(
    "/follow/requests/{user_id}/accept",
    response_model=FollowResult,
    summary="Approve a follow request",
    responses={404: {"description": "No pending request from that user"}},
)
async def accept_follow_request(
    db: DbSession, current_user: CurrentUser, user_id: UserId
) -> FollowResult:
    """Establishes the follow (SPEC §6.7). From this point the requester can see
    everything the account gates — no other endpoint had to be told."""
    edge = await social_service.accept_request(db, current_user, user_id)
    return FollowResult.model_validate(edge)


@router.post(
    "/follow/requests/{user_id}/decline",
    response_model=FollowResult,
    summary="Reject a follow request",
    responses={404: {"description": "No pending request from that user"}},
)
async def decline_follow_request(
    db: DbSession, current_user: CurrentUser, user_id: UserId
) -> FollowResult:
    """Removes the request. The requester is not told, and may ask again."""
    edge = await social_service.decline_request(db, current_user, user_id)
    return FollowResult.model_validate(edge)


# --- Edges you own ----------------------------------------------------------


@router.post(
    "/follow/{user_id}",
    response_model=FollowResult,
    summary="Follow a user, or ask a private one",
    responses={400: {"description": "You cannot follow yourself"}, 404: {}},
)
async def follow_user(db: DbSession, current_user: CurrentUser, user_id: UserId) -> FollowResult:
    """SPEC §6.7. A public account is followed immediately and a private one gets
    a pending request; the response's `state` says which happened.

    200 rather than 201, and safe to repeat: asking again for something you
    already have reports what you have.
    """
    edge = await social_service.follow(db, current_user, user_id)
    return FollowResult.model_validate(edge)


@router.delete(
    "/follow/{user_id}",
    response_model=FollowResult,
    summary="Unfollow, or withdraw your request",
    responses={404: {"description": "No such user"}},
)
async def unfollow_user(db: DbSession, current_user: CurrentUser, user_id: UserId) -> FollowResult:
    """One verb for both, because it is one row (SPEC §6.7). Succeeds even when
    there was nothing to remove — the caller wanted to not be following."""
    edge = await social_service.unfollow(db, current_user, user_id)
    return FollowResult.model_validate(edge)


# --- Edges pointing at you --------------------------------------------------


@router.delete(
    "/followers/{user_id}",
    response_model=FollowResult,
    summary="Remove one of your followers",
    responses={404: {"description": "That user does not follow you"}},
)
async def remove_follower(
    db: DbSession, current_user: CurrentUser, user_id: UserId
) -> FollowResult:
    """SPEC §6.7. They keep seeing a public account — this only revokes the
    approval a private one granted, and stops the reviews reaching their feed."""
    edge = await social_service.remove_follower(db, current_user, user_id)
    return FollowResult.model_validate(edge)
