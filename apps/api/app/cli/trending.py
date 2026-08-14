"""Recompute the trending ranking (SPEC §6.11).

    uv run python -m app.cli.trending                 # the default 7d window
    uv run python -m app.cli.trending --window 24h
    uv run python -m app.cli.trending --all-windows   # every window, one pass

`.github/workflows/trending.yml` runs the `--all-windows` form daily against a
throwaway Fly machine. This stays a CLI command as well, because that is how it
gets tested and how you refill the table by hand.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.db.session import SessionLocal, engine
from app.schemas.game import TrendingWindow
from app.services.trending import DEFAULT_TRENDING_WINDOW, recompute_trending_scores


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="trending", description=__doc__)
    # Mutually exclusive: --all-windows *is* the window choice, so accepting both
    # would leave one of them silently ignored.
    windows = parser.add_mutually_exclusive_group()
    windows.add_argument(
        "--window",
        choices=[window.value for window in TrendingWindow],
        default=DEFAULT_TRENDING_WINDOW.value,
        help=f"Rolling window to aggregate over. Default {DEFAULT_TRENDING_WINDOW}.",
    )
    windows.add_argument(
        "--all-windows",
        action="store_true",
        help="Recompute every window in one run. What the scheduled job uses.",
    )
    return parser.parse_args(argv)


def _windows(args: argparse.Namespace) -> list[TrendingWindow]:
    """Which windows a parsed invocation asks for, in declaration order."""
    if args.all_windows:
        return list(TrendingWindow)
    return [TrendingWindow(args.window)]


async def _run(windows: list[TrendingWindow]) -> int:
    # One session for the whole run: each recompute commits itself, so the
    # windows do not share a transaction and a later failure keeps the earlier
    # windows' results.
    written: dict[TrendingWindow, int] = {}
    async with SessionLocal() as session:
        for window in windows:
            written[window] = await recompute_trending_scores(session, window=window)
    await engine.dispose()

    for window, count in written.items():
        print(f"trending[{window}]: scored {count} game(s)")
    # Only when nothing scored anywhere. A quiet 24h window alongside a busy 30d
    # one is normal, and warning about it would make a healthy run look broken.
    if not any(written.values()):
        print("No activity in the window yet — reviews, backlog adds and likes feed this ranking.")
    return 0


def main(argv: list[str]) -> int:
    return asyncio.run(_run(_windows(_parse_args(argv))))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
