"""Recompute the trending ranking (SPEC §6.11).

    uv run python -m app.cli.trending            # the default 7d window
    uv run python -m app.cli.trending --window 24h

SPEC §6.11 wants this on a schedule. Until the worker/queue exists it is a CLI
command, which is also how it gets tested.
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
    parser.add_argument(
        "--window",
        choices=[window.value for window in TrendingWindow],
        default=DEFAULT_TRENDING_WINDOW.value,
        help=f"Rolling window to aggregate over. Default {DEFAULT_TRENDING_WINDOW}.",
    )
    return parser.parse_args(argv)


async def _run(window: TrendingWindow) -> int:
    async with SessionLocal() as session:
        written = await recompute_trending_scores(session, window=window)
    await engine.dispose()

    print(f"trending[{window}]: scored {written} game(s)")
    if written == 0:
        print("No activity in the window yet — reviews, backlog adds and likes feed this ranking.")
    return 0


def main(argv: list[str]) -> int:
    return asyncio.run(_run(TrendingWindow(_parse_args(argv).window)))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
