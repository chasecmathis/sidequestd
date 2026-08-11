"""User and profile endpoints — SPEC §6.2, §6.8, §8.

Route order matters here. `/me` and its children are literal paths that would be
swallowed by `/{username}`, and `/{user_id}/…` shares a prefix with it, so the
specific routes are declared before the parameterised ones.

This module only *reads* the graph — the follower and following lists, and the
counts on a profile. The actions that write it (`POST /follow/{id}` and friends)
live at their own roots in `app.api.v1.social`.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, File, Path, Query, UploadFile, status

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.api.v1.backlog import lists_payload
from app.api.v1.reviews import summary_payload
from app.models.enums import BacklogStatus
from app.models.user import FavoriteGame, User
from app.schemas.backlog import BacklogLists
from app.schemas.game import GameSummary
from app.schemas.pagination import CursorPage
from app.schemas.review import ReviewSummary
from app.schemas.user import (
    FavoriteCreate,
    FavoriteGameEntry,
    FavoriteReorder,
    ProfileStats,
    RatingBucket,
    UserMe,
    Username,
    UsernameAvailability,
    UserProfile,
    UserPublic,
    UserUpdate,
    validate_username,
)
from app.services import auth as auth_service
from app.services import backlog as backlog_service
from app.services import reviews as reviews_service
from app.services import social as social_service
from app.services import users as users_service
from app.services.exceptions import FileTooLargeError
from app.services.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE
from app.services.storage import AVATAR_POLICY
from app.services.users import ProfileStatistics

router = APIRouter(prefix="/users", tags=["users"])

PageLimit = Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE, description="Results per page")]
Cursor = Annotated[str | None, Query(description="From a previous page")]
UserId = Annotated[uuid.UUID, Path(description="User id")]
Handle = Annotated[str, Path(description="Public handle, case-insensitive")]
BacklogFilter = Annotated[
    BacklogStatus | None, Query(description="Return only this list instead of all four")
]


def _favorites_payload(favorites: Sequence[FavoriteGame]) -> list[FavoriteGameEntry]:
    return [
        FavoriteGameEntry(
            position=favorite.position, game=GameSummary.model_validate(favorite.game)
        )
        for favorite in favorites
    ]


def _stats_payload(stats: ProfileStatistics, member_since: datetime) -> ProfileStats:
    return ProfileStats(
        games_reviewed=stats.games_reviewed,
        review_count=stats.review_count,
        average_rating=stats.average_rating,
        total_playtime_minutes=stats.total_playtime_minutes,
        completed_count=stats.completed_count,
        backlog_count=stats.backlog_count,
        rating_distribution=[
            RatingBucket(rating=rating, count=count)
            for rating, count in sorted(stats.rating_distribution.items())
        ],
        member_since=member_since,
    )


def _shells(users: Sequence[User]) -> list[UserPublic]:
    return [UserPublic.model_validate(user) for user in users]


# --- The signed-in user ----------------------------------------------------


@router.get("/me", response_model=UserMe, summary="The signed-in user's own record")
async def read_current_user(current_user: CurrentUser) -> UserMe:
    return UserMe.model_validate(current_user)


@router.patch("/me", response_model=UserMe, summary="Edit your own profile")
async def update_current_user(
    db: DbSession, current_user: CurrentUser, payload: UserUpdate
) -> UserMe:
    """SPEC §6.2. Omitted fields are left alone; an explicit null clears one.

    The handle and email are not editable here — both are identity, and changing
    them has consequences (dead profile links, a re-verification flow) that
    belong in settings rather than in a profile edit form.
    """
    return UserMe.model_validate(await users_service.update_profile(db, current_user, payload))


@router.put(
    "/me/avatar",
    response_model=UserMe,
    summary="Upload a profile picture",
    responses={
        413: {"description": "File exceeds the size limit"},
        415: {"description": "Not an image we accept"},
        503: {"description": "Object storage is unreachable"},
    },
)
async def upload_avatar(
    db: DbSession,
    current_user: CurrentUser,
    file: Annotated[UploadFile, File(description="JPEG, PNG or WebP")],
) -> UserMe:
    """Store the image and point the profile at it (SPEC §6.2).

    The declared content type and filename are both ignored — the stored type is
    sniffed from the bytes and the key is server-generated. See
    `app.services.storage`.
    """
    # Starlette reports the size before anything is read, so an oversized upload
    # is rejected without holding it all in memory first.
    if file.size is not None and file.size > AVATAR_POLICY.max_bytes:
        raise FileTooLargeError(AVATAR_POLICY.max_bytes)

    data = await file.read()
    return UserMe.model_validate(await users_service.set_avatar(db, current_user, data))


@router.delete("/me/avatar", response_model=UserMe, summary="Remove your profile picture")
async def delete_avatar(db: DbSession, current_user: CurrentUser) -> UserMe:
    return UserMe.model_validate(await users_service.clear_avatar(db, current_user))


# --- Favorite games (SPEC §6.2) --------------------------------------------


@router.get(
    "/me/favorites",
    response_model=list[FavoriteGameEntry],
    summary="Your curated games, in pinned order",
)
async def read_favorites(db: DbSession, current_user: CurrentUser) -> list[FavoriteGameEntry]:
    return _favorites_payload(await users_service.list_favorites(db, current_user.id))


@router.post(
    "/me/favorites",
    response_model=list[FavoriteGameEntry],
    status_code=status.HTTP_201_CREATED,
    summary="Pin a game to your profile",
    responses={
        404: {"description": "No such game in the catalog"},
        409: {"description": "Already pinned, or the list is full"},
    },
)
async def add_favorite(
    db: DbSession, current_user: CurrentUser, payload: FavoriteCreate
) -> list[FavoriteGameEntry]:
    """Appends to the end. Returns the whole list so a client never has to guess
    the resulting order."""
    favorites = await users_service.add_favorite(db, current_user, payload.game_id)
    return _favorites_payload(favorites)


@router.put(
    "/me/favorites",
    response_model=list[FavoriteGameEntry],
    summary="Reorder your pinned games",
    responses={400: {"description": "Not a permutation of the current list"}},
)
async def reorder_favorites(
    db: DbSession, current_user: CurrentUser, payload: FavoriteReorder
) -> list[FavoriteGameEntry]:
    favorites = await users_service.reorder_favorites(db, current_user, payload.game_ids)
    return _favorites_payload(favorites)


@router.delete(
    "/me/favorites/{game_id}",
    response_model=list[FavoriteGameEntry],
    summary="Unpin a game",
    responses={404: {"description": "Not one of your favorites"}},
)
async def remove_favorite(
    db: DbSession,
    current_user: CurrentUser,
    game_id: Annotated[uuid.UUID, Path(description="Catalog id of the pinned game")],
) -> list[FavoriteGameEntry]:
    favorites = await users_service.remove_favorite(db, current_user, game_id)
    return _favorites_payload(favorites)


# --- Backlog lists (SPEC §6.9) ---------------------------------------------


@router.get(
    "/me/lists",
    response_model=BacklogLists,
    summary="Your four backlog lists, each in your own order",
)
async def read_own_lists(
    db: DbSession, current_user: CurrentUser, status: BacklogFilter = None
) -> BacklogLists:
    """SPEC §6.9. All four lists unless `?status=` names one.

    Ungated, unlike the endpoint below: this is your own backlog, and going
    private does not hide it from you.
    """
    items = await backlog_service.list_items(db, current_user.id, status=status)
    return lists_payload(items, only=status)


# --- Signup helper ---------------------------------------------------------


@router.get(
    "/username-available",
    response_model=UsernameAvailability,
    summary="Check a handle before submitting the signup form",
)
async def check_username(
    db: DbSession,
    username: Username = Query(description="Handle to check"),
) -> UsernameAvailability:
    """Advisory only — registration re-checks under the unique constraint."""
    normalised = validate_username(username)
    available = await auth_service.is_username_available(db, normalised)
    return UsernameAvailability(username=normalised, available=available)


# --- Other people's profiles -----------------------------------------------


@router.get(
    "/{username}",
    response_model=UserProfile,
    summary="A public profile",
    responses={404: {"description": "No such user"}},
)
async def read_profile(db: DbSession, viewer: OptionalUser, username: Handle) -> UserProfile:
    """SPEC §6.2, readable signed-out.

    A private account still returns 200 with its shell and follower counts — that
    is what a stranger needs in order to send a follow request (SPEC §6.7). What
    changes is `can_view_content`: when it is false, `stats` is null and
    `favorite_games` is empty rather than the endpoint refusing.
    """
    user = await users_service.get_by_username(db, username)
    viewer_id = viewer.id if viewer else None
    counts = await users_service.follow_counts(db, user.id)
    visible = await users_service.viewer_may_see_content(db, user, viewer_id)
    # What the Follow button renders. It rides along with the profile rather than
    # being its own endpoint because the button is on this screen either way, and
    # a second request would let the two disagree for a frame.
    standing = await social_service.relationship(db, viewer_id, user.id)

    favorites = (
        _favorites_payload(await users_service.list_favorites(db, user.id)) if visible else []
    )
    stats = (
        _stats_payload(await users_service.get_stats(db, user.id), user.created_at)
        if visible
        else None
    )

    return UserProfile(
        **UserPublic.model_validate(user).model_dump(),
        follower_count=counts.followers,
        following_count=counts.following,
        is_viewer=viewer_id == user.id,
        can_view_content=visible,
        viewer_follow_state=standing.state,
        follows_viewer=standing.follows_viewer,
        favorite_games=favorites,
        stats=stats,
    )


@router.get(
    "/{user_id}/stats",
    response_model=ProfileStats,
    summary="Profile stats",
    responses={403: {"description": "Private account, viewer not approved"}, 404: {}},
)
async def read_stats(db: DbSession, viewer: OptionalUser, user_id: UserId) -> ProfileStats:
    """SPEC §6.8. Every figure is zero (and the average null) until the reviews
    and backlog slices give it something to count."""
    user = await users_service.get_by_id(db, user_id)
    await users_service.require_content_access(db, user, viewer.id if viewer else None)
    return _stats_payload(await users_service.get_stats(db, user.id), user.created_at)


@router.get(
    "/{user_id}/reviews",
    response_model=CursorPage[ReviewSummary],
    summary="This user's reviews, newest first",
    responses={403: {"description": "Private account, viewer not approved"}, 404: {}},
)
async def read_user_reviews(
    db: DbSession,
    viewer: OptionalUser,
    user_id: UserId,
    game: Annotated[
        uuid.UUID | None, Query(description="Narrow to this user's review of one game")
    ] = None,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[ReviewSummary]:
    """The profile grid from SPEC §6.2.

    `?game=` answers "have they reviewed this?" in one call, which is how a client
    that just hit the one-review-per-game conflict finds the review to edit.
    """
    user = await users_service.get_by_id(db, user_id)
    viewer_id = viewer.id if viewer else None
    await users_service.require_content_access(db, user, viewer_id)

    page = await reviews_service.list_by_author(
        db, user.id, viewer_id=viewer_id, game_id=game, cursor=cursor, limit=limit
    )
    return CursorPage(
        items=[summary_payload(entry) for entry in page.items],
        next_cursor=page.next_cursor,
    )


@router.get(
    "/{user_id}/backlog",
    response_model=BacklogLists,
    summary="This user's backlog lists",
    responses={403: {"description": "Private account, viewer not approved"}, 404: {}},
)
async def read_user_lists(
    db: DbSession, viewer: OptionalUser, user_id: UserId, status: BacklogFilter = None
) -> BacklogLists:
    """SPEC §6.9: lists inherit account privacy, with no per-list toggle at MVP.

    So this needs no rule of its own — `require_content_access` is the same gate
    the reviews grid and the stats go through, which is what stops a backlog from
    being the one surface where a private account leaks.
    """
    user = await users_service.get_by_id(db, user_id)
    await users_service.require_content_access(db, user, viewer.id if viewer else None)

    items = await backlog_service.list_items(db, user.id, status=status)
    return lists_payload(items, only=status)


@router.get(
    "/{user_id}/followers",
    response_model=CursorPage[UserPublic],
    summary="Who follows this user",
    responses={403: {"description": "Private account, viewer not approved"}, 404: {}},
)
async def read_followers(
    db: DbSession,
    viewer: OptionalUser,
    user_id: UserId,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[UserPublic]:
    """Gated, unlike the count on the profile: SPEC §6.7 names the follower and
    following *lists* as content a private account withholds."""
    user = await users_service.get_by_id(db, user_id)
    await users_service.require_content_access(db, user, viewer.id if viewer else None)

    page = await users_service.list_followers(db, user.id, cursor=cursor, limit=limit)
    return CursorPage(items=_shells(page.items), next_cursor=page.next_cursor)


@router.get(
    "/{user_id}/following",
    response_model=CursorPage[UserPublic],
    summary="Who this user follows",
    responses={403: {"description": "Private account, viewer not approved"}, 404: {}},
)
async def read_following(
    db: DbSession,
    viewer: OptionalUser,
    user_id: UserId,
    cursor: Cursor = None,
    limit: PageLimit = DEFAULT_PAGE_SIZE,
) -> CursorPage[UserPublic]:
    user = await users_service.get_by_id(db, user_id)
    await users_service.require_content_access(db, user, viewer.id if viewer else None)

    page = await users_service.list_following(db, user.id, cursor=cursor, limit=limit)
    return CursorPage(items=_shells(page.items), next_cursor=page.next_cursor)
