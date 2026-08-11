"""Follow and unfollow — SPEC §6.7, §8.

The point of this slice is that writing an edge is enough: nothing downstream was
taught about follows, so the tests at the bottom check the *reads* from earlier
slices through the actions here. If `content_is_visible_to` and these functions
ever disagree about what an approved follow is, that is where it shows.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import FollowStatus, NotificationType
from app.models.game import Game
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User
from tests.conftest import EmittedNotification

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


def follow_url(user: User) -> str:
    return f"/api/v1/follow/{user.id}"


def follower_url(user: User) -> str:
    return f"/api/v1/followers/{user.id}"


def profile_url(user: User) -> str:
    return f"/api/v1/users/{user.username}"


async def edge_for(db: AsyncSession, follower: User, followee: User) -> Follow | None:
    return await db.scalar(
        sa.select(Follow).where(
            Follow.follower_id == follower.id, Follow.followee_id == followee.id
        )
    )


# --- Following a public account --------------------------------------------


async def test_following_a_public_account_takes_effect_immediately(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """SPEC §6.7: public accounts do not approve, they are simply followed."""
    fan = await make_user("hicks")
    idol = await make_user("ripley")

    response = await client.post(follow_url(idol), headers=auth_headers(fan))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["state"] == "FOLLOWING"
    assert body["follower_id"] == str(fan.id)
    assert body["followee_id"] == str(idol.id)


async def test_the_response_carries_the_count_the_button_sits_next_to(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Otherwise the profile would have to be re-read to learn what this call
    already changed."""
    fan = await make_user("hicks")
    idol = await make_user("ripley")

    followed = (await client.post(follow_url(idol), headers=auth_headers(fan))).json()
    unfollowed = (await client.delete(follow_url(idol), headers=auth_headers(fan))).json()

    assert followed["follower_count"] == 1
    assert unfollowed["follower_count"] == 0


async def test_an_instant_follow_records_no_response_time(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """`responded_at` means "someone answered a request". Nobody did — the
    account was public — so it stays null and keeps saying something true."""
    fan = await make_user("hicks")
    idol = await make_user("ripley")

    await client.post(follow_url(idol), headers=auth_headers(fan))

    edge = await edge_for(db, fan, idol)
    assert edge is not None
    assert edge.status is FollowStatus.ACCEPTED
    assert edge.responded_at is None


async def test_re_following_reports_the_state_rather_than_failing(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Idempotent: a retry, or a double-tapped button, is not a mistake the user
    can learn anything from."""
    fan = await make_user("hicks")
    idol = await make_user("ripley")

    first = await client.post(follow_url(idol), headers=auth_headers(fan))
    second = await client.post(follow_url(idol), headers=auth_headers(fan))

    assert first.json() == second.json()
    assert second.json()["follower_count"] == 1
    edges = (
        await db.execute(
            sa.select(sa.func.count()).select_from(Follow).where(Follow.follower_id == fan.id)
        )
    ).scalar_one()
    assert edges == 1


async def test_following_yourself_is_refused_before_the_constraint_sees_it(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """`no_self_follow` would catch it as a 500 several layers away."""
    ripley = await make_user("ripley")

    response = await client.post(follow_url(ripley), headers=auth_headers(ripley))

    assert response.status_code == 400
    assert "yourself" in response.json()["detail"]


async def test_following_a_stranger_who_does_not_exist_is_a_404(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    fan = await make_user("hicks")

    response = await client.post(f"/api/v1/follow/{uuid.uuid4()}", headers=auth_headers(fan))

    assert response.status_code == 404


async def test_following_needs_a_signed_in_caller(client: AsyncClient, make_user: MakeUser) -> None:
    idol = await make_user("ripley")

    assert (await client.post(follow_url(idol))).status_code == 401


# --- Following a private account -------------------------------------------


async def test_following_a_private_account_asks_instead(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """SPEC §6.7: a private target turns a follow into a request."""
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)

    response = await client.post(follow_url(newt), headers=auth_headers(hopeful))

    assert response.json()["state"] == "REQUESTED"
    assert response.json()["follower_count"] == 0, "a request is not yet a follower"
    edge = await edge_for(db, hopeful, newt)
    assert edge is not None and edge.status is FollowStatus.PENDING


async def test_asking_twice_leaves_one_request(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)

    await client.post(follow_url(newt), headers=auth_headers(hopeful))
    second = await client.post(follow_url(newt), headers=auth_headers(hopeful))

    assert second.status_code == 200
    assert second.json()["state"] == "REQUESTED"


async def test_a_pending_request_does_not_unlock_anything(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """The gate reads ACCEPTED, and asking is not being approved."""
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)

    await client.post(follow_url(newt), headers=auth_headers(hopeful))

    stats = await client.get(f"/api/v1/users/{newt.id}/stats", headers=auth_headers(hopeful))
    assert stats.status_code == 403


# --- Unfollowing ------------------------------------------------------------


async def test_unfollowing_removes_the_edge(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    fan = await make_user("hicks")
    idol = await make_user("ripley")
    await client.post(follow_url(idol), headers=auth_headers(fan))

    response = await client.delete(follow_url(idol), headers=auth_headers(fan))

    assert response.json()["state"] == "NONE"
    assert await edge_for(db, fan, idol) is None


async def test_unfollowing_also_cancels_a_request_you_sent(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """One row, so one verb (SPEC §6.7). A requester is entitled to withdraw."""
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)
    await client.post(follow_url(newt), headers=auth_headers(hopeful))

    response = await client.delete(follow_url(newt), headers=auth_headers(hopeful))

    assert response.json()["state"] == "NONE"
    assert await edge_for(db, hopeful, newt) is None


async def test_unfollowing_someone_you_never_followed_succeeds(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """The caller wanted to not be following them, and they are not."""
    stranger = await make_user("hicks")
    idol = await make_user("ripley")

    response = await client.delete(follow_url(idol), headers=auth_headers(stranger))

    assert response.status_code == 200
    assert response.json()["state"] == "NONE"


async def test_unfollowing_does_not_touch_the_other_direction(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Follows are directed, and mutual follows are two independent rows."""
    ripley = await make_user("ripley")
    hicks = await make_user("hicks")
    await client.post(follow_url(hicks), headers=auth_headers(ripley))
    await client.post(follow_url(ripley), headers=auth_headers(hicks))

    await client.delete(follow_url(hicks), headers=auth_headers(ripley))

    assert await edge_for(db, ripley, hicks) is None
    assert await edge_for(db, hicks, ripley) is not None


# --- Removing a follower ----------------------------------------------------


async def test_removing_a_follower_drops_their_edge(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    follower = await make_user("hicks")
    db.add(Follow(follower_id=follower.id, followee_id=newt.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.delete(follower_url(follower), headers=auth_headers(newt))

    assert response.status_code == 200, response.text
    assert response.json()["state"] == "NONE"
    assert response.json()["follower_count"] == 0
    assert await edge_for(db, follower, newt) is None


async def test_a_removed_follower_loses_access_again(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    follower = await make_user("hicks")
    db.add(Follow(follower_id=follower.id, followee_id=newt.id, status=FollowStatus.ACCEPTED))
    await db.flush()
    assert (
        await client.get(f"/api/v1/users/{newt.id}/stats", headers=auth_headers(follower))
    ).status_code == 200

    await client.delete(follower_url(follower), headers=auth_headers(newt))

    after = await client.get(f"/api/v1/users/{newt.id}/stats", headers=auth_headers(follower))
    assert after.status_code == 403


async def test_removing_someone_who_is_not_a_follower_is_a_404(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    ripley = await make_user("ripley")
    stranger = await make_user("hicks")

    response = await client.delete(follower_url(stranger), headers=auth_headers(ripley))

    assert response.status_code == 404


async def test_removing_a_follower_leaves_a_pending_request_alone(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """A request is answered by declining it. Silently removing it here would put
    two screens at odds about what became of it."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await client.post(follow_url(newt), headers=auth_headers(hopeful))

    response = await client.delete(follower_url(hopeful), headers=auth_headers(newt))

    assert response.status_code == 404
    assert await edge_for(db, hopeful, newt) is not None


async def test_you_cannot_remove_a_follower_of_someone_else(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """The path names the follower, and the followee is always the caller — there
    is no way to spell "remove X from Y's followers"."""
    ripley = await make_user("ripley")
    follower = await make_user("hicks")
    meddler = await make_user("burke")
    db.add(Follow(follower_id=follower.id, followee_id=ripley.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.delete(follower_url(follower), headers=auth_headers(meddler))

    assert response.status_code == 404
    assert await edge_for(db, follower, ripley) is not None


# --- What the profile tells the button --------------------------------------


async def test_the_profile_reports_the_viewers_own_standing(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    fan = await make_user("hicks")
    idol = await make_user("ripley")

    before = await client.get(profile_url(idol), headers=auth_headers(fan))
    await client.post(follow_url(idol), headers=auth_headers(fan))
    after = await client.get(profile_url(idol), headers=auth_headers(fan))

    assert before.json()["viewer_follow_state"] == "NONE"
    assert after.json()["viewer_follow_state"] == "FOLLOWING"


async def test_the_profile_reports_a_request_as_requested(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)
    await client.post(follow_url(newt), headers=auth_headers(hopeful))

    body = (await client.get(profile_url(newt), headers=auth_headers(hopeful))).json()

    assert body["viewer_follow_state"] == "REQUESTED"
    assert body["can_view_content"] is False


async def test_a_signed_out_viewer_has_no_standing(
    client: AsyncClient, make_user: MakeUser
) -> None:
    """There is no button to draw for them, so NONE is the answer rather than an
    unknown."""
    idol = await make_user("ripley")

    body = (await client.get(profile_url(idol))).json()

    assert body["viewer_follow_state"] == "NONE"
    assert body["follows_viewer"] is False


async def test_your_own_profile_offers_nothing_to_follow(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    ripley = await make_user("ripley")

    body = (await client.get(profile_url(ripley), headers=auth_headers(ripley))).json()

    assert body["is_viewer"] is True
    assert body["viewer_follow_state"] == "NONE"


async def test_the_profile_says_when_they_follow_you(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """What makes "Remove follower" reachable from the profile."""
    ripley = await make_user("ripley")
    fan = await make_user("hicks")
    await client.post(follow_url(ripley), headers=auth_headers(fan))

    body = (await client.get(profile_url(fan), headers=auth_headers(ripley))).json()

    assert body["follows_viewer"] is True
    assert body["viewer_follow_state"] == "NONE", "following back is a separate edge"


async def test_a_pending_request_is_not_a_follower_on_the_profile(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    await client.post(follow_url(newt), headers=auth_headers(hopeful))

    body = (await client.get(profile_url(hopeful), headers=auth_headers(newt))).json()

    assert body["follows_viewer"] is False


# --- The gate reads what these actions wrote (SPEC §6.7) --------------------


async def test_an_accepted_follow_unlocks_a_private_accounts_content(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The whole point of the slice: no read endpoint was changed, and yet all of
    them open up the moment an approved edge exists."""
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    db.add(Review(user_id=newt.id, game_id=catalog[0].id, rating=8))
    await db.flush()

    reviews_url = f"/api/v1/users/{newt.id}/reviews"
    assert (await client.get(reviews_url, headers=auth_headers(hopeful))).status_code == 403

    await client.post(follow_url(newt), headers=auth_headers(hopeful))
    await client.post(f"/api/v1/follow/requests/{hopeful.id}/accept", headers=auth_headers(newt))

    reviews = await client.get(reviews_url, headers=auth_headers(hopeful))
    stats = await client.get(f"/api/v1/users/{newt.id}/stats", headers=auth_headers(hopeful))
    followers = await client.get(
        f"/api/v1/users/{newt.id}/followers", headers=auth_headers(hopeful)
    )

    assert reviews.status_code == 200, reviews.text
    assert len(reviews.json()["items"]) == 1
    assert stats.status_code == 200
    assert followers.status_code == 200


async def test_a_declined_request_leaves_the_content_locked(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    db.add(Review(user_id=newt.id, game_id=catalog[0].id, rating=8))
    await db.flush()

    await client.post(follow_url(newt), headers=auth_headers(hopeful))
    await client.post(f"/api/v1/follow/requests/{hopeful.id}/decline", headers=auth_headers(newt))

    reviews = await client.get(f"/api/v1/users/{newt.id}/reviews", headers=auth_headers(hopeful))
    assert reviews.status_code == 403


async def test_a_new_follower_shows_up_in_the_follower_list(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    idol = await make_user("ripley")
    fan = await make_user("hicks")

    await client.post(follow_url(idol), headers=auth_headers(fan))

    page = (await client.get(f"/api/v1/users/{idol.id}/followers")).json()
    assert [shell["username"] for shell in page["items"]] == ["hicks"]


# --- Notifications (SPEC §6.12) ---------------------------------------------


async def test_following_a_public_account_announces_a_new_follower(
    client: AsyncClient,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    fan = await make_user("hicks")
    idol = await make_user("ripley")

    await client.post(follow_url(idol), headers=auth_headers(fan))

    assert notifications_log == [
        EmittedNotification(
            recipient_id=idol.id, actor_id=fan.id, type=NotificationType.NEW_FOLLOWER
        )
    ]


async def test_asking_a_private_account_announces_a_request_instead(
    client: AsyncClient,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)

    await client.post(follow_url(newt), headers=auth_headers(hopeful))

    assert [event.type for event in notifications_log] == [NotificationType.FOLLOW_REQUEST]


async def test_a_repeated_follow_does_not_announce_anything(
    client: AsyncClient,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    """Otherwise a retrying client would ring the same bell over and over."""
    fan = await make_user("hicks")
    idol = await make_user("ripley")

    await client.post(follow_url(idol), headers=auth_headers(fan))
    await client.post(follow_url(idol), headers=auth_headers(fan))

    assert len(notifications_log) == 1


async def test_unfollowing_announces_nothing(
    client: AsyncClient,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    notifications_log: list[EmittedNotification],
) -> None:
    """SPEC §6.12 lists no notification for losing a follower, and telling
    someone they were dropped is an unkindness the product does not need."""
    fan = await make_user("hicks")
    idol = await make_user("ripley")
    await client.post(follow_url(idol), headers=auth_headers(fan))
    notifications_log.clear()

    await client.delete(follow_url(idol), headers=auth_headers(fan))

    assert notifications_log == []
