"""Follow actions (SPEC §6.7, §8).

The graph is *read* in `app.services.users` — the privacy gate, the follower
lists, the counts — and *written* here. Keeping the two apart is what makes this
slice small: an edge written by `accept_request` immediately unlocks the
followee's reviews, stats and lists everywhere, because `content_is_visible_to`
was already looking for exactly that row. Nothing downstream had to be told.

Two rules from SPEC §6.7 shape all of it:

* **A public account is followed; a private one is asked.** Which of the two
  happens is decided by the target's `is_private` when the follow arrives — the
  follower does not get to choose.
* **Approval belongs to the followee.** Only they may accept, decline, or remove
  a follower. The follower may only create and withdraw their own edge, which is
  the same operation either way: `DELETE /follow/{id}` cancels a request that has
  not been answered and unfollows one that has.

Notifications are emitted through `app.services.notifications.emit`, before the
commit, so the row lands in the same transaction as the follow that caused it: a
follow that rolls back cannot leave a notification about it behind.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowState, FollowStatus, NotificationType
from app.models.social import Follow
from app.models.user import User
from app.services import notifications
from app.services import users as users_service
from app.services.exceptions import (
    FollowRequestNotFoundError,
    NotAFollowerError,
    SelfFollowError,
)
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    fetch_keyset_page,
)


@dataclass(frozen=True, slots=True)
class FollowEdge:
    """One directed edge as it stands after an action.

    Carries the followee's follower count because every caller is a button with a
    number next to it, and re-reading the profile to find out whether that number
    moved would be a round trip to learn something this call already knows.
    """

    follower_id: uuid.UUID
    followee_id: uuid.UUID
    state: FollowState
    follower_count: int


@dataclass(frozen=True, slots=True)
class Relationship:
    """How a viewer stands with an account, in both directions at once."""

    state: FollowState
    follows_viewer: bool


NO_RELATIONSHIP = Relationship(state=FollowState.NONE, follows_viewer=False)


@dataclass(frozen=True, slots=True)
class FollowRequest:
    """A pending inbound request, paired with when it was made."""

    user: User
    requested_at: datetime


# --- Reading the viewer's own edges -----------------------------------------


def _state(edge: Follow | None) -> FollowState:
    if edge is None:
        return FollowState.NONE
    if edge.status is FollowStatus.ACCEPTED:
        return FollowState.FOLLOWING
    return FollowState.REQUESTED


async def _get_edge(
    db: AsyncSession, follower_id: uuid.UUID, followee_id: uuid.UUID
) -> Follow | None:
    return await db.get(Follow, {"follower_id": follower_id, "followee_id": followee_id})


async def _edge_state(
    db: AsyncSession, follower_id: uuid.UUID, followee_id: uuid.UUID
) -> FollowEdge:
    """Read back what an action left behind, rather than assuming it.

    Every mutation ends here so the response describes the row that is actually
    committed — including the idempotent paths, where nothing was written at all
    and the honest answer is whatever was already there.
    """
    edge = await _get_edge(db, follower_id, followee_id)
    counts = await users_service.follow_counts(db, followee_id)
    return FollowEdge(
        follower_id=follower_id,
        followee_id=followee_id,
        state=_state(edge),
        follower_count=counts.followers,
    )


async def relationship(
    db: AsyncSession, viewer_id: uuid.UUID | None, user_id: uuid.UUID
) -> Relationship:
    """Both directions of the viewer's standing with `user_id`, in one query.

    A signed-out viewer, and a viewer looking at their own profile, relate to
    nobody: there is no Follow button to render in either case, and asking the
    database would only confirm that the `no_self_follow` constraint holds.
    """
    if viewer_id is None or viewer_id == user_id:
        return NO_RELATIONSHIP

    rows = await db.execute(
        sa.select(Follow.follower_id, Follow.status).where(
            sa.or_(
                sa.and_(Follow.follower_id == viewer_id, Follow.followee_id == user_id),
                sa.and_(Follow.follower_id == user_id, Follow.followee_id == viewer_id),
            )
        )
    )
    by_follower = {row[0]: row[1] for row in rows.all()}

    outbound = by_follower.get(viewer_id)
    state = (
        FollowState.NONE
        if outbound is None
        else FollowState.FOLLOWING
        if outbound is FollowStatus.ACCEPTED
        else FollowState.REQUESTED
    )
    return Relationship(
        state=state,
        # A pending request in the other direction is not a follower, so it does
        # not offer "Remove follower" either.
        follows_viewer=by_follower.get(user_id) is FollowStatus.ACCEPTED,
    )


# --- Following (SPEC §6.7) --------------------------------------------------


async def follow(db: AsyncSession, follower: User, followee_id: uuid.UUID) -> FollowEdge:
    """Follow a public account, or ask to follow a private one.

    Idempotent: following someone you already follow, or asking again while a
    request is outstanding, reports the state you are already in rather than
    failing. Clients retry, and double-tapping a button is not an error the user
    can learn anything from.
    """
    if follower.id == followee_id:
        raise SelfFollowError

    followee = await users_service.get_by_id(db, followee_id)
    edge = await _get_edge(db, follower.id, followee.id)

    if edge is None:
        pending = followee.is_private
        db.add(
            Follow(
                follower_id=follower.id,
                followee_id=followee.id,
                status=FollowStatus.PENDING if pending else FollowStatus.ACCEPTED,
                # Null for a public account: nobody responded, because there was
                # nothing to respond to. `responded_at is not None` therefore
                # means "went through approval", which is the useful reading.
                responded_at=None,
            )
        )
        await notifications.emit(
            db,
            recipient_id=followee.id,
            actor_id=follower.id,
            type=NotificationType.FOLLOW_REQUEST if pending else NotificationType.NEW_FOLLOWER,
        )
    elif edge.status is FollowStatus.PENDING and not followee.is_private:
        # The account went public while this request sat unanswered. SPEC §6.7
        # says the switch itself must not approve anything, and it did not — but
        # the request is now unanswerable, because a public account has no reason
        # to visit its requests screen. Asking again is what resolves it, and on
        # a public account asking again means following.
        edge.status = FollowStatus.ACCEPTED
        await notifications.emit(
            db,
            recipient_id=followee.id,
            actor_id=follower.id,
            type=NotificationType.NEW_FOLLOWER,
        )

    await db.commit()
    return await _edge_state(db, follower.id, followee.id)


async def unfollow(db: AsyncSession, follower: User, followee_id: uuid.UUID) -> FollowEdge:
    """Withdraw your own edge, whichever state it is in.

    One verb for two things that feel different — unfollowing an account you
    follow, and cancelling a request it has not answered — because they are the
    same row and the follower is entitled to remove it either way. Removing an
    edge that is not there is a success: the caller wanted to not be following,
    and they are not.
    """
    followee = await users_service.get_by_id(db, followee_id)

    edge = await _get_edge(db, follower.id, followee.id)
    if edge is not None:
        await db.delete(edge)
        await db.commit()

    return await _edge_state(db, follower.id, followee.id)


# --- Requests you have received (SPEC §6.7) ---------------------------------


async def _requested_at(
    db: AsyncSession, followee_id: uuid.UUID, follower_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, datetime]:
    """When each of `follower_ids` asked to follow `followee_id`.

    A second query for the column the page was just sorted on: `fetch_keyset_page`
    hands back entities, and the sort key it used to get there is not one of their
    attributes. Batched over the page the same way `search._visible_review_counts`
    is, rather than looked up per row.
    """
    if not follower_ids:
        return {}

    rows = await db.execute(
        sa.select(Follow.follower_id, Follow.created_at).where(
            Follow.followee_id == followee_id,
            Follow.follower_id.in_(follower_ids),
            Follow.status == FollowStatus.PENDING,
        )
    )
    return {row[0]: row[1] for row in rows.all()}


async def list_requests(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[FollowRequest]:
    """Pending requests this user has received, newest first.

    Inbound only. A request the *user* sent is visible as `REQUESTED` on the
    profile they sent it to, and is theirs to cancel, not to approve.
    """
    statement = (
        sa.select(User, Follow.created_at)
        .join(Follow, Follow.follower_id == User.id)
        .where(
            Follow.followee_id == user_id,
            Follow.status == FollowStatus.PENDING,
            User.is_active.is_(True),
        )
    )

    page = await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=Follow.created_at,
            id_column=User.id,
            bind_type=sa.DateTime(timezone=True),
            parse=datetime.fromisoformat,
            descending=True,
        ),
        cursor=cursor,
        limit=limit,
    )

    requested = await _requested_at(db, user_id, [user.id for user in page.items])
    return KeysetPage(
        items=[
            FollowRequest(user=user, requested_at=requested[user.id])
            for user in page.items
            # Guard against a request withdrawn between the two queries: the row
            # is gone, so there is nothing to show and nothing to answer.
            if user.id in requested
        ],
        next_cursor=page.next_cursor,
    )


async def _pending_request(db: AsyncSession, requester_id: uuid.UUID, user: User) -> Follow:
    edge = await _get_edge(db, requester_id, user.id)
    if edge is None or edge.status is not FollowStatus.PENDING:
        raise FollowRequestNotFoundError
    return edge


async def accept_request(db: AsyncSession, user: User, requester_id: uuid.UUID) -> FollowEdge:
    """Approve a pending request, which establishes the follow (SPEC §6.7)."""
    edge = await _pending_request(db, requester_id, user)

    edge.status = FollowStatus.ACCEPTED
    edge.responded_at = datetime.now(UTC)

    await notifications.emit(
        db,
        recipient_id=requester_id,
        actor_id=user.id,
        type=NotificationType.FOLLOW_REQUEST_APPROVED,
    )
    await db.commit()
    return await _edge_state(db, requester_id, user.id)


async def decline_request(db: AsyncSession, user: User, requester_id: uuid.UUID) -> FollowEdge:
    """Reject a pending request, removing it (SPEC §6.7).

    Silent by design: SPEC §6.12 lists a notification for a request *approved*
    and none for one declined, so the requester sees the button fall back to
    "Follow" and is free to ask again. Telling someone they were turned down is
    an unkindness the product does not need.
    """
    edge = await _pending_request(db, requester_id, user)

    await db.delete(edge)
    await db.commit()
    return await _edge_state(db, requester_id, user.id)


async def remove_follower(db: AsyncSession, user: User, follower_id: uuid.UUID) -> FollowEdge:
    """Drop one of your existing followers (SPEC §6.7).

    Only touches an accepted edge. A pending request looks similar from the
    outside but is answered with decline, and quietly removing one here would
    make two screens disagree about what happened to it.
    """
    edge = await _get_edge(db, follower_id, user.id)
    if edge is None or edge.status is not FollowStatus.ACCEPTED:
        raise NotAFollowerError

    await db.delete(edge)
    await db.commit()
    return await _edge_state(db, follower_id, user.id)
