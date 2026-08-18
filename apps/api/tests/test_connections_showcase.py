"""The two read surfaces: the verified badge and the profile showcase.

Most of these are about when the badge must *not* appear. That is the side worth
guarding: a missing badge is a small disappointment, and a badge on a claim that
is not actually backed is the feature failing at the one thing it exists to do.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connections import PlatformAccount, PlatformLibraryItem
from app.models.enums import ConnectionProvider, LibraryMatchSource
from app.models.game import Game
from app.models.review import Review
from app.models.user import User

MakeUser = Callable[..., Awaitable[User]]
MakeReview = Callable[..., Awaitable[Review]]
AuthHeaders = Callable[[User], dict[str, str]]

STEAM_ID = "76561197960287930"


async def _link(
    db: AsyncSession, user: User, *, is_visible: bool = True, steam_id: str = STEAM_ID
) -> PlatformAccount:
    account = PlatformAccount(
        user_id=user.id,
        provider=ConnectionProvider.STEAM,
        provider_account_id=steam_id,
        provider_username="ada",
        profile_url="https://steamcommunity.com/id/ada/",
        is_visible=is_visible,
    )
    db.add(account)
    await db.flush()
    return account


async def _own(
    db: AsyncSession,
    account: PlatformAccount,
    game: Game,
    *,
    minutes: int = 2832,
    match: LibraryMatchSource | None = LibraryMatchSource.EXTERNAL_ID,
    appid: str = "1145360",
) -> PlatformLibraryItem:
    item = PlatformLibraryItem(
        platform_account_id=account.id,
        provider_game_id=appid,
        provider_title=game.title,
        game_id=game.id if match else None,
        match_source=match,
        playtime_minutes=minutes,
    )
    db.add(item)
    await db.flush()
    return item


async def _read_review(client: AsyncClient, review: Review, viewer: User | None, headers: Any):
    return await client.get(
        f"/api/v1/reviews/{review.id}",
        headers=headers(viewer) if viewer else {},
    )


# --- The verified badge -----------------------------------------------------


async def test_a_review_carries_the_authors_platform_playtime(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    author = await make_user("ada")
    review = await make_review(author, game=catalog[0])
    account = await _link(db, author)
    await _own(db, account, catalog[0], minutes=2832)
    await db.commit()

    response = await client.get(f"/api/v1/reviews/{review.id}")

    verified = response.json()["verified_playtime"]
    assert verified["playtime_minutes"] == 2832
    assert verified["provider"] == "STEAM"


async def test_the_badge_is_absent_without_a_linked_account(
    client: AsyncClient,
    make_user: MakeUser,
    make_review: MakeReview,
    catalog: list[Game],
) -> None:
    review = await make_review(await make_user("ada"), game=catalog[0])

    response = await client.get(f"/api/v1/reviews/{review.id}")

    assert response.json()["verified_playtime"] is None


async def test_a_title_match_never_backs_the_badge(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    catalog: list[Game],
) -> None:
    """The distinction the whole `match_source` column exists for.

    A trigram match is right often enough to list a game on a showcase and not
    often enough to put a number beside somebody's name and call it evidence.
    """
    author = await make_user("ada")
    review = await make_review(author, game=catalog[0])
    account = await _link(db, author)
    await _own(db, account, catalog[0], match=LibraryMatchSource.TITLE)
    await db.commit()

    response = await client.get(f"/api/v1/reviews/{review.id}")

    assert response.json()["verified_playtime"] is None


async def test_hiding_the_connection_withdraws_the_badge(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    """Derived at read time, so the switch takes effect everywhere at once.

    A column copied onto the review when it was written could not do this without
    a backfill over every review the member had ever posted.
    """
    author = await make_user("ada")
    review = await make_review(author, game=catalog[0])
    account = await _link(db, author)
    await _own(db, account, catalog[0])
    await db.commit()

    await client.patch(
        "/api/v1/connections/steam/visibility",
        headers=auth_headers(author),
        json={"is_visible": False},
    )

    response = await client.get(f"/api/v1/reviews/{review.id}")
    assert response.json()["verified_playtime"] is None


async def test_unlinking_withdraws_the_badge(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    author = await make_user("ada")
    review = await make_review(author, game=catalog[0])
    account = await _link(db, author)
    await _own(db, account, catalog[0])
    await db.commit()

    await client.delete("/api/v1/connections/steam", headers=auth_headers(author))

    response = await client.get(f"/api/v1/reviews/{review.id}")
    assert response.json()["verified_playtime"] is None


async def test_a_zero_hour_entry_is_not_a_badge(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    catalog: list[Game],
) -> None:
    """Owning a game is not evidence of having played it."""
    author = await make_user("ada")
    review = await make_review(author, game=catalog[0])
    account = await _link(db, author)
    await _own(db, account, catalog[0], minutes=0)
    await db.commit()

    response = await client.get(f"/api/v1/reviews/{review.id}")

    assert response.json()["verified_playtime"] is None


async def test_another_members_library_does_not_leak_onto_this_review(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    catalog: list[Game],
) -> None:
    """The lookup is keyed on (author, game); the obvious way to get it wrong is game alone."""
    author = await make_user("ada")
    review = await make_review(author, game=catalog[0])
    other = await make_user("grace")
    other_account = await _link(db, other, steam_id="76561197960287931")
    await _own(db, other_account, catalog[0], minutes=9999)
    await db.commit()

    response = await client.get(f"/api/v1/reviews/{review.id}")

    assert response.json()["verified_playtime"] is None


async def test_the_badge_appears_on_the_feed_too(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    """Every review surface hydrates through `with_stats`, so this proves the lot."""
    author = await make_user("ada")
    viewer = await make_user("grace")
    await make_review(author, game=catalog[0])
    account = await _link(db, author)
    await _own(db, account, catalog[0], minutes=600)
    await db.commit()
    await client.post(f"/api/v1/follow/{author.id}", headers=auth_headers(viewer))

    response = await client.get("/api/v1/feed", headers=auth_headers(viewer))

    reviews = [
        item["review"] for item in response.json()["items"] if item.get("review") is not None
    ]
    assert reviews
    assert reviews[0]["verified_playtime"]["playtime_minutes"] == 600


async def test_a_page_of_reviews_costs_one_extra_query(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    make_review: MakeReview,
    catalog: list[Game],
    auth_headers: AuthHeaders,
) -> None:
    """The badge must not scale with the page size.

    Guarded because the naive implementation — resolve per review — is both the
    obvious one and invisible until the feed is busy.
    """
    author = await make_user("ada")
    account = await _link(db, author)
    for game in catalog[:5]:
        await make_review(author, game=game)
        await _own(db, account, game, appid=str(game.id.int % 100000))
    await db.commit()

    statements: list[str] = []
    from sqlalchemy import event

    sync_engine = db.get_bind().engine  # type: ignore[union-attr]

    def _record(conn: Any, cursor: Any, statement: str, *args: Any) -> None:
        if "platform_library_items" in statement:
            statements.append(statement)

    event.listen(sync_engine, "before_cursor_execute", _record)
    try:
        response = await client.get(f"/api/v1/users/{author.id}/reviews")
    finally:
        event.remove(sync_engine, "before_cursor_execute", _record)

    assert len(response.json()["items"]) == 5
    assert len(statements) == 1


# --- The profile showcase ---------------------------------------------------


async def test_a_profile_shows_the_linked_platform(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    catalog: list[Game],
) -> None:
    owner = await make_user("ada")
    account = await _link(db, owner)
    await _own(db, account, catalog[0], minutes=600)
    await _own(db, account, catalog[1], minutes=120, appid="2")
    await db.commit()

    response = await client.get(f"/api/v1/users/{owner.id}/connections")

    showcase = response.json()[0]
    assert showcase["provider"] == "STEAM"
    assert showcase["total_games"] == 2
    assert showcase["total_playtime_minutes"] == 720
    # Ordered by hours, not by when they were synced.
    assert [entry["playtime_minutes"] for entry in showcase["most_played"]] == [600, 120]


async def test_a_hidden_connection_is_not_shown(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    owner = await make_user("ada")
    account = await _link(db, owner, is_visible=False)
    await _own(db, account, catalog[0])
    await db.commit()

    response = await client.get(f"/api/v1/users/{owner.id}/connections")

    assert response.json() == []


async def test_a_private_profiles_showcase_needs_an_approved_follow(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    """Gated by the same follow graph as the rest of the profile, not just `is_visible`."""
    owner = await make_user("ada", is_private=True)
    account = await _link(db, owner)
    await _own(db, account, catalog[0])
    await db.commit()

    stranger = await make_user("grace")
    refused = await client.get(
        f"/api/v1/users/{owner.id}/connections", headers=auth_headers(stranger)
    )
    assert refused.status_code == 403

    allowed = await client.get(f"/api/v1/users/{owner.id}/connections", headers=auth_headers(owner))
    assert allowed.status_code == 200


async def test_an_unmatched_game_is_left_off_the_showcase(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    """It still counts as owned; it just has no card to render."""
    owner = await make_user("ada")
    account = await _link(db, owner)
    await _own(db, account, catalog[0], minutes=100, match=None, appid="99")
    await db.commit()

    showcase = (await client.get(f"/api/v1/users/{owner.id}/connections")).json()[0]

    assert showcase["total_games"] == 1
    assert showcase["most_played"] == []


async def test_a_profile_with_nothing_linked_returns_an_empty_list(
    client: AsyncClient, make_user: MakeUser
) -> None:
    owner = await make_user("ada")

    response = await client.get(f"/api/v1/users/{owner.id}/connections")

    assert response.status_code == 200
    assert response.json() == []


# --- The composer prefill ---------------------------------------------------


async def test_the_composer_is_offered_the_members_own_playtime(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    author = await make_user("ada")
    account = await _link(db, author)
    await _own(db, account, catalog[0], minutes=930)
    await db.commit()

    response = await client.get(
        "/api/v1/me/connections/playtime",
        headers=auth_headers(author),
        params={"game_id": str(catalog[0].id)},
    )

    body = response.json()
    assert body["playtime_minutes"] == 930
    assert body["provider"] == "STEAM"


async def test_the_composer_gets_nothing_for_a_game_not_in_the_library(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    author = await make_user("ada")
    await _link(db, author)
    await db.commit()

    response = await client.get(
        "/api/v1/me/connections/playtime",
        headers=auth_headers(author),
        params={"game_id": str(catalog[0].id)},
    )

    assert response.json()["playtime_minutes"] is None
    assert response.json()["provider"] is None


async def test_the_composer_prefill_requires_signing_in(
    client: AsyncClient, catalog: list[Game]
) -> None:
    response = await client.get(
        "/api/v1/me/connections/playtime", params={"game_id": str(catalog[0].id)}
    )

    assert response.status_code == 401
