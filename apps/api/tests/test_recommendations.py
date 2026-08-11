"""Personalised recommendations — Discover's section and Home's blend (SPEC §6.4, §6.5).

Everything here is written against the bundled seed catalog, whose genres are
committed data, so a test can say "somebody who loves Elden Ring should be
offered The Witcher 3" and mean it. That is the point of the whole design: the
scoring is arithmetic over rows, so the expected answer can be worked out on
paper rather than observed and pinned.

Ties are the one thing not asserted in order. Two games with identical scores
fall back to the id, and the seed importer generates those, so a tie is compared
as a *set* — which is also the honest claim: the ranking says those games are
equally good matches, not that one of them is second.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus, FollowStatus
from app.models.game import Game, TrendingScore
from app.models.review import Review
from app.models.social import Follow
from app.models.user import FavoriteGame, User
from app.schemas.game import TrendingWindow

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]

DISCOVER_URL = "/api/v1/games/discover"
FEED_URL = "/api/v1/feed"
SUGGESTIONS_URL = "/api/v1/feed/suggestions"

# Seed titles, with the genres that make each one useful here.
ELDEN_RING = "Elden Ring"  # RPG, Adventure
WITCHER = "The Witcher 3: Wild Hunt"  # RPG, Adventure
ZELDA = "The Legend of Zelda: Breath of the Wild"  # Adventure, RPG, Puzzle
CYBERPUNK = "Cyberpunk 2077"  # RPG, Shooter, Adventure
BALDURS_GATE = "Baldur's Gate 3"  # RPG, Strategy, Adventure
DARK_SOULS = "Dark Souls"  # RPG, Adventure
CELESTE = "Celeste"  # Platform, Indie
HOLLOW_KNIGHT = "Hollow Knight"  # Platform, Adventure, Indie
PORTAL = "Portal 2"  # Puzzle, Shooter, Platform
BALATRO = "Balatro"  # Card & Board Game, Strategy, Indie
AMONG_US = "Among Us"  # Strategy, Indie

# Every seed game sharing RPG or Adventure with both of Elden Ring's genres, so
# scoring twice over. Nothing else can reach the top of that viewer's list.
BEST_FOR_AN_RPG_FAN = {WITCHER, ZELDA, CYBERPUNK, BALDURS_GATE, DARK_SOULS}


def game_named(catalog: list[Game], title: str) -> Game:
    return next(game for game in catalog if game.title == title)


async def rate(db: AsyncSession, user: User, game: Game, rating: int) -> Review:
    review = Review(user_id=user.id, game_id=game.id, rating=rating)
    db.add(review)
    await db.flush()
    return review


async def pin(db: AsyncSession, user: User, game: Game) -> None:
    """Add a game to the profile's favorites (SPEC §6.2)."""
    db.add(FavoriteGame(user_id=user.id, game_id=game.id, position=0))
    await db.flush()


async def shelve(
    db: AsyncSession,
    user: User,
    game: Game,
    status: BacklogStatus = BacklogStatus.TO_BE_PLAYED,
) -> None:
    db.add(BacklogItem(user_id=user.id, game_id=game.id, status=status, position=0))
    await db.flush()


async def follow(
    db: AsyncSession,
    follower: User,
    followee: User,
    *,
    status: FollowStatus = FollowStatus.ACCEPTED,
) -> None:
    db.add(Follow(follower_id=follower.id, followee_id=followee.id, status=status))
    await db.flush()


async def make_trending(db: AsyncSession, game: Game, score: float) -> None:
    db.add(TrendingScore(game_id=game.id, window=TrendingWindow.WEEK.value, score=score))
    await db.flush()


async def backdate(db: AsyncSession, review: Review, *, minutes: int) -> Review:
    """Move a review into the past — see the note in `test_feed.backdate`."""
    await db.execute(
        sa.update(Review)
        .where(Review.id == review.id)
        .values(created_at=sa.text(f"now() - interval '{minutes} minutes'"))
    )
    await db.flush()
    return review


async def recommended(
    client: AsyncClient, user: User | None = None, headers: dict[str, str] | None = None
) -> list[str]:
    """The Discover section, by title."""
    _ = user
    response = await client.get(DISCOVER_URL, headers=headers or {})
    assert response.status_code == 200, response.text
    return [game["title"] for game in response.json()["recommended"]]


async def feed_of(client: AsyncClient, headers: dict[str, str], **params: Any) -> dict[str, Any]:
    response = await client.get(FEED_URL, headers=headers, params=params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def blended(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Just the recommended items — the whole point is that they are separable."""
    items: list[dict[str, Any]] = body["items"]
    return [item for item in items if item["type"] == "recommended_review"]


# --- What the viewer told us they like (SPEC §6.5, content signal) ----------


async def test_recommendations_follow_the_genres_you_rate_highly(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """One 10/10 is a whole taste profile: RPG and Adventure, twice as loud as
    anything sharing only one of them."""
    viewer = await make_user("ripley")
    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert set(titles[: len(BEST_FOR_AN_RPG_FAN)]) == BEST_FOR_AN_RPG_FAN


async def test_a_game_sharing_none_of_your_genres_is_never_offered(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("ripley")
    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)

    titles = await recommended(client, headers=auth_headers(viewer))

    # None of these carries RPG or Adventure, so no amount of room in the section
    # can let one in — a score of zero is not a weak match, it is not a match.
    assert {CELESTE, PORTAL, BALATRO, AMONG_US}.isdisjoint(titles)


async def test_a_pinned_favorite_is_taste_even_without_a_rating(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.2 makes favorites a curated, capped list, so pinning one says at
    least as much as rating one — and a viewer who has only pinned is not cold."""
    viewer = await make_user("ripley")
    await pin(db, viewer, game_named(catalog, CELESTE))

    titles = await recommended(client, headers=auth_headers(viewer))

    # Hollow Knight is the only seed game sharing both Platform and Indie.
    assert titles[0] == HOLLOW_KNIGHT


async def test_a_game_you_disliked_does_not_recommend_more_of_the_same(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """A 3/10 records that the viewer played it, not that they want another one.

    With nothing positive on file the viewer is still cold, so what comes back is
    the fallback rather than a genre profile built out of a complaint.
    """
    viewer = await make_user("ripley")
    await rate(db, viewer, game_named(catalog, ELDEN_RING), 3)
    await make_trending(db, game_named(catalog, BALATRO), 9.0)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert titles[0] == BALATRO
    assert BEST_FOR_AN_RPG_FAN.isdisjoint(titles[:1])


async def test_two_viewers_with_different_taste_get_different_recommendations(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The one test that would still fail if the whole thing were a fixed list."""
    rpg_fan = await make_user("ripley")
    await rate(db, rpg_fan, game_named(catalog, ELDEN_RING), 10)

    card_fan = await make_user("hicks")
    await rate(db, card_fan, game_named(catalog, BALATRO), 10)

    for_rpgs = await recommended(client, headers=auth_headers(rpg_fan))
    for_cards = await recommended(client, headers=auth_headers(card_fan))

    assert set(for_rpgs[:5]) == BEST_FOR_AN_RPG_FAN
    # Among Us is the only seed game sharing both Strategy and Indie with Balatro.
    assert for_cards[0] == AMONG_US
    assert for_rpgs[0] != for_cards[0]


# --- Games the viewer already has an opinion about --------------------------


async def test_a_game_you_have_reviewed_is_never_recommended_back(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("ripley")
    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)
    await rate(db, viewer, game_named(catalog, DARK_SOULS), 9)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert ELDEN_RING not in titles
    assert DARK_SOULS not in titles
    # The rest of the profile still stands: what is left of the top group is.
    assert set(titles[:4]) == BEST_FOR_AN_RPG_FAN - {DARK_SOULS}


async def test_a_game_on_any_backlog_list_is_never_recommended(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """All four lists from SPEC §6.9, not just To Be Played. Having dropped a
    game is as much a decision about it as having finished one."""
    for index, status in enumerate(BacklogStatus):
        viewer = await make_user(f"ripley{index}")
        await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)
        await shelve(db, viewer, game_named(catalog, WITCHER), status)

        titles = await recommended(client, headers=auth_headers(viewer))

        assert WITCHER not in titles, status


async def test_your_own_favorite_is_not_recommended_to_you(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The one recommendation that would make the whole section look broken."""
    viewer = await make_user("ripley")
    await pin(db, viewer, game_named(catalog, CELESTE))

    titles = await recommended(client, headers=auth_headers(viewer))

    assert CELESTE not in titles


# --- People who rate like you (SPEC §6.5, collaborative signal) -------------


async def test_a_neighbours_favourite_arrives_even_with_no_genre_in_common(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The half of SPEC §6.5 that genre matching cannot do.

    Balatro shares no genre at all with Portal 2, so the only path into this
    viewer's list is somebody who scored Portal 2 the way they did.
    """
    viewer = await make_user("ripley")
    twin = await make_user("hicks")
    portal = game_named(catalog, PORTAL)

    await rate(db, viewer, portal, 9)
    await rate(db, twin, portal, 9)
    await rate(db, twin, game_named(catalog, BALATRO), 10)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert BALATRO in titles


async def test_somebody_who_disagrees_with_you_is_not_a_neighbour(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Two whole stars apart on the only game you have both played is not taste
    in common, and the recommendation that rides on it should not arrive."""
    viewer = await make_user("ripley")
    stranger = await make_user("hicks")
    portal = game_named(catalog, PORTAL)

    await rate(db, viewer, portal, 9)
    await rate(db, stranger, portal, 2)
    await rate(db, stranger, game_named(catalog, BALATRO), 10)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert BALATRO not in titles


async def test_a_neighbour_recommends_what_they_liked_not_everything_they_played(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("ripley")
    twin = await make_user("hicks")
    portal = game_named(catalog, PORTAL)

    await rate(db, viewer, portal, 9)
    await rate(db, twin, portal, 9)
    await rate(db, twin, game_named(catalog, BALATRO), 4)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert BALATRO not in titles


# --- Cold start (SPEC §6.5) -------------------------------------------------


async def test_a_reader_we_know_nothing_about_gets_what_is_hot(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("ripley")
    await make_trending(db, game_named(catalog, HOLLOW_KNIGHT), 12.0)
    await make_trending(db, game_named(catalog, CELESTE), 5.0)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert titles[:2] == [HOLLOW_KNIGHT, CELESTE]


async def test_a_quiet_week_falls_through_to_popular_all_time(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Trending is materialised (SPEC §6.11) and can legitimately be empty. The
    catalog's history is the backstop, ranked by how many people reviewed a game."""
    viewer = await make_user("ripley")
    popular = game_named(catalog, CELESTE)
    for index in range(3):
        await rate(db, await make_user(f"marine{index}"), popular, 8)
    await rate(db, await make_user("bishop"), game_named(catalog, BALATRO), 10)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert titles[0] == CELESTE


async def test_a_signed_out_visitor_gets_a_section_rather_than_an_error(
    client: AsyncClient, db: AsyncSession, catalog: list[Game], make_user: MakeUser
) -> None:
    """Discover is public (SPEC §6.5) and there is nobody to personalise for."""
    await make_trending(db, game_named(catalog, HOLLOW_KNIGHT), 12.0)

    titles = await recommended(client)

    assert titles[0] == HOLLOW_KNIGHT


async def test_the_fallback_still_skips_a_game_already_on_your_list(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Cold on ratings is not the same as cold on everything: somebody can have
    thirty games shelved and never have scored one."""
    viewer = await make_user("ripley")
    await make_trending(db, game_named(catalog, HOLLOW_KNIGHT), 12.0)
    await make_trending(db, game_named(catalog, CELESTE), 5.0)
    await shelve(db, viewer, game_named(catalog, HOLLOW_KNIGHT), BacklogStatus.PLAYING)

    titles = await recommended(client, headers=auth_headers(viewer))

    assert titles[0] == CELESTE


async def test_an_instance_with_no_activity_offers_nothing_rather_than_anything(
    client: AsyncClient, catalog: list[Game], make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    """A catalog is not a ranking. Dressing an arbitrary slice of it up as a
    recommendation is exactly what the section is supposed not to do — and
    Discover already has a New Releases row for the games nobody has touched."""
    viewer = await make_user("ripley")

    assert await recommended(client, headers=auth_headers(viewer)) == []


# --- The Home blend (SPEC §6.4) ---------------------------------------------


async def test_a_review_of_a_recommended_game_is_blended_into_the_feed(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    stranger = await make_user("bishop")
    await follow(db, viewer, friend)

    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)
    await rate(db, stranger, game_named(catalog, WITCHER), 9)

    items = blended(await feed_of(client, auth_headers(viewer)))

    assert [item["review"]["game"]["title"] for item in items] == [WITCHER]
    assert items[0]["reason"] == "recommended_game"


async def test_a_blended_item_is_a_whole_review_like_any_other(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """It is not a teaser. SPEC §6.4 puts inline like and comment on every feed
    item, and a row the reader cannot act on is a row they scroll past."""
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    stranger = await make_user("bishop", display_name="Carter Burke")
    await follow(db, viewer, friend)

    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)
    await rate(db, stranger, game_named(catalog, WITCHER), 9)

    item = blended(await feed_of(client, auth_headers(viewer)))[0]

    assert item["review"]["author"]["display_name"] == "Carter Burke"
    assert item["review"]["rating"] == 9
    assert item["review"]["like_count"] == 0
    assert item["review"]["viewer_has_liked"] is False
    assert item["id"] == item["review"]["id"]


async def test_a_neighbours_review_arrives_labelled_as_a_suggested_account(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The other half of SPEC §6.4's blend: not the game, the person.

    Balatro shares no genre with Portal 2 and the twin did not like it, so it is
    on nobody's recommended list — the only thing putting it in front of the
    viewer is who wrote it.
    """
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    twin = await make_user("bishop")
    await follow(db, viewer, friend)

    portal = game_named(catalog, PORTAL)
    await rate(db, viewer, portal, 9)
    await rate(db, twin, portal, 9)
    await rate(db, twin, game_named(catalog, BALATRO), 4)

    items = blended(await feed_of(client, auth_headers(viewer)))

    # Everything the twin has written recently, including their opinion of the
    # game the viewer has already played: the reason is the person, so the whole
    # of what that person said is what the reader is being offered.
    assert BALATRO in [item["review"]["game"]["title"] for item in items]
    assert {item["reason"] for item in items} == {"suggested_account"}


async def test_a_private_accounts_review_never_leaks_through_the_blend(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.7 gates content on an approved follow, and a recommendation is the
    one path into the feed that does not carry one."""
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    hidden = await make_user("bishop", is_private=True)
    await follow(db, viewer, friend)

    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)
    await rate(db, hidden, game_named(catalog, WITCHER), 9)

    assert blended(await feed_of(client, auth_headers(viewer))) == []


async def test_a_pending_request_does_not_open_the_blend_either(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    hidden = await make_user("bishop", is_private=True)
    await follow(db, viewer, friend)
    await follow(db, viewer, hidden, status=FollowStatus.PENDING)

    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)
    await rate(db, hidden, game_named(catalog, WITCHER), 9)

    assert blended(await feed_of(client, auth_headers(viewer))) == []


async def test_a_review_by_somebody_you_follow_stays_a_follow_item(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Otherwise it would arrive twice, and the second copy would tell the reader
    a person they chose to follow is a stranger we picked for them."""
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    await follow(db, viewer, friend)

    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)
    await rate(db, friend, game_named(catalog, WITCHER), 9)

    body = await feed_of(client, auth_headers(viewer))

    assert [item["type"] for item in body["items"]] == ["review"]


async def test_your_own_review_is_not_recommended_to_you(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    other = await make_user("bishop")
    await follow(db, viewer, friend)

    portal = game_named(catalog, PORTAL)
    await rate(db, viewer, portal, 9)
    await rate(db, other, portal, 9)
    # Recommended to the viewer through their neighbour, and also written by them.
    await rate(db, other, game_named(catalog, BALATRO), 10)
    await rate(db, viewer, game_named(catalog, BALATRO), 10)

    body = await feed_of(client, auth_headers(viewer))

    assert all(item["review"]["author"]["username"] != "ripley" for item in body["items"])


async def test_nothing_is_blended_into_the_feed_of_somebody_who_follows_nobody(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """SPEC §6.4 promises that reader suggested accounts and trending. Filling
    their Home with recommendations instead would delete the one screen that
    exists to get somebody started."""
    viewer = await make_user("ripley")
    stranger = await make_user("bishop")

    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)
    await rate(db, stranger, game_named(catalog, WITCHER), 9)

    assert (await feed_of(client, auth_headers(viewer)))["items"] == []


async def test_a_blended_item_takes_its_place_in_time_like_everything_else(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """One ordering over the whole union, not a block of recommendations bolted
    to the top — which is also what lets one cursor mean one position."""
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    stranger = await make_user("bishop")
    await follow(db, viewer, friend)
    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)

    recent = await backdate(db, await rate(db, friend, game_named(catalog, CELESTE), 8), minutes=1)
    middle = await backdate(db, await rate(db, stranger, game_named(catalog, ZELDA), 9), minutes=2)
    oldest = await backdate(db, await rate(db, friend, game_named(catalog, PORTAL), 7), minutes=3)

    body = await feed_of(client, auth_headers(viewer))

    assert [item["id"] for item in body["items"]] == [
        str(recent.id),
        str(middle.id),
        str(oldest.id),
    ]
    assert [item["type"] for item in body["items"]] == [
        "review",
        "recommended_review",
        "review",
    ]


async def test_paging_a_blended_feed_repeats_nothing_and_skips_nothing(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """The reason the blend is a third arm of the union rather than a merge in
    Python: an item outside the cursor either repeats or falls down a seam."""
    viewer = await make_user("ripley")
    friend = await make_user("hicks")
    stranger = await make_user("bishop")
    await follow(db, viewer, friend)
    await rate(db, viewer, game_named(catalog, ELDEN_RING), 10)

    expected: list[str] = []
    for minutes, (author, title) in enumerate(
        [
            (friend, CELESTE),
            (stranger, ZELDA),
            (friend, PORTAL),
            (stranger, CYBERPUNK),
            (friend, AMONG_US),
        ],
        start=1,
    ):
        review = await rate(db, author, game_named(catalog, title), 9)
        await backdate(db, review, minutes=minutes)
        expected.append(str(review.id))

    seen: list[str] = []
    cursor: str | None = None
    for _ in range(4):
        params = {"limit": 2} if cursor is None else {"limit": 2, "cursor": cursor}
        body = await feed_of(client, auth_headers(viewer), **params)
        seen += [item["id"] for item in body["items"]]
        cursor = body["next_cursor"]
        if cursor is None:
            break

    assert seen == expected
    assert cursor is None


# --- Who to follow (SPEC §6.4 empty state) ----------------------------------


async def test_suggestions_lead_with_somebody_who_rates_like_you(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Taste beats popularity once there is any taste to go on — which is the
    whole difference between a suggestion and a leaderboard."""
    viewer = await make_user("ripley")
    twin = await make_user("bishop")
    famous = await make_user("hudson")
    for index in range(3):
        await follow(db, await make_user(f"marine{index}"), famous)

    portal = game_named(catalog, PORTAL)
    await rate(db, viewer, portal, 9)
    await rate(db, twin, portal, 9)

    body = (await client.get(SUGGESTIONS_URL, headers=auth_headers(viewer))).json()
    usernames = [account["username"] for account in body["accounts"]]

    assert usernames[0] == "bishop"
    # The old ordering still fills the rest, rather than being replaced by it.
    assert "hudson" in usernames


async def test_a_taste_match_you_already_follow_is_not_suggested_again(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    viewer = await make_user("ripley")
    twin = await make_user("bishop")
    await follow(db, viewer, twin)

    portal = game_named(catalog, PORTAL)
    await rate(db, viewer, portal, 9)
    await rate(db, twin, portal, 9)

    body = (await client.get(SUGGESTIONS_URL, headers=auth_headers(viewer))).json()

    assert "bishop" not in [account["username"] for account in body["accounts"]]


async def test_a_private_taste_match_is_not_suggested(
    client: AsyncClient,
    db: AsyncSession,
    catalog: list[Game],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    """Being alike is not a reason to put somebody in front of a stranger they
    would have to ask permission to read."""
    viewer = await make_user("ripley")
    twin = await make_user("bishop", is_private=True)

    portal = game_named(catalog, PORTAL)
    await rate(db, viewer, portal, 9)
    await rate(db, twin, portal, 9)

    body = (await client.get(SUGGESTIONS_URL, headers=auth_headers(viewer))).json()

    assert body["accounts"] == []
