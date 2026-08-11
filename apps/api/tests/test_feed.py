"""The Home feed — `GET /feed` and its empty state (SPEC §6.4, §6.11, §8).

A review in the feed is the profile grid's projection with a different WHERE, so
the tests that earn their place are about the WHERE: which edges put an item in
front of you, and which ones take it away again. The projection itself is already
covered by `test_reviews_listing`, and the counters by `test_interactions_*` —
what is checked here is that the feed inherits both rather than growing its own.

Since the backlog slice the feed has a second source, so the last section adds
the questions a union raises that a single table never did: that both kinds obey
the same follow gate, that they interleave under one ordering, and that a cursor
walks the mixture without repeating anything.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus, FollowStatus
from app.models.game import Game, TrendingScore
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User
from app.schemas.game import TrendingWindow

MakeUser = Callable[..., Awaitable[User]]
MakeReview = Callable[..., Awaitable[Review]]
AuthHeaders = Callable[[User], dict[str, str]]

FEED_URL = "/api/v1/feed"
SUGGESTIONS_URL = "/api/v1/feed/suggestions"


async def follow(
    db: AsyncSession,
    follower: User,
    followee: User,
    *,
    status: FollowStatus = FollowStatus.ACCEPTED,
) -> Follow:
    edge = Follow(follower_id=follower.id, followee_id=followee.id, status=status)
    db.add(edge)
    await db.flush()
    return edge


async def backdate(db: AsyncSession, review: Review, *, minutes: int) -> Review:
    """Move a review into the past.

    `created_at` defaults to `now()`, which in Postgres is the *transaction*
    clock, so everything one test writes shares a timestamp and "newest first"
    would be decided entirely by the id tiebreaker.
    """
    await db.execute(
        sa.update(Review)
        .where(Review.id == review.id)
        .values(created_at=sa.text(f"now() - interval '{minutes} minutes'"))
    )
    await db.flush()
    return review


async def add_to_list(
    db: AsyncSession,
    user: User,
    game: Game,
    status: BacklogStatus = BacklogStatus.PLAYING,
    *,
    minutes: int = 0,
) -> BacklogItem:
    """Put a game on somebody's list, `minutes` ago — see `backdate`."""
    item = BacklogItem(user_id=user.id, game_id=game.id, status=status, position=0)
    db.add(item)
    await db.flush()

    if minutes:
        await db.execute(
            sa.update(BacklogItem)
            .where(BacklogItem.id == item.id)
            .values(status_changed_at=sa.text(f"now() - interval '{minutes} minutes'"))
        )
        await db.flush()
    return item


def ids(body: dict[str, object]) -> list[str]:
    """The page's items by envelope id — never `item["review"]["id"]`.

    A feed page holds more than one kind of item, and the id a client keys and
    orders on is the one on the outside.
    """
    items = body["items"]
    assert isinstance(items, list)
    return [item["id"] for item in items]


def kinds(body: dict[str, object]) -> list[str]:
    items = body["items"]
    assert isinstance(items, list)
    return [item["type"] for item in items]


# --- Whose reviews arrive ---------------------------------------------------


async def test_the_feed_carries_reviews_from_people_you_follow(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    review = await make_review(author)
    await follow(db, viewer, author)

    response = await client.get(FEED_URL, headers=auth_headers(viewer))

    assert response.status_code == 200, response.text
    assert ids(response.json()) == [str(review.id)]


async def test_a_stranger_is_not_in_your_feed(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    await make_review(await make_user("ripley"))

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert body["items"] == []
    assert body["next_cursor"] is None


async def test_a_pending_request_is_not_a_follow(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The whole point of approval in SPEC §6.7 is that nothing arrives until it
    is given, and a feed is where that would be most obvious if it leaked."""
    viewer = await make_user("hicks")
    author = await make_user("ripley", is_private=True)
    await make_review(author)
    await follow(db, viewer, author, status=FollowStatus.PENDING)

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert body["items"] == []


async def test_unfollowing_empties_the_feed_again(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await make_review(author)
    await follow(db, viewer, author)

    before = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()
    await client.delete(f"/api/v1/follow/{author.id}", headers=auth_headers(viewer))
    after = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert len(before["items"]) == 1
    assert after["items"] == []


async def test_your_own_reviews_are_not_in_your_feed(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.4 defines Home as the accounts you follow, and `no_self_follow`
    means there is no edge to yourself. Your own reviews are on your profile."""
    viewer = await make_user("hicks")
    await make_review(viewer)

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert body["items"] == []


async def test_a_deactivated_author_drops_out(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await make_review(author)
    await follow(db, viewer, author)

    author.is_active = False
    await db.flush()

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert body["items"] == []


async def test_the_feed_needs_a_caller(client: AsyncClient) -> None:
    """There is no anonymous version of *your* follow graph."""
    assert (await client.get(FEED_URL)).status_code == 401


# --- Privacy (SPEC §6.7) ----------------------------------------------------


async def test_approval_lets_a_private_accounts_reviews_through(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The edge that grants access is the edge that fills the feed — one row,
    not a follow plus a separate permission that could disagree with it."""
    viewer = await make_user("hicks")
    author = await make_user("ripley", is_private=True)
    review = await make_review(author)
    edge = await follow(db, viewer, author, status=FollowStatus.PENDING)

    before = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    edge.status = FollowStatus.ACCEPTED
    await db.flush()
    after = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert before["items"] == []
    assert ids(after) == [str(review.id)]


async def test_removing_the_follower_takes_the_reviews_back(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """A private author revoking access (SPEC §6.7) clears the feed too."""
    viewer = await make_user("hicks")
    author = await make_user("ripley", is_private=True)
    await make_review(author)
    await follow(db, viewer, author)

    removed = await client.delete(f"/api/v1/followers/{viewer.id}", headers=auth_headers(author))
    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert removed.status_code == 200, removed.text
    assert body["items"] == []


async def test_switching_to_private_keeps_existing_followers_fed(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.7: public → private keeps the followers you already had."""
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    review = await make_review(author)
    await follow(db, viewer, author)

    await client.patch("/api/v1/users/me", headers=auth_headers(author), json={"is_private": True})
    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert ids(body) == [str(review.id)]


# --- Ordering and paging ----------------------------------------------------


async def test_newest_first_across_everyone_you_follow(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    ripley = await make_user("ripley")
    bishop = await make_user("bishop")
    await follow(db, viewer, ripley)
    await follow(db, viewer, bishop)

    oldest = await backdate(db, await make_review(ripley, game=catalog[0]), minutes=60)
    middle = await backdate(db, await make_review(bishop, game=catalog[1]), minutes=30)
    newest = await backdate(db, await make_review(ripley, game=catalog[2]), minutes=5)

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert ids(body) == [str(newest.id), str(middle.id), str(oldest.id)]


async def test_paging_repeats_nothing_and_skips_nothing(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await follow(db, viewer, author)
    for index in range(5):
        await backdate(db, await make_review(author, game=catalog[index]), minutes=60 - index)

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(3):
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = (await client.get(FEED_URL, headers=auth_headers(viewer), params=params)).json()
        seen.extend(ids(page))
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert len(seen) == 5
    assert len(set(seen)) == 5
    assert cursor is None


async def test_a_page_that_ends_the_feed_carries_no_cursor(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await make_review(author)
    await follow(db, viewer, author)

    body = (await client.get(FEED_URL, headers=auth_headers(viewer), params={"limit": 5})).json()

    assert len(body["items"]) == 1
    assert body["next_cursor"] is None


async def test_a_hand_edited_cursor_is_rejected(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    viewer = await make_user("hicks")

    response = await client.get(
        FEED_URL, headers=auth_headers(viewer), params={"cursor": "not-a-cursor"}
    )

    assert response.status_code == 400


# --- What an item looks like ------------------------------------------------


async def test_every_item_says_what_kind_of_thing_it_is(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The discriminator from SPEC §6.11, which is what let activity events be
    blended into this same list without breaking a client that was reading it
    before they existed."""
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    review = await make_review(author)
    await follow(db, viewer, author)

    item = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()["items"][0]

    assert item["type"] == "review"
    assert item["occurred_at"] == item["review"]["created_at"]
    assert item["review"]["id"] == str(review.id)
    # On the envelope as well as inside it: a client keys and orders the list
    # before it knows what kind of item this is, and reaching into `review` for
    # either would be code that breaks on the first activity event.
    assert item["id"] == str(review.id)


async def test_an_item_carries_the_whole_review(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """A row renders rating, game and author without a second request per item."""
    viewer = await make_user("hicks")
    author = await make_user("ripley", display_name="Ellen Ripley")
    await make_review(author, game=catalog[0], rating=9)
    await follow(db, viewer, author)

    review = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()["items"][0]["review"]

    assert review["author"]["username"] == "ripley"
    assert review["game"]["title"] == catalog[0].title
    assert review["rating"] == 9
    assert review["stars"] == 4.5
    assert review["thumbnail_url"] == catalog[0].cover_url


async def test_items_report_real_likes_and_comments(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """No counting path of its own: the feed reads the same `interaction_stats`
    the review detail does, so a like posted anywhere shows up here."""
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    review = await make_review(author)
    await follow(db, viewer, author)

    await client.post(f"/api/v1/reviews/{review.id}/like", headers=auth_headers(viewer))
    await client.post(
        f"/api/v1/reviews/{review.id}/comments",
        headers=auth_headers(viewer),
        json={"text": "Astonishing."},
    )

    item = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()["items"][0]

    assert item["review"]["like_count"] == 1
    assert item["review"]["comment_count"] == 1
    assert item["review"]["viewer_has_liked"] is True


async def test_viewer_has_liked_is_answered_per_reader(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    other = await make_user("bishop")
    author = await make_user("ripley")
    review = await make_review(author)
    await follow(db, viewer, author)
    await follow(db, other, author)

    await client.post(f"/api/v1/reviews/{review.id}/like", headers=auth_headers(viewer))

    mine = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()["items"][0]
    theirs = (await client.get(FEED_URL, headers=auth_headers(other))).json()["items"][0]

    assert mine["review"]["viewer_has_liked"] is True
    assert theirs["review"]["viewer_has_liked"] is False
    assert theirs["review"]["like_count"] == 1


# --- Backlog activity blended inline (SPEC §6.11) ---------------------------


async def test_a_followees_status_change_arrives_as_an_activity_item(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.11's "Sam completed *Hades*", inline in Home rather than on a tab."""
    viewer = await make_user("hicks")
    sam = await make_user("ripley")
    await follow(db, viewer, sam)
    item = await add_to_list(db, sam, catalog[0], BacklogStatus.COMPLETED)

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert kinds(body) == ["backlog_activity"]
    row = body["items"][0]
    assert row["id"] == str(item.id)
    assert row["status"] == "COMPLETED"
    assert row["actor"]["username"] == "ripley"
    assert row["game"]["title"] == catalog[0].title


async def test_an_activity_item_is_keyed_on_the_event_not_the_game(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Two people can have the same game on a list; the envelope id is the row's,
    so a client keying on it does not collapse them into one."""
    viewer = await make_user("hicks")
    ripley = await make_user("ripley")
    bishop = await make_user("bishop")
    await follow(db, viewer, ripley)
    await follow(db, viewer, bishop)
    await add_to_list(db, ripley, catalog[0], minutes=10)
    await add_to_list(db, bishop, catalog[0], minutes=5)

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert len(set(ids(body))) == 2


async def test_a_strangers_status_change_is_not_in_your_feed(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    stranger = await make_user("bishop")
    await add_to_list(db, stranger, catalog[0])

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert body["items"] == []


async def test_your_own_status_changes_are_not_in_your_own_feed(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Home is the accounts you follow. Your own lists are on your profile."""
    viewer = await make_user("hicks")
    await add_to_list(db, viewer, catalog[0])

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert body["items"] == []


async def test_a_pending_request_does_not_leak_a_private_accounts_lists(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.9: lists inherit account privacy — and the follow edge is the gate,
    exactly as it is for reviews."""
    hopeful = await make_user("hicks")
    newt = await make_user("newt", is_private=True)
    await follow(db, hopeful, newt, status=FollowStatus.PENDING)
    await add_to_list(db, newt, catalog[0])

    body = (await client.get(FEED_URL, headers=auth_headers(hopeful))).json()

    assert body["items"] == []


async def test_approval_lets_a_private_accounts_activity_through(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    follower = await make_user("hicks")
    newt = await make_user("newt", is_private=True)
    edge = await follow(db, follower, newt, status=FollowStatus.PENDING)
    await add_to_list(db, newt, catalog[0])

    edge.status = FollowStatus.ACCEPTED
    await db.flush()

    body = (await client.get(FEED_URL, headers=auth_headers(follower))).json()

    assert kinds(body) == ["backlog_activity"]


async def test_a_deactivated_actor_drops_out(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await follow(db, viewer, author)
    await add_to_list(db, author, catalog[0])

    author.is_active = False
    await db.flush()

    assert (await client.get(FEED_URL, headers=auth_headers(viewer))).json()["items"] == []


async def test_activity_older_than_the_window_is_not_news(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """Reviews are the archive and stay; an activity event stops being news."""
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await follow(db, viewer, author)
    old_review = await backdate(
        db, await make_review(author, game=catalog[0]), minutes=60 * 24 * 30
    )
    await add_to_list(db, author, catalog[1], minutes=60 * 24 * 30)

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert ids(body) == [str(old_review.id)]


async def test_reviews_and_activity_are_one_ordering(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """The point of the union: an activity event sits *between* two reviews by
    time, rather than in a block above or below them."""
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await follow(db, viewer, author)

    oldest = await backdate(db, await make_review(author, game=catalog[0]), minutes=60)
    middle = await add_to_list(db, author, catalog[1], minutes=30)
    newest = await backdate(db, await make_review(author, game=catalog[2]), minutes=5)

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert ids(body) == [str(newest.id), str(middle.id), str(oldest.id)]
    assert kinds(body) == ["review", "backlog_activity", "review"]


async def test_paging_walks_a_mixed_feed_without_repeating(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
) -> None:
    """One cursor over both sources. Two separately paged lists merged in the
    client is the thing this shape exists to avoid, and it would show up here."""
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await follow(db, viewer, author)
    for index in range(3):
        await backdate(db, await make_review(author, game=catalog[index]), minutes=60 - index * 10)
    for index in range(3):
        await add_to_list(db, author, catalog[index + 3], minutes=55 - index * 10)

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(4):
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = (await client.get(FEED_URL, headers=auth_headers(viewer), params=params)).json()
        seen.extend(ids(page))
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert len(seen) == 6
    assert len(set(seen)) == 6
    assert cursor is None


async def test_moving_a_game_twice_is_one_line_not_two(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The event is derived from the row, and there is one row per game — so the
    feed reports where a game is now, not the route it took there."""
    viewer = await make_user("hicks")
    author = await make_user("ripley")
    await follow(db, viewer, author)
    item = await add_to_list(db, author, catalog[0], BacklogStatus.TO_BE_PLAYED)

    item.status = BacklogStatus.PLAYING
    await db.flush()

    body = (await client.get(FEED_URL, headers=auth_headers(viewer))).json()

    assert len(body["items"]) == 1
    assert body["items"][0]["status"] == "PLAYING"


# --- The empty state (SPEC §6.4) --------------------------------------------


async def test_suggestions_offer_the_most_followed_public_accounts(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    popular = await make_user("ripley")
    await make_user("bishop")
    for index in range(3):
        await follow(db, await make_user(f"marine{index}"), popular)

    body = (await client.get(SUGGESTIONS_URL, headers=auth_headers(viewer))).json()

    usernames = [account["username"] for account in body["accounts"]]
    assert usernames[0] == "ripley"
    assert "bishop" in usernames


async def test_suggestions_leave_out_anyone_you_have_already_asked(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Suggesting someone whose approval you are waiting on reads as though the
    request never went through."""
    viewer = await make_user("hicks")
    followed = await make_user("ripley")
    asked = await make_user("bishop")
    await follow(db, viewer, followed)
    await follow(db, viewer, asked, status=FollowStatus.PENDING)

    body = (await client.get(SUGGESTIONS_URL, headers=auth_headers(viewer))).json()

    assert [account["username"] for account in body["accounts"]] == []


async def test_suggestions_leave_out_private_accounts_and_yourself(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    viewer = await make_user("hicks")
    await make_user("ripley", is_private=True)

    body = (await client.get(SUGGESTIONS_URL, headers=auth_headers(viewer))).json()

    assert body["accounts"] == []


async def test_suggestions_carry_trending_once_it_has_been_computed(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("hicks")
    db.add(TrendingScore(game_id=catalog[0].id, window=TrendingWindow.WEEK.value, score=12.0))
    await db.flush()

    body = (await client.get(SUGGESTIONS_URL, headers=auth_headers(viewer))).json()

    assert [entry["game"]["title"] for entry in body["trending"]] == [catalog[0].title]


async def test_suggestions_are_empty_rather_than_invented(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """Trending is materialised (SPEC §6.11); until the job has run there is
    nothing to show, and a made-up ranking would be worse than none."""
    viewer = await make_user("hicks")

    body = (await client.get(SUGGESTIONS_URL, headers=auth_headers(viewer))).json()

    assert body["trending"] == []


async def test_suggestions_need_a_caller(client: AsyncClient) -> None:
    assert (await client.get(SUGGESTIONS_URL)).status_code == 401
