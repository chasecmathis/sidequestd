"""Populate the games catalog (SPEC §2).

Runs offline against the bundled seed fixture by default, so a fresh checkout has
a browsable catalog without an IGDB account:

    uv run python -m app.cli.import_games                 # bundled fixture
    uv run python -m app.cli.import_games --file mine.json
    uv run python -m app.cli.import_games --igdb --limit 200
    uv run python -m app.cli.import_games --igdb --all    # the whole catalog

`--igdb` needs IGDB_CLIENT_ID and IGDB_CLIENT_SECRET; without them the command
says so and exits non-zero rather than importing nothing quietly.

`--all` walks every page, writing each as it arrives and printing the id it
reached. That id is the resume point: a run interrupted after four hours picks up
with `--after-id`, rather than starting over.

`--drop-existing` empties the catalog first. Every reference to a game cascades,
so that also deletes every review, backlog entry and favorite in the database; it
asks before doing it unless `--yes` is given.

Every run ends by recounting the browse facets, which is what orders the genre
and platform chips (SPEC §6.5). Interrupting a `--all` run does not skip it.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from app.db.session import SessionLocal, engine
from app.services.exceptions import IgdbNotConfiguredError
from app.services.games_import import (
    IGDB_MAX_PAGE_SIZE,
    IGDB_SOURCE,
    SEED_SOURCE,
    ImportResult,
    count_catalog,
    delete_all_games,
    fetch_igdb_records,
    iter_igdb_records,
    load_seed_records,
    refresh_facet_counts,
    upsert_games,
)


def _parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="import_games", description=__doc__)
    parser.add_argument(
        "--igdb",
        action="store_true",
        help="Sync from the live IGDB API instead of the local fixture.",
    )
    parser.add_argument(
        "--file",
        type=Path,
        default=None,
        help="Path to an alternative seed fixture (implies the offline path).",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        dest="fetch_all",
        help="Import every page IGDB will serve, not just the first. Requires --igdb.",
    )
    parser.add_argument("--limit", type=int, default=100, help="IGDB page size. Default 100.")
    parser.add_argument("--offset", type=int, default=0, help="IGDB page offset. Default 0.")
    parser.add_argument(
        "--after-id",
        type=int,
        default=0,
        help="Resume a --all run just past this IGDB game id.",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Stop a --all run after this many pages. For a trial run.",
    )
    parser.add_argument(
        "--drop-existing",
        action="store_true",
        help="Delete the whole catalog first. Cascades to reviews, backlogs and favorites.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the confirmation prompt for --drop-existing.",
    )
    return parser.parse_args(argv)


def _reject_bad_combinations(args: argparse.Namespace) -> str | None:
    """Whatever is wrong with these arguments, phrased for the person who typed them."""
    if args.fetch_all and not args.igdb:
        return "--all imports from IGDB; pass --igdb too, or drop --all to read the fixture."
    if args.fetch_all and args.offset:
        return "--all pages by id, so --offset means nothing here. Use --after-id to resume."
    if args.igdb and args.limit > IGDB_MAX_PAGE_SIZE:
        return f"IGDB caps a page at {IGDB_MAX_PAGE_SIZE}; --limit {args.limit} would be rejected."
    if args.limit < 1:
        return "--limit must be at least 1."
    if args.max_pages is not None and args.max_pages < 1:
        return "--max-pages must be at least 1."
    if args.yes and not args.drop_existing:
        return "--yes only answers the --drop-existing prompt, and there is nothing to confirm."
    return None


async def _confirm_drop(*, assume_yes: bool) -> bool:
    """Say exactly what is about to be destroyed, then ask. Empty catalogs skip both."""
    async with SessionLocal() as session:
        contents = await count_catalog(session)

        if contents.games == 0:
            print("Catalog is already empty; nothing to drop.")
            return True

        print(f"--drop-existing will delete {contents.summary_line()}.")
        if not assume_yes:
            if contents.user_content and not sys.stdin.isatty():
                print(
                    "Refusing to delete user content without a confirmation. "
                    "Re-run with --yes if that is what you want.",
                    file=sys.stderr,
                )
                return False
            # In a thread: `input` blocks, and the event loop is what the open
            # database session is riding on.
            answer = await asyncio.to_thread(input, "Type 'drop' to confirm: ")
            if answer.strip() != "drop":
                print("Left the catalog alone.")
                return False

        await delete_all_games(session)
        print("Catalog emptied.")
        return True


async def _import_all(args: argparse.Namespace) -> ImportResult:
    """Page through the whole of IGDB, committing as we go."""
    total = ImportResult(source=IGDB_SOURCE)
    cursor = args.after_id
    pages = 0

    async with SessionLocal() as session:
        try:
            async for records, last_id in iter_igdb_records(
                page_size=args.limit, after_id=args.after_id, max_pages=args.max_pages
            ):
                page = await upsert_games(session, records, source=IGDB_SOURCE)
                total.merge(page)
                cursor = last_id
                pages += 1
                # Printed per page, not at the end: this runs for the better part
                # of an hour, and a silent terminal is indistinguishable from a
                # hung one. Flushed because stdout to a log file is block-buffered.
                print(
                    f"page {pages}: {len(records)} record(s) through id {last_id} "
                    f"({total.games_created} created, {total.games_updated} updated)",
                    flush=True,
                )
        except KeyboardInterrupt:
            print(f"\nStopped. Resume with --after-id {cursor}", file=sys.stderr)

    return total


async def _import_once(args: argparse.Namespace) -> ImportResult:
    if args.igdb:
        records = await fetch_igdb_records(limit=args.limit, offset=args.offset)
        source = IGDB_SOURCE
    else:
        records = load_seed_records(args.file)
        source = SEED_SOURCE

    async with SessionLocal() as session:
        return await upsert_games(session, records, source=source)


async def _run(args: argparse.Namespace) -> int:
    if (complaint := _reject_bad_combinations(args)) is not None:
        print(complaint, file=sys.stderr)
        return 2

    try:
        if args.drop_existing and not await _confirm_drop(assume_yes=args.yes):
            return 1
        result = await _import_all(args) if args.fetch_all else await _import_once(args)
        # After the import, not during it: the browse chips are ordered by these
        # numbers (SPEC §6.5), and a run interrupted at page 400 still leaves
        # them consistent with the 400 pages that did land, because `_import_all`
        # returns what it managed rather than re-raising.
        async with SessionLocal() as session:
            facets = await refresh_facet_counts(session)
    except IgdbNotConfiguredError as exc:
        print(exc.detail, file=sys.stderr)
        print("Re-run without --igdb to import the bundled seed fixture.", file=sys.stderr)
        return 1
    finally:
        await engine.dispose()

    print(result.summary_line())
    print(facets.summary_line())
    if result.skipped:
        print(f"skipped {len(result.skipped)} record(s) with no title: {result.skipped}")
    return 0


def main(argv: list[str]) -> int:
    return asyncio.run(_run(_parse_args(argv)))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
