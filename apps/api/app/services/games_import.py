"""Games catalog import/sync (SPEC §2).

SPEC §2 sources game data from a third-party database and caches it locally "so
the app doesn't depend on live third-party calls per request". Nothing in the
request path ever talks to IGDB; this module is the only thing that does, and it
runs from the CLI (`python -m app.cli.import_games`).

Two sources, one normalised `GameRecord` shape and one upsert path:

* the bundled seed fixture (`app/data/seed_games.json`) — no credentials, no
  network, so the catalog is populated and testable offline;
* the live IGDB API, used when IGDB_CLIENT_ID / IGDB_CLIENT_SECRET are set.

The upsert keys on `external_id`, so re-running is idempotent: a second import of
the same source updates rows in place rather than duplicating the catalog.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import unicodedata
from collections import Counter
from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.backlog import BacklogItem
from app.models.game import Game, Genre, Platform
from app.models.review import Review
from app.models.user import FavoriteGame
from app.services.exceptions import IgdbNotConfiguredError

logger = logging.getLogger(__name__)

SEED_SOURCE = "seed"
IGDB_SOURCE = "igdb"

SEED_FIXTURE_PATH = Path(__file__).resolve().parent.parent / "data" / "seed_games.json"

# IGDB serves covers from a template URL; t_cover_big is the size the cards use.
IGDB_COVER_TEMPLATE = "https://images.igdb.com/igdb/image/upload/t_cover_big/{image_id}.jpg"

# IGDB rejects anything larger, so this is the fewest round trips a full sync can
# take: roughly 700 of them for the ~350k main games in the catalog.
IGDB_MAX_PAGE_SIZE = 500

# Four requests per second is IGDB's documented ceiling. Sequential pages with a
# quarter-second gap stay under it without needing a token bucket.
IGDB_MIN_REQUEST_INTERVAL = 0.25

# `category = 0` is main games only. Without it the catalog fills up with DLC,
# expansions, bundles, ports and mods, which outnumber the games themselves.
IGDB_MAIN_GAMES_FILTER = "game_type = 0"

_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


@dataclass(frozen=True, slots=True)
class GameRecord:
    """One catalog entry, normalised away from whichever source produced it."""

    external_id: str
    title: str
    summary: str | None = None
    cover_url: str | None = None
    release_date: date | None = None
    genres: tuple[str, ...] = ()
    platforms: tuple[str, ...] = ()


@dataclass(slots=True)
class ImportResult:
    source: str
    games_created: int = 0
    games_updated: int = 0
    genres_created: int = 0
    platforms_created: int = 0
    skipped: list[str] = field(default_factory=list)

    def summary_line(self) -> str:
        return (
            f"{self.source}: {self.games_created} game(s) created, "
            f"{self.games_updated} updated, {self.genres_created} new genre(s), "
            f"{self.platforms_created} new platform(s)"
        )

    def merge(self, other: ImportResult) -> None:
        """Fold one page's counts into a running total for a multi-page sync."""
        self.games_created += other.games_created
        self.games_updated += other.games_updated
        self.genres_created += other.genres_created
        self.platforms_created += other.platforms_created
        self.skipped.extend(other.skipped)


def slugify(value: str) -> str:
    """Lower-case ASCII slug. Deterministic, so re-imports resolve to the same row."""
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return _SLUG_STRIP.sub("-", folded.lower()).strip("-")


# --- Sources ---------------------------------------------------------------


def load_seed_records(path: Path | None = None) -> list[GameRecord]:
    """Read the bundled fixture. The offline path — never touches the network."""
    document = json.loads((path or SEED_FIXTURE_PATH).read_text(encoding="utf-8"))
    return [_record_from_seed(entry) for entry in document["games"]]


def _record_from_seed(entry: dict[str, Any]) -> GameRecord:
    released = entry.get("release_date")
    return GameRecord(
        external_id=str(entry["external_id"]),
        title=entry["title"],
        summary=entry.get("summary"),
        cover_url=entry.get("cover_url"),
        release_date=date.fromisoformat(released) if released else None,
        genres=tuple(entry.get("genres", ())),
        platforms=tuple(entry.get("platforms", ())),
    )


def igdb_is_configured() -> bool:
    return bool(settings.igdb_client_id and settings.igdb_client_secret)


def _new_client() -> httpx.AsyncClient:
    """The HTTP client every IGDB call goes through. Patched out in tests."""
    return httpx.AsyncClient(timeout=30.0)


async def _authenticate(http: httpx.AsyncClient) -> str:
    """Exchange the client credentials for a bearer token."""
    response = await http.post(
        settings.igdb_token_url,
        params={
            "client_id": settings.igdb_client_id,
            "client_secret": settings.igdb_client_secret,
            "grant_type": "client_credentials",
        },
    )
    # Checked before the body is read: Twitch answers a bad client with a 400 and
    # no `access_token`, which would otherwise surface as a bare KeyError several
    # lines from the thing that actually went wrong.
    response.raise_for_status()
    # Never log the response itself — it carries the bearer token.
    token: str = response.json()["access_token"]
    logger.debug("Authenticated with IGDB")
    return token


def _build_query(*, limit: int, offset: int | None = None, after_id: int | None = None) -> str:
    """One APICalypse query, paged either by offset or by id.

    Keyset (`after_id`) is the one to use for a full sync: `offset` walks a result
    set that upstream is still editing, so rows shift between pages and some are
    never returned at all. Ordering by id and asking for the next id after the
    last one seen has no such gap, and it makes an interrupted run resumable.
    """
    conditions = [IGDB_MAIN_GAMES_FILTER]
    if after_id is not None:
        conditions.append(f"id > {after_id}")

    clauses = [
        "fields name, summary, first_release_date, cover.image_id, genres.name, platforms.name",
        f"where {' & '.join(conditions)}",
        "sort id asc" if after_id is not None else "sort rating_count desc",
        f"limit {limit}",
    ]
    if offset is not None:
        clauses.append(f"offset {offset}")
    return "".join(f"{clause}; " for clause in clauses).strip()


async def _fetch_page(http: httpx.AsyncClient, token: str, query: str) -> list[GameRecord]:
    response = await http.post(
        f"{settings.igdb_api_url}/games",
        headers={
            "Client-ID": str(settings.igdb_client_id),
            "Authorization": f"Bearer {token}",
        },
        content=query,
    )
    response.raise_for_status()
    payload: list[dict[str, Any]] = response.json()
    logger.debug("Fetched %d game(s) from IGDB", len(payload))
    return [_record_from_igdb(entry) for entry in payload]


async def fetch_igdb_records(*, limit: int = 100, offset: int = 0) -> list[GameRecord]:
    """Pull one page of the most-rated games from IGDB.

    Raises `IgdbNotConfiguredError` rather than failing obscurely when the
    credentials are absent — the CLI turns that into a pointer at the fixture.
    """
    if not igdb_is_configured():
        raise IgdbNotConfiguredError

    async with _new_client() as http:
        token = await _authenticate(http)
        return await _fetch_page(http, token, _build_query(limit=limit, offset=offset))


async def iter_igdb_records(
    *, page_size: int = IGDB_MAX_PAGE_SIZE, after_id: int = 0, max_pages: int | None = None
) -> AsyncIterator[tuple[list[GameRecord], int]]:
    """Walk the whole catalog, a page at a time, yielding `(records, last_id)`.

    The caller writes each page as it arrives rather than holding a few hundred
    thousand records in memory, and `last_id` is what makes an interrupted run
    resumable: pass it back as `after_id` and the sync picks up where it stopped.

    Paced to IGDB's documented four requests per second. A short page means the
    catalog is exhausted, which is the only way this stops on its own.
    """
    if not igdb_is_configured():
        raise IgdbNotConfiguredError

    async with _new_client() as http:
        token = await _authenticate(http)
        cursor = after_id
        pages = 0

        while max_pages is None or pages < max_pages:
            if pages:
                await asyncio.sleep(IGDB_MIN_REQUEST_INTERVAL)

            records = await _fetch_page(http, token, _build_query(limit=page_size, after_id=cursor))
            pages += 1
            if not records:
                return

            # Sorted by id ascending, so the last row is the high-water mark.
            cursor = int(records[-1].external_id)
            yield records, cursor

            if len(records) < page_size:
                return


def _record_from_igdb(entry: dict[str, Any]) -> GameRecord:
    released = entry.get("first_release_date")
    cover = entry.get("cover") or {}
    return GameRecord(
        external_id=str(entry["id"]),
        title=entry["name"],
        summary=entry.get("summary"),
        cover_url=(
            IGDB_COVER_TEMPLATE.format(image_id=cover["image_id"])
            if cover.get("image_id")
            else None
        ),
        release_date=(
            datetime.fromtimestamp(released, tz=UTC).date() if released is not None else None
        ),
        genres=tuple(item["name"] for item in entry.get("genres", []) if item.get("name")),
        platforms=tuple(item["name"] for item in entry.get("platforms", []) if item.get("name")),
    )


# --- Upsert ----------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class CatalogContents:
    """What a catalog wipe would take with it. Counted before anything is deleted."""

    games: int
    reviews: int
    backlog_items: int
    favorites: int

    @property
    def user_content(self) -> int:
        return self.reviews + self.backlog_items + self.favorites

    def summary_line(self) -> str:
        return (
            f"{self.games} game(s), and by cascade {self.reviews} review(s), "
            f"{self.backlog_items} backlog entr(ies), {self.favorites} favorite(s)"
        )


async def count_catalog(db: AsyncSession) -> CatalogContents:
    """Measure the blast radius of `delete_all_games` without taking any action."""

    async def total(model: type[Any]) -> int:
        return (await db.execute(sa.select(sa.func.count()).select_from(model))).scalar_one()

    return CatalogContents(
        games=await total(Game),
        reviews=await total(Review),
        backlog_items=await total(BacklogItem),
        favorites=await total(FavoriteGame),
    )


async def delete_all_games(db: AsyncSession) -> CatalogContents:
    """Empty the games catalog. Returns what was there.

    Every reference to `games.id` is ON DELETE CASCADE, so this also removes every
    review, backlog entry, favorite and trending score in the database — the whole
    point of the flag that calls it, but not something to discover afterwards.
    Genres and platforms are left alone: they are lookup rows with no owner, and
    the next import resolves them by slug either way.

    Uploaded review media is *not* removed from the object store. The rows that
    pointed at it are gone, so nothing can reach it; `process_media` has no work
    to do either way, and reclaiming the bucket is a separate job.
    """
    contents = await count_catalog(db)
    await db.execute(sa.delete(Game))
    await db.commit()
    logger.info("Emptied the games catalog: %s", contents.summary_line())
    return contents


async def _resolve_taxonomy[TaxonomyT: (Genre, Platform)](
    db: AsyncSession,
    model: type[TaxonomyT],
    names: Iterable[str],
) -> tuple[dict[str, TaxonomyT], int]:
    """Look up genres/platforms by slug, creating the ones that don't exist yet.

    Genre and Platform are structurally identical name/slug lookup tables, so one
    implementation serves both.
    """
    by_slug = {slugify(name): name for name in names if name.strip()}
    if not by_slug:
        return {}, 0

    existing = (await db.execute(sa.select(model).where(model.slug.in_(by_slug)))).scalars().all()
    resolved: dict[str, TaxonomyT] = {row.slug: row for row in existing}

    created = 0
    for slug, name in by_slug.items():
        if slug in resolved:
            continue
        row = model(name=name, slug=slug)
        db.add(row)
        resolved[slug] = row
        created += 1

    if created:
        await db.flush()
    return resolved, created


async def _allocate_slugs(db: AsyncSession, records: Sequence[GameRecord]) -> dict[str, str]:
    """Pick a free `games.slug` for each record, keyed by external id.

    `games.slug` is unique and distinct releases really do share a title, so the
    second "Prey" becomes `prey-2`. Doing that per record used to cost a
    `slug LIKE 'prey%'` query each — and under this database's en_US collation the
    unique index cannot serve a prefix match, so every one of them scanned the
    whole index of a table the import itself was growing.

    So: one equality lookup for the whole batch (which the index *can* serve),
    a second only for the bases that actually collide, and the running set of
    what has been handed out kept in memory. Two queries per page rather than
    one per game.
    """
    bases = {
        record.external_id: slugify(record.title) or slugify(record.external_id)
        for record in records
    }
    if not bases:
        return {}

    taken = set(
        (await db.execute(sa.select(Game.slug).where(Game.slug.in_(set(bases.values())))))
        .scalars()
        .all()
    )

    # A base needs its `-2`, `-3`… neighbours pulled in if the catalog already has
    # it, or if this batch wants it twice. Both are rare, so the scan this costs
    # is paid once for the page instead of once per game — and never at all when
    # importing into an empty catalog. Slugs are `[a-z0-9-]` by construction, so
    # there is no LIKE metacharacter to escape.
    repeated = {base for base, count in Counter(bases.values()).items() if count > 1}
    if contested := (taken | repeated) & set(bases.values()):
        taken |= set(
            (
                await db.execute(
                    sa.select(Game.slug).where(
                        sa.or_(*(Game.slug.like(f"{base}-%") for base in contested))
                    )
                )
            )
            .scalars()
            .all()
        )

    allocated: dict[str, str] = {}
    for external_id, base in bases.items():
        slug, suffix = base, 2
        while slug in taken:
            slug = f"{base}-{suffix}"
            suffix += 1
        taken.add(slug)
        allocated[external_id] = slug
    return allocated


async def upsert_games(
    db: AsyncSession, records: Sequence[GameRecord], *, source: str
) -> ImportResult:
    """Insert or refresh `records`, keyed on (external_source, external_id).

    Commits once at the end so a failed import leaves the catalog untouched
    rather than half-written.
    """
    result = ImportResult(source=source)
    if not records:
        return result

    # One row per external id: it is what the upsert keys on, so a batch carrying
    # the same id twice would otherwise build two rows and fail the unique
    # constraint at commit, losing the whole page. The later record wins.
    deduplicated = list({record.external_id: record for record in records}.values())

    genres, result.genres_created = await _resolve_taxonomy(
        db, Genre, (name for record in deduplicated for name in record.genres)
    )
    platforms, result.platforms_created = await _resolve_taxonomy(
        db, Platform, (name for record in deduplicated for name in record.platforms)
    )

    existing = {
        game.external_id: game
        for game in (
            await db.execute(
                sa.select(Game)
                .where(Game.external_id.in_([record.external_id for record in deduplicated]))
                .options(selectinload(Game.genres), selectinload(Game.platforms))
            )
        )
        .scalars()
        .all()
    }

    writable = [record for record in deduplicated if record.title.strip()]
    result.skipped = [record.external_id for record in deduplicated if not record.title.strip()]
    slugs = await _allocate_slugs(
        db, [record for record in writable if record.external_id not in existing]
    )

    for record in writable:
        game = existing.get(record.external_id)
        if game is None:
            game = Game(
                external_id=record.external_id,
                external_source=source,
                slug=slugs[record.external_id],
            )
            db.add(game)
            result.games_created += 1
        else:
            result.games_updated += 1

        game.title = record.title
        game.summary = record.summary
        game.cover_url = record.cover_url
        game.release_date = record.release_date
        # Assigning the full list lets SQLAlchemy diff the association rows, so a
        # game that lost a platform upstream loses it here too.
        game.genres = [genres[slug] for slug in map(slugify, record.genres) if slug in genres]
        game.platforms = [
            platforms[slug] for slug in map(slugify, record.platforms) if slug in platforms
        ]

    # Once for the batch, not once per record: nothing in the loop reads the
    # database back, so there is nothing to make visible between iterations.
    await db.commit()
    return result
