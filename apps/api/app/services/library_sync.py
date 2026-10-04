"""Turning a Steam library into rows this app can read.

Two jobs, and the second is the interesting one:

1. Pull the library and upsert it, so a re-sync updates rows rather than stacking
   duplicates and a game sold or delisted stops being listed.
2. Resolve each Steam appid to a catalog game — exactly where possible, and
   honestly labelled where not.

The resolution rule is the whole basis of the verified playtime badge.
`game_external_ids` carries the appid IGDB publishes for each game, so that path
is an equality join and cannot be wrong. Everything else falls back to a trigram
title match, which is right most of the time and is therefore recorded as
`TITLE` and never allowed to back a verified claim. "Usually correct" is fine for
filling in a showcase and unacceptable for a number displayed next to somebody's
name as evidence.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connections import PlatformAccount, PlatformLibraryItem
from app.models.enums import LibraryMatchSource, PlatformSyncStatus
from app.models.game import EXTERNAL_ID_SOURCE_STEAM, Game, GameExternalId
from app.services import steam as steam_service
from app.services.steam import OwnedGame, SteamProfilePrivateError

logger = logging.getLogger(__name__)

# How close a title has to be before it is worth listing at all. Trigram
# similarity, so 1.0 is identical. Set high because the cost of a wrong match
# here is a stranger's game appearing on somebody's profile, and the cost of a
# missed one is a row that simply does not show — the asymmetry is the point.
TITLE_MATCH_THRESHOLD = 0.8


@dataclass(frozen=True, slots=True)
class SyncResult:
    status: PlatformSyncStatus
    items_seen: int = 0
    items_removed: int = 0
    matched_by_external_id: int = 0
    matched_by_title: int = 0

    @property
    def matched(self) -> int:
        return self.matched_by_external_id + self.matched_by_title

    def summary_line(self) -> str:
        return (
            f"{self.status}: {self.items_seen} game(s), {self.matched} matched "
            f"({self.matched_by_external_id} by store id, {self.matched_by_title} by title), "
            f"{self.items_removed} removed"
        )


async def _resolve_by_external_id(db: AsyncSession, appids: list[str]) -> dict[str, uuid.UUID]:
    """appid -> game id, for every appid the catalog publishes. One query."""
    if not appids:
        return {}
    rows = await db.execute(
        sa.select(GameExternalId.uid, GameExternalId.game_id).where(
            GameExternalId.source == EXTERNAL_ID_SOURCE_STEAM,
            GameExternalId.uid.in_(appids),
        )
    )
    return dict(rows.all())  # type: ignore[arg-type]


async def _resolve_by_title(db: AsyncSession, titles: dict[str, str]) -> dict[str, uuid.UUID]:
    """appid -> game id for the leftovers, by trigram similarity on the title.

    One statement for the whole batch rather than a query per unmatched game: a
    real library leaves hundreds unresolved, and this runs inside a request's
    background task. `DISTINCT ON` keeps the best candidate per appid.

    No index serves this: a `similarity() >= threshold` join is a scan of the
    catalog per batch whether or not a trigram index exists (only the `%`
    operator can use one). It runs in the background, so that is tolerable at
    today's sizes; see `.context/product/roadmap.md`.
    """
    if not titles:
        return {}

    wanted = sa.values(
        sa.column("appid", sa.Text),
        sa.column("title", sa.Text),
        name="wanted",
    ).data(list(titles.items()))

    statement = (
        sa.select(wanted.c.appid, Game.id)
        .distinct(wanted.c.appid)
        .select_from(wanted)
        .join(Game, sa.func.similarity(Game.title, wanted.c.title) >= TITLE_MATCH_THRESHOLD)
        .order_by(wanted.c.appid, sa.func.similarity(Game.title, wanted.c.title).desc(), Game.id)
    )
    rows = await db.execute(statement)
    return dict(rows.all())  # type: ignore[arg-type]


async def _resolve(
    db: AsyncSession, owned: list[OwnedGame]
) -> dict[str, tuple[uuid.UUID, LibraryMatchSource]]:
    exact = await _resolve_by_external_id(db, [game.appid for game in owned])

    remaining = {
        game.appid: game.title
        for game in owned
        if game.appid not in exact and game.title and game.title.strip()
    }
    fuzzy = await _resolve_by_title(db, remaining)

    resolved: dict[str, tuple[uuid.UUID, LibraryMatchSource]] = {
        appid: (game_id, LibraryMatchSource.EXTERNAL_ID) for appid, game_id in exact.items()
    }
    for appid, game_id in fuzzy.items():
        resolved[appid] = (game_id, LibraryMatchSource.TITLE)
    return resolved


async def sync_account(db: AsyncSession, account_id: uuid.UUID) -> SyncResult:
    """Refresh one linked account's library. Records its own outcome.

    Every exit path writes `last_synced_at` — including the failures. It is both
    the "when did this last run" the settings screen shows and the cooldown clock
    for the manual button, and a failure that left the clock untouched would let
    a broken link be retried in a tight loop.
    """
    account = await db.get(PlatformAccount, account_id)
    if account is None:
        # The member unlinked between scheduling and running.
        return SyncResult(status=PlatformSyncStatus.FAILED)

    now = datetime.now(UTC)
    try:
        profile = await steam_service.fetch_profile(account.provider_account_id)
        owned = await steam_service.fetch_owned_games(account.provider_account_id)
    except SteamProfilePrivateError:
        account.last_synced_at = now
        account.last_sync_status = PlatformSyncStatus.PROFILE_PRIVATE
        await db.commit()
        return SyncResult(status=PlatformSyncStatus.PROFILE_PRIVATE)
    except Exception:
        logger.exception("Steam sync failed for account %s", account_id)
        account.last_synced_at = now
        account.last_sync_status = PlatformSyncStatus.FAILED
        await db.commit()
        return SyncResult(status=PlatformSyncStatus.FAILED)

    if profile is not None:
        # Free refresh of the mirrored display fields — a persona name changes
        # far more often than a library does.
        account.provider_username = profile.persona_name
        account.provider_avatar_url = profile.avatar_url
        account.profile_url = profile.profile_url

    resolved = await _resolve(db, owned)

    existing = {
        item.provider_game_id: item
        for item in (
            await db.execute(
                sa.select(PlatformLibraryItem).where(
                    PlatformLibraryItem.platform_account_id == account_id
                )
            )
        )
        .scalars()
        .all()
    }

    matched_by_external_id = 0
    matched_by_title = 0
    for game in owned:
        match = resolved.get(game.appid)
        if match is not None:
            if match[1] is LibraryMatchSource.EXTERNAL_ID:
                matched_by_external_id += 1
            else:
                matched_by_title += 1

        item = existing.get(game.appid)
        if item is None:
            item = PlatformLibraryItem(
                platform_account_id=account_id,
                provider_game_id=game.appid,
                first_synced_at=now,
            )
            db.add(item)

        item.provider_title = game.title
        item.playtime_minutes = game.playtime_minutes
        item.last_played_at = game.last_played_at
        item.last_synced_at = now
        # Reassigned on every sync, not only when absent: a game the catalog
        # imported since the last run has to be able to start matching, and one
        # whose mapping moved has to be able to follow it.
        item.game_id = match[0] if match else None
        item.match_source = match[1] if match else None

    seen = {game.appid for game in owned}
    removed = [item for appid, item in existing.items() if appid not in seen]
    for item in removed:
        # Refunded, revoked, or a family-sharing library that went away. Keeping
        # it would leave a verified badge on a game the member no longer owns.
        await db.delete(item)

    account.last_synced_at = now
    account.last_sync_status = PlatformSyncStatus.OK
    await db.commit()

    return SyncResult(
        status=PlatformSyncStatus.OK,
        items_seen=len(owned),
        items_removed=len(removed),
        matched_by_external_id=matched_by_external_id,
        matched_by_title=matched_by_title,
    )


async def sync_all_accounts(db: AsyncSession, *, limit: int | None = None) -> list[SyncResult]:
    """Every linked account, oldest sync first. What the CLI drives.

    Sequential on purpose: Steam's Web API is rate limited per key, and this runs
    unattended where finishing slowly is strictly better than being throttled.
    """
    statement = sa.select(PlatformAccount.id).order_by(
        PlatformAccount.last_synced_at.asc().nullsfirst()
    )
    if limit is not None:
        statement = statement.limit(limit)
    account_ids = list((await db.execute(statement)).scalars().all())

    return [await sync_account(db, account_id) for account_id in account_ids]
