"""Constraints on linked platform accounts and synced libraries.

These are the invariants the verified playtime badge is built on, tested against
the database rather than through the service, because that is where they are
enforced and where they have to hold even if a future caller forgets them.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import pytest
import sqlalchemy as sa
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connections import PlatformAccount, PlatformLibraryItem
from app.models.enums import ConnectionProvider, LibraryMatchSource
from app.models.game import Game
from app.models.user import User
from app.services.games_import import delete_all_games

MakeUser = Callable[..., Awaitable[User]]


async def _link(db: AsyncSession, user: User, steam_id: str) -> PlatformAccount:
    account = PlatformAccount(
        user_id=user.id,
        provider=ConnectionProvider.STEAM,
        provider_account_id=steam_id,
    )
    db.add(account)
    await db.flush()
    return account


async def test_a_link_defaults_to_visible(db: AsyncSession, make_user: MakeUser) -> None:
    """Linking is an opt-in act already; it should not need a second opt-in."""
    account = await _link(db, await make_user("ada"), "76561197960287930")

    assert account.is_visible is True
    assert account.last_synced_at is None
    assert account.last_sync_status is None


async def test_one_member_cannot_link_two_steam_accounts(
    db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user("ada")
    await _link(db, user, "76561197960287930")

    with pytest.raises(IntegrityError):
        await _link(db, user, "76561197960287931")


async def test_two_members_cannot_claim_the_same_steam_account(
    db: AsyncSession, make_user: MakeUser
) -> None:
    """The constraint the whole verified claim rests on.

    Without it both profiles would wear the same library's hours as evidence,
    and a badge that two unrelated people can show for one account is not
    evidence of anything.
    """
    await _link(db, await make_user("ada"), "76561197960287930")

    with pytest.raises(IntegrityError):
        await _link(db, await make_user("grace"), "76561197960287930")


async def test_unlinking_takes_the_synced_library_with_it(
    db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    """The library is derived data; keeping it after the link goes is a leak."""
    account = await _link(db, await make_user("ada"), "76561197960287930")
    db.add(
        PlatformLibraryItem(
            platform_account_id=account.id,
            provider_game_id="1145360",
            game_id=catalog[0].id,
            match_source=LibraryMatchSource.EXTERNAL_ID,
            playtime_minutes=2832,
        )
    )
    await db.flush()

    await db.delete(account)
    await db.flush()

    remaining = (await db.execute(sa.select(sa.func.count(PlatformLibraryItem.id)))).scalar_one()
    assert remaining == 0


async def test_a_library_row_survives_the_game_leaving_the_catalog(
    db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    """A catalog re-import must not silently delete somebody's playtime.

    The match is dropped, not the row: the appid and the hours are still true,
    and the next sync can resolve them again.
    """
    account = await _link(db, await make_user("ada"), "76561197960287930")
    game = catalog[0]
    db.add(
        PlatformLibraryItem(
            platform_account_id=account.id,
            provider_game_id="1145360",
            game_id=game.id,
            match_source=LibraryMatchSource.EXTERNAL_ID,
            playtime_minutes=2832,
        )
    )
    await db.flush()

    await db.execute(sa.delete(Game).where(Game.id == game.id))
    await db.flush()
    db.expire_all()

    item = (await db.execute(sa.select(PlatformLibraryItem))).scalar_one()
    assert item.game_id is None
    assert item.playtime_minutes == 2832


async def test_dropping_the_catalog_does_not_deadlock_on_a_linked_library(
    db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    """The weekly catalog sync can wipe and rebuild `games`; a link must not block it.

    Worth its own test because the obvious symmetric spelling of the
    `match_source` check makes this fail: `ON DELETE SET NULL` nulls the id,
    leaves the source, and the delete trips the constraint. The failure would
    only appear once somebody had linked an account — well after the migration
    that caused it had shipped.
    """
    account = await _link(db, await make_user("ada"), "76561197960287930")
    for game in catalog[:3]:
        db.add(
            PlatformLibraryItem(
                platform_account_id=account.id,
                provider_game_id=str(game.id.int % 1_000_000),
                game_id=game.id,
                match_source=LibraryMatchSource.EXTERNAL_ID,
                playtime_minutes=120,
            )
        )
    await db.flush()

    await delete_all_games(db)

    kept = (await db.execute(sa.select(sa.func.count(PlatformLibraryItem.id)))).scalar_one()
    assert kept == 3


async def test_a_match_without_a_source_is_rejected(
    db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    """`match_source` explains `game_id`; a row with one and not the other is a bug.

    The badge reads `match_source` to decide whether a match is exact enough to
    show as verified, so a resolved row that never said how it resolved would
    have to be either trusted blindly or silently ignored.
    """
    account = await _link(db, await make_user("ada"), "76561197960287930")
    db.add(
        PlatformLibraryItem(
            platform_account_id=account.id,
            provider_game_id="1145360",
            game_id=catalog[0].id,
            match_source=None,
        )
    )

    with pytest.raises(IntegrityError):
        await db.flush()


async def test_the_same_appid_cannot_be_synced_twice_into_one_library(
    db: AsyncSession, make_user: MakeUser
) -> None:
    """The upsert key: a re-sync updates a row rather than stacking a second one."""
    account = await _link(db, await make_user("ada"), "76561197960287930")
    db.add(PlatformLibraryItem(platform_account_id=account.id, provider_game_id="1145360"))
    await db.flush()

    db.add(PlatformLibraryItem(platform_account_id=account.id, provider_game_id="1145360"))
    with pytest.raises(IntegrityError):
        await db.flush()


async def test_two_members_can_own_the_same_game(
    db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    """The uniqueness is per library, not per game — the obvious way to get it wrong."""
    first = await _link(db, await make_user("ada"), "76561197960287930")
    second = await _link(db, await make_user("grace"), "76561197960287931")

    for account in (first, second):
        db.add(
            PlatformLibraryItem(
                platform_account_id=account.id,
                provider_game_id="1145360",
                game_id=catalog[0].id,
                match_source=LibraryMatchSource.EXTERNAL_ID,
            )
        )
    await db.flush()

    stored = (await db.execute(sa.select(sa.func.count(PlatformLibraryItem.id)))).scalar_one()
    assert stored == 2


async def test_negative_playtime_is_rejected(db: AsyncSession, make_user: MakeUser) -> None:
    account = await _link(db, await make_user("ada"), "76561197960287930")
    db.add(
        PlatformLibraryItem(
            platform_account_id=account.id,
            provider_game_id="1145360",
            playtime_minutes=-1,
        )
    )

    with pytest.raises(IntegrityError):
        await db.flush()
