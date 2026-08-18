"""Pulling a Steam library and resolving it to catalog games.

Runs entirely off canned payloads — the same rule the catalog import follows with
`seed_games.json`, so CI needs no Steam key and no network.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.cli import sync_libraries as sync_cli
from app.core.config import settings
from app.models.connections import PlatformAccount, PlatformLibraryItem
from app.models.enums import ConnectionProvider, LibraryMatchSource, PlatformSyncStatus
from app.models.game import EXTERNAL_ID_SOURCE_STEAM, Game, GameExternalId
from app.models.user import User
from app.services import steam as steam_service
from app.services.library_sync import sync_account
from app.services.steam import SteamProfilePrivateError

MakeUser = Callable[..., Awaitable[User]]

STEAM_ID = "76561197960287930"


@pytest.fixture(autouse=True)
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "steam_api_key", "steam-test-key")


@pytest.fixture
def steam_api(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Canned Steam Web API responses.

    `owned` is the raw `response` object, so a test can hand over the exact shape
    Steam sends — including the empty one that means "this profile is private",
    which is the whole reason this is faked at the HTTP layer rather than above it.
    """
    control: dict[str, Any] = {
        "owned": {"game_count": 0, "games": []},
        "summary": {
            "steamid": STEAM_ID,
            "personaname": "ada",
            "avatarfull": "https://avatars.steamstatic.com/ada_full.jpg",
            "profileurl": "https://steamcommunity.com/id/ada/",
            "communityvisibilitystate": 3,
        },
    }

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def get(self, url: str, params: dict[str, Any]) -> httpx.Response:
            if "GetOwnedGames" in url:
                body = {"response": control["owned"]}
            else:
                summary = control["summary"]
                body = {"response": {"players": [summary] if summary else []}}
            return httpx.Response(200, json=body, request=httpx.Request("GET", url))

    monkeypatch.setattr(steam_service, "_new_client", lambda: _Client())
    return control


@pytest.fixture
async def account(db: AsyncSession, make_user: MakeUser) -> PlatformAccount:
    linked = PlatformAccount(
        user_id=(await make_user("ada")).id,
        provider=ConnectionProvider.STEAM,
        provider_account_id=STEAM_ID,
    )
    db.add(linked)
    await db.flush()
    return linked


def _owned(*games: dict[str, Any]) -> dict[str, Any]:
    return {"game_count": len(games), "games": list(games)}


async def _items(db: AsyncSession) -> list[PlatformLibraryItem]:
    rows = await db.execute(
        sa.select(PlatformLibraryItem).order_by(PlatformLibraryItem.provider_game_id)
    )
    return list(rows.scalars().all())


async def _map_appid(db: AsyncSession, appid: str, game: Game) -> None:
    db.add(GameExternalId(source=EXTERNAL_ID_SOURCE_STEAM, uid=appid, game_id=game.id))
    await db.flush()


# An appid Steam will never issue, mapped by hand to whichever catalog row a test
# picks. Deliberately not a real one: the seed fixture carries genuine appids now,
# and `(source, uid)` is the primary key, so a test that borrowed a real value
# would collide with the mapping the catalog import already wrote for it. What is
# under test here is the resolution mechanism, which does not care what the
# number is.
UNISSUED_APPID = "99000001"


# --- Reading the library ----------------------------------------------------


async def test_a_library_is_stored_with_its_playtime(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any], catalog: list[Game]
) -> None:
    await _map_appid(db, UNISSUED_APPID, catalog[0])
    steam_api["owned"] = _owned(
        {
            "appid": int(UNISSUED_APPID),
            "name": catalog[0].title,
            "playtime_forever": 2832,
            "rtime_last_played": 1723000000,
        }
    )

    result = await sync_account(db, account.id)

    assert result.status is PlatformSyncStatus.OK
    item = (await _items(db))[0]
    # Steam reports minutes and reviews store minutes, so this must pass through
    # untouched — a unit conversion here would silently misreport every badge.
    assert item.playtime_minutes == 2832
    assert item.game_id == catalog[0].id
    assert item.match_source is LibraryMatchSource.EXTERNAL_ID
    assert item.last_played_at == datetime.fromtimestamp(1723000000, tz=UTC)


async def test_a_store_id_match_beats_the_title(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any], catalog: list[Game]
) -> None:
    """Steam's name for a game is often not the catalog's — the id is what is exact."""
    await _map_appid(db, UNISSUED_APPID, catalog[0])
    steam_api["owned"] = _owned(
        {
            "appid": int(UNISSUED_APPID),
            "name": "Some Edition Nobody Calls It",
            "playtime_forever": 10,
        }
    )

    await sync_account(db, account.id)

    item = (await _items(db))[0]
    assert item.game_id == catalog[0].id
    assert item.match_source is LibraryMatchSource.EXTERNAL_ID


async def test_an_unmapped_game_falls_back_to_its_title(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any], catalog: list[Game]
) -> None:
    """Listed, but labelled as a guess so the badge will not use it."""
    steam_api["owned"] = _owned({"appid": 99999, "name": catalog[0].title, "playtime_forever": 500})

    await sync_account(db, account.id)

    item = (await _items(db))[0]
    assert item.game_id == catalog[0].id
    assert item.match_source is LibraryMatchSource.TITLE


async def test_a_game_the_catalog_does_not_have_is_kept_unmatched(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any]
) -> None:
    """Tools, soundtracks and unimported games. The hours are still true."""
    steam_api["owned"] = _owned(
        {"appid": 323910, "name": "Some Utility Nobody Reviews", "playtime_forever": 42}
    )

    result = await sync_account(db, account.id)

    item = (await _items(db))[0]
    assert item.game_id is None
    assert item.match_source is None
    assert item.playtime_minutes == 42
    assert result.items_seen == 1
    assert result.matched == 0


async def test_a_resync_updates_playtime_in_place(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any], catalog: list[Game]
) -> None:
    await _map_appid(db, UNISSUED_APPID, catalog[0])
    steam_api["owned"] = _owned(
        {"appid": int(UNISSUED_APPID), "name": catalog[0].title, "playtime_forever": 100}
    )
    await sync_account(db, account.id)

    steam_api["owned"] = _owned(
        {"appid": int(UNISSUED_APPID), "name": catalog[0].title, "playtime_forever": 260}
    )
    await sync_account(db, account.id)

    items = await _items(db)
    assert len(items) == 1
    assert items[0].playtime_minutes == 260


async def test_a_game_that_left_the_library_is_removed(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any]
) -> None:
    """Refunds and revoked family sharing. A badge must not outlive the ownership."""
    steam_api["owned"] = _owned(
        {"appid": 1, "name": "Kept", "playtime_forever": 10},
        {"appid": 2, "name": "Refunded", "playtime_forever": 20},
    )
    await sync_account(db, account.id)

    steam_api["owned"] = _owned({"appid": 1, "name": "Kept", "playtime_forever": 10})
    result = await sync_account(db, account.id)

    assert [item.provider_game_id for item in await _items(db)] == ["1"]
    assert result.items_removed == 1


async def test_a_game_imported_later_starts_matching(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any], catalog: list[Game]
) -> None:
    """The mapping is reassigned every sync, not only when it is absent.

    Otherwise a library synced before the catalog knew a game would stay
    unmatched forever, and the member would have to unlink to fix it.
    """
    steam_api["owned"] = _owned(
        {
            "appid": int(UNISSUED_APPID),
            "name": "Nothing Like The Catalog Title",
            "playtime_forever": 90,
        }
    )
    await sync_account(db, account.id)
    assert (await _items(db))[0].game_id is None

    await _map_appid(db, UNISSUED_APPID, catalog[0])
    await sync_account(db, account.id)

    assert (await _items(db))[0].game_id == catalog[0].id


async def test_the_persona_name_is_refreshed_by_the_sync(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any]
) -> None:
    steam_api["summary"] = {**steam_api["summary"], "personaname": "ada-renamed"}

    await sync_account(db, account.id)

    await db.refresh(account)
    assert account.provider_username == "ada-renamed"


# --- The private-profile wall -----------------------------------------------


async def test_a_private_game_list_is_reported_as_such(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any]
) -> None:
    """Steam answers a hidden library with a 200 and an empty `response` object.

    Nothing distinguishes it from an empty library except the missing `games`
    key, and the two need opposite messages: one is "you own nothing yet", the
    other is "change this setting on Steam". Getting this wrong strands every
    affected member on a screen that says their library is empty.
    """
    steam_api["owned"] = {}

    result = await sync_account(db, account.id)

    assert result.status is PlatformSyncStatus.PROFILE_PRIVATE
    await db.refresh(account)
    assert account.last_sync_status is PlatformSyncStatus.PROFILE_PRIVATE
    # Still stamped, so the cooldown applies and a broken link cannot be retried
    # in a tight loop.
    assert account.last_synced_at is not None


async def test_a_genuinely_empty_library_is_not_mistaken_for_a_private_one(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any]
) -> None:
    """The other half of the distinction above, and the reason it is a live risk."""
    steam_api["owned"] = {"game_count": 0}

    result = await sync_account(db, account.id)

    assert result.status is PlatformSyncStatus.OK
    assert await _items(db) == []


async def test_the_private_marker_clears_once_it_is_fixed(
    db: AsyncSession, account: PlatformAccount, steam_api: dict[str, Any]
) -> None:
    steam_api["owned"] = {}
    await sync_account(db, account.id)

    steam_api["owned"] = _owned({"appid": 1, "name": "Now Visible", "playtime_forever": 5})
    result = await sync_account(db, account.id)

    assert result.status is PlatformSyncStatus.OK
    await db.refresh(account)
    assert account.last_sync_status is PlatformSyncStatus.OK


async def test_a_steam_outage_is_recorded_rather_than_raised(
    db: AsyncSession, account: PlatformAccount, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The caller is a background task; there is nothing useful to raise into."""

    async def _boom(steam_id: str) -> None:
        raise httpx.ConnectError("steam is down")

    monkeypatch.setattr(steam_service, "fetch_profile", _boom)

    result = await sync_account(db, account.id)

    assert result.status is PlatformSyncStatus.FAILED
    await db.refresh(account)
    assert account.last_sync_status is PlatformSyncStatus.FAILED


async def test_syncing_an_account_that_was_unlinked_is_not_an_error(
    db: AsyncSession, steam_api: dict[str, Any]
) -> None:
    """The member unlinked between the endpoint scheduling this and it running."""
    result = await sync_account(db, uuid.uuid4())

    assert result.status is PlatformSyncStatus.FAILED


# --- Reading the payload ----------------------------------------------------


async def test_owned_games_are_normalised_off_the_payload(
    steam_api: dict[str, Any],
) -> None:
    steam_api["owned"] = _owned(
        {"appid": 440, "name": "Team Fortress 2", "playtime_forever": 12, "rtime_last_played": 0}
    )

    owned = await steam_service.fetch_owned_games(STEAM_ID)

    assert owned[0].appid == "440"
    assert owned[0].title == "Team Fortress 2"
    # rtime_last_played is 0 for a game that has never been launched, which is
    # not the same as "played at the epoch".
    assert owned[0].last_played_at is None


async def test_a_hidden_library_raises_rather_than_returning_nothing(
    steam_api: dict[str, Any],
) -> None:
    steam_api["owned"] = {}

    with pytest.raises(SteamProfilePrivateError):
        await steam_service.fetch_owned_games(STEAM_ID)


# --- The CLI ----------------------------------------------------------------


def test_the_cli_rejects_a_meaningless_limit(capsys: pytest.CaptureFixture[str]) -> None:
    assert sync_cli.main(["--limit", "0"]) == 2

    assert "at least 1" in capsys.readouterr().err


def test_the_cli_says_so_when_steam_is_not_configured(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(settings, "steam_api_key", None)

    assert sync_cli.main([]) == 1

    assert "STEAM_API_KEY" in capsys.readouterr().err
