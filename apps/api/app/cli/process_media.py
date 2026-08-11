"""Process review media waiting in the queue (SPEC §6.3).

    uv run python -m app.cli.process_media           # one pass
    uv run python -m app.cli.process_media --watch   # keep going

Uploads schedule their own processing on FastAPI's background tasks, so in normal
running there is nothing here to do. This is the catch-up: a restart mid-upload,
a bucket that was briefly unreachable, or a batch imported outside the API all
leave rows sitting in PENDING, and they would otherwise stay there.

SPEC §6.11 wants a scheduled worker. Until the queue exists this is a CLI command
— same reasoning as `app.cli.trending`, and the same way it gets tested.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.db.session import SessionLocal, engine
from app.services.media import process_pending

DEFAULT_BATCH = 50
POLL_SECONDS = 5.0


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="process-media", description=__doc__)
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_BATCH,
        help=f"How many items to take in one pass. Default {DEFAULT_BATCH}.",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help=f"Keep polling every {POLL_SECONDS:.0f}s instead of exiting after one pass.",
    )
    return parser.parse_args(argv)


async def _run(*, limit: int, watch: bool) -> int:
    processed = 0
    try:
        while True:
            async with SessionLocal() as session:
                handled = await process_pending(session, limit=limit)

            processed += handled
            if handled:
                print(f"process-media: handled {handled} item(s)")

            if not watch:
                break
            # Only sleep on an empty pass: a full batch probably means more is
            # waiting, and there is no reason to make it wait five seconds.
            if handled < limit:
                await asyncio.sleep(POLL_SECONDS)
    except KeyboardInterrupt:  # pragma: no cover - interactive only
        print("\nprocess-media: stopped")
    finally:
        await engine.dispose()

    if processed == 0:
        print("process-media: nothing pending")
    return 0


def main(argv: list[str]) -> int:
    args = _parse_args(argv)
    return asyncio.run(_run(limit=args.limit, watch=args.watch))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
