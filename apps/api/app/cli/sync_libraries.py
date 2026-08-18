"""Re-sync linked platform libraries.

    uv run python -m app.cli.sync_libraries              # every linked account
    uv run python -m app.cli.sync_libraries --limit 50   # the 50 stalest

Accounts are walked oldest-sync-first, so a run that is cut short still makes
progress on the ones that need it most and the next run picks up where it left
off.

`.github/workflows/library-sync.yml` runs this daily at 09:00 UTC — after the
Sunday catalog sync, which is what teaches `game_external_ids` about new appids.
On-connect and the manual button are still the fast paths; this is what stops a
playtime figure from freezing at the moment somebody linked.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.db.session import SessionLocal, engine
from app.models.enums import PlatformSyncStatus
from app.services.library_sync import sync_all_accounts
from app.services.steam import steam_is_configured


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="sync-libraries", description=__doc__)
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Sync at most this many accounts, stalest first. Default: all of them.",
    )
    return parser.parse_args(argv)


def _reject_bad_combinations(args: argparse.Namespace) -> str | None:
    if args.limit is not None and args.limit < 1:
        return "--limit must be at least 1."
    return None


async def _run(limit: int | None) -> int:
    if not steam_is_configured():
        print("STEAM_API_KEY is not set — there is nothing this can sync.", file=sys.stderr)
        return 1

    async with SessionLocal() as session:
        results = await sync_all_accounts(session, limit=limit)
    await engine.dispose()

    if not results:
        print("No linked accounts to sync.")
        return 0

    tally = dict.fromkeys(PlatformSyncStatus, 0)
    for result in results:
        tally[result.status] += 1
    print(
        f"Synced {len(results)} account(s): "
        + ", ".join(f"{count} {status.lower()}" for status, count in tally.items() if count)
    )

    # Not an error exit: a private profile is the member's setting to change, and
    # a scheduled run that goes red every night for it would train whoever reads
    # the job output to ignore it.
    if tally[PlatformSyncStatus.PROFILE_PRIVATE]:
        print(
            f"{tally[PlatformSyncStatus.PROFILE_PRIVATE]} account(s) have their Steam game "
            "details set to private and cannot be read."
        )
    return 1 if tally[PlatformSyncStatus.FAILED] else 0


def main(argv: list[str]) -> int:
    args = _parse_args(argv)
    problem = _reject_bad_combinations(args)
    if problem is not None:
        print(problem, file=sys.stderr)
        return 2
    return asyncio.run(_run(args.limit))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
