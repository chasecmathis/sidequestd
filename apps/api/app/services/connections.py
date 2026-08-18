"""Linking, unlinking and reading a member's platform accounts.

The provider-agnostic half of the feature. Everything that knows Steam's wire
format lives in `app.services.steam`; this module knows only that a member has at
most one link per provider, that a provider account belongs to at most one
member, and who is allowed to see it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.connections import PlatformAccount, PlatformLibraryItem
from app.models.enums import ConnectionProvider, LibraryMatchSource
from app.models.game import Game
from app.services.exceptions import (
    PlatformAccountNotLinkedError,
    PlatformAccountTakenError,
    SyncTooSoonError,
)
from app.services.steam import SteamProfile

# How many games the profile showcase puts on display. Enough to read as a
# library rather than a list, few enough to stay a showcase.
SHOWCASE_GAME_LIMIT = 6


async def get_account(
    db: AsyncSession, user_id: uuid.UUID, provider: ConnectionProvider
) -> PlatformAccount | None:
    return (
        await db.execute(
            sa.select(PlatformAccount).where(
                PlatformAccount.user_id == user_id,
                PlatformAccount.provider == provider,
            )
        )
    ).scalar_one_or_none()


async def require_account(
    db: AsyncSession, user_id: uuid.UUID, provider: ConnectionProvider
) -> PlatformAccount:
    account = await get_account(db, user_id, provider)
    if account is None:
        raise PlatformAccountNotLinkedError
    return account


async def link_steam_account(
    db: AsyncSession, user_id: uuid.UUID, profile: SteamProfile
) -> PlatformAccount:
    """Create or refresh this member's Steam link.

    Re-linking the same account is deliberately not an error: it is how somebody
    repairs a link, and it refreshes the mirrored persona name and avatar. Linking
    a *different* Steam account replaces the old one, taking its library with it —
    the alternative, silently keeping a library the member is no longer claiming,
    would leave verified badges standing on a link that no longer exists.
    """
    # Checked up front rather than by catching the unique violation: rolling a
    # session back to recover from a constraint failure would discard whatever
    # else the caller had pending. `uq_platform_accounts_provider_account` is
    # still what guarantees this under a race — this is the path that produces a
    # decent error the other 99.9% of the time.
    claimed_by = (
        await db.execute(
            sa.select(PlatformAccount.user_id).where(
                PlatformAccount.provider == ConnectionProvider.STEAM,
                PlatformAccount.provider_account_id == profile.steam_id,
            )
        )
    ).scalar_one_or_none()
    if claimed_by is not None and claimed_by != user_id:
        raise PlatformAccountTakenError

    account = await get_account(db, user_id, ConnectionProvider.STEAM)

    if account is None:
        account = PlatformAccount(
            user_id=user_id,
            provider=ConnectionProvider.STEAM,
            provider_account_id=profile.steam_id,
        )
        db.add(account)
    elif account.provider_account_id != profile.steam_id:
        await db.execute(
            sa.delete(PlatformLibraryItem).where(
                PlatformLibraryItem.platform_account_id == account.id
            )
        )
        account.provider_account_id = profile.steam_id
        account.last_synced_at = None
        account.last_sync_status = None

    account.provider_username = profile.persona_name
    account.provider_avatar_url = profile.avatar_url
    account.profile_url = profile.profile_url

    await db.flush()
    return account


async def unlink_account(
    db: AsyncSession, user_id: uuid.UUID, provider: ConnectionProvider
) -> None:
    """Drop the link. The synced library goes with it, by cascade."""
    account = await require_account(db, user_id, provider)
    await db.delete(account)
    await db.commit()


async def set_visibility(
    db: AsyncSession, user_id: uuid.UUID, provider: ConnectionProvider, *, is_visible: bool
) -> PlatformAccount:
    """Show or hide the link on the member's profile.

    Hiding also withdraws the verified badge from their reviews, because the badge
    reads this flag rather than being copied onto each review when it is written.
    """
    account = await require_account(db, user_id, provider)
    account.is_visible = is_visible
    await db.commit()
    return account


def sync_cooldown_remaining(account: PlatformAccount, *, now: datetime | None = None) -> int:
    """Whole minutes left before a manual re-sync is allowed. 0 when it is."""
    if account.last_synced_at is None:
        return 0
    ready_at = account.last_synced_at + timedelta(minutes=settings.steam_sync_cooldown_minutes)
    remaining = (ready_at - (now or datetime.now(UTC))).total_seconds()
    return max(0, -(-int(remaining) // 60))


def require_sync_allowed(account: PlatformAccount, *, now: datetime | None = None) -> None:
    remaining = sync_cooldown_remaining(account, now=now)
    if remaining:
        raise SyncTooSoonError(remaining)


@dataclass(frozen=True, slots=True)
class LibraryStats:
    """What the profile showcase puts above the games."""

    total_games: int
    matched_games: int
    total_playtime_minutes: int


async def get_library_stats(db: AsyncSession, account_id: uuid.UUID) -> LibraryStats:
    row = (
        await db.execute(
            sa.select(
                sa.func.count(PlatformLibraryItem.id),
                sa.func.count(PlatformLibraryItem.game_id),
                sa.func.coalesce(sa.func.sum(PlatformLibraryItem.playtime_minutes), 0),
            ).where(PlatformLibraryItem.platform_account_id == account_id)
        )
    ).one()
    return LibraryStats(
        total_games=row[0], matched_games=row[1], total_playtime_minutes=int(row[2])
    )


async def get_most_played(
    db: AsyncSession, account_id: uuid.UUID, *, limit: int = SHOWCASE_GAME_LIMIT
) -> list[tuple[PlatformLibraryItem, Game]]:
    """The longest-played games in a library that the catalog actually knows.

    Unmatched rows are excluded rather than listed by their Steam title: the
    showcase renders game cards, and a row with no catalog entry has no cover, no
    link and nothing to click.
    """
    rows = await db.execute(
        sa.select(PlatformLibraryItem, Game)
        .join(Game, PlatformLibraryItem.game_id == Game.id)
        .where(
            PlatformLibraryItem.platform_account_id == account_id,
            PlatformLibraryItem.playtime_minutes > 0,
        )
        # `GameSummary` renders the platform chips, and this is the only surface
        # that reaches a game without going through `reviews.select_reviews`,
        # which already carries the same loader.
        .options(selectinload(Game.platforms))
        .order_by(PlatformLibraryItem.playtime_minutes.desc())
        .limit(limit)
    )
    return [(item, game) for item, game in rows.all()]


@dataclass(frozen=True, slots=True)
class VerifiedPlaytimeRecord:
    """Platform-attested playtime, with the platform that attested it.

    Carries the provider rather than leaving callers to assume Steam: it is the
    one field that will be wrong for free the day a second platform is added, and
    wrong in a way that shows a member the wrong logo rather than failing.
    """

    provider: ConnectionProvider
    playtime_minutes: int
    last_played_at: datetime | None


async def get_verified_playtime(
    db: AsyncSession, user_id: uuid.UUID, game_id: uuid.UUID
) -> PlatformLibraryItem | None:
    """One member's platform-attested playtime for one game, if it exists.

    `EXTERNAL_ID` only. A trigram title match is good enough to list a game on a
    showcase and not good enough to put a number beside somebody's name and call
    it verified.
    """
    return (
        await db.execute(
            sa.select(PlatformLibraryItem)
            .join(PlatformAccount, PlatformLibraryItem.platform_account_id == PlatformAccount.id)
            .where(
                PlatformAccount.user_id == user_id,
                PlatformAccount.is_visible.is_(True),
                PlatformLibraryItem.game_id == game_id,
                PlatformLibraryItem.match_source == LibraryMatchSource.EXTERNAL_ID,
                PlatformLibraryItem.playtime_minutes > 0,
            )
            .order_by(PlatformLibraryItem.playtime_minutes.desc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def get_verified_playtime_for_reviews(
    db: AsyncSession, pairs: list[tuple[uuid.UUID, uuid.UUID]]
) -> dict[tuple[uuid.UUID, uuid.UUID], VerifiedPlaytimeRecord]:
    """The same lookup for a whole page of reviews, in one query.

    The feed hydrates dozens of reviews at once, and doing this per row is how a
    badge turns into an N+1. Keyed by (user_id, game_id) so the caller can attach
    each result without a second pass.
    """
    if not pairs:
        return {}

    wanted = sa.tuple_(PlatformAccount.user_id, PlatformLibraryItem.game_id).in_(pairs)
    rows = await db.execute(
        sa.select(
            PlatformAccount.user_id,
            PlatformAccount.provider,
            PlatformLibraryItem.game_id,
            PlatformLibraryItem.playtime_minutes,
            PlatformLibraryItem.last_played_at,
        )
        .join(PlatformAccount, PlatformLibraryItem.platform_account_id == PlatformAccount.id)
        .where(
            wanted,
            PlatformAccount.is_visible.is_(True),
            PlatformLibraryItem.match_source == LibraryMatchSource.EXTERNAL_ID,
            PlatformLibraryItem.playtime_minutes > 0,
        )
    )

    found: dict[tuple[uuid.UUID, uuid.UUID], VerifiedPlaytimeRecord] = {}
    for user_id, provider, game_id, playtime_minutes, last_played_at in rows.all():
        key = (user_id, game_id)
        # A member could hold the same game under two providers once there is
        # more than one; the longest-played wins, as above.
        current = found.get(key)
        if current is None or playtime_minutes > current.playtime_minutes:
            found[key] = VerifiedPlaytimeRecord(
                provider=provider,
                playtime_minutes=playtime_minutes,
                last_played_at=last_played_at,
            )
    return found
