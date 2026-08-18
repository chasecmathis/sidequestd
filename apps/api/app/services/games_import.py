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
import uuid
from collections import Counter
from collections.abc import AsyncIterator, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import httpx
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models.backlog import BacklogItem
from app.models.game import (
    EXTERNAL_ID_SOURCE_STEAM,
    Game,
    GameExternalId,
    Genre,
    Platform,
    game_genres,
    game_platforms,
)
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

# What one game is worth asking for. A constant rather than a literal inside the
# query builder so the tests can assert on the fields we need without pinning the
# order they happen to be written in.
#
# `total_rating` is IGDB's blended critic-and-user score, which is the one they
# present as *the* rating — `rating` alone is their members, `aggregated_rating`
# alone is the press, and both are far sparser. It is omitted from the payload
# entirely for a game nobody has scored, rather than sent as null.
#
# `external_games` is what makes a linked Steam library resolvable to catalog
# rows. Both the source name and the legacy `category` are requested because
# IGDB is mid-migration between them: `category` is marked deprecated in favour
# of `external_game_source`, but it is still populated, and reading whichever one
# arrives means this survives either side of the switch. See
# `_steam_uids_from_igdb` for the precedence.
IGDB_FIELDS = (
    "name, summary, first_release_date, cover.image_id, genres.name, platforms.name, "
    "total_rating, total_rating_count, external_games.uid, external_games.category, "
    "external_games.external_game_source.name"
)

# The legacy `external_games.category` value for Steam.
IGDB_EXTERNAL_CATEGORY_STEAM = 1

# What `external_games.external_game_source.name` reads for Steam, lowercased.
IGDB_EXTERNAL_SOURCE_NAME_STEAM = "steam"

# Steam appids are numeric. IGDB stores `uid` as a free string, and a handful of
# rows carry junk there, so anything that is not a plain integer is dropped
# rather than written into a column the sync will later look up by.
_STEAM_APPID = re.compile(r"^\d{1,32}$")

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
    igdb_rating: float | None = None
    igdb_rating_count: int | None = None
    # (source, uid) pairs — the store ids this game is known by. Empty for a
    # record from a source that does not publish them, which is not the same as
    # "this game is on no store": `upsert_games` therefore leaves an existing
    # mapping alone when a record carries none. See `_write_external_ids`.
    external_ids: tuple[tuple[str, str], ...] = ()


@dataclass(slots=True)
class ImportResult:
    source: str
    games_created: int = 0
    games_updated: int = 0
    genres_created: int = 0
    platforms_created: int = 0
    external_ids_written: int = 0
    skipped: list[str] = field(default_factory=list)

    def summary_line(self) -> str:
        return (
            f"{self.source}: {self.games_created} game(s) created, "
            f"{self.games_updated} updated, {self.genres_created} new genre(s), "
            f"{self.platforms_created} new platform(s), "
            f"{self.external_ids_written} store id(s)"
        )

    def merge(self, other: ImportResult) -> None:
        """Fold one page's counts into a running total for a multi-page sync."""
        self.games_created += other.games_created
        self.games_updated += other.games_updated
        self.genres_created += other.genres_created
        self.platforms_created += other.platforms_created
        self.external_ids_written += other.external_ids_written
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
        igdb_rating=entry.get("total_rating"),
        igdb_rating_count=entry.get("total_rating_count"),
        # Optional in the fixture. Present so the offline catalog can exercise
        # Steam library resolution without credentials, the same way the rest of
        # the seed data keeps the catalog testable without IGDB.
        external_ids=(
            ((EXTERNAL_ID_SOURCE_STEAM, str(entry["steam_appid"])),)
            if entry.get("steam_appid")
            else ()
        ),
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
        f"fields {IGDB_FIELDS}",
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


def _is_steam_external(external: dict[str, Any]) -> bool:
    """Whether one `external_games` entry is a Steam listing.

    The source object is checked first and the deprecated numeric category second,
    so this keeps working when IGDB finishes removing `category` — at which point
    the second branch simply stops matching anything.
    """
    source = external.get("external_game_source")
    if isinstance(source, dict) and source.get("name"):
        return str(source["name"]).strip().lower() == IGDB_EXTERNAL_SOURCE_NAME_STEAM
    return external.get("category") == IGDB_EXTERNAL_CATEGORY_STEAM


def _steam_uids_from_igdb(entry: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    """The Steam appids IGDB lists for one game, deduplicated and order-stable."""
    uids: dict[str, None] = {}
    for external in entry.get("external_games", []):
        if not isinstance(external, dict) or not _is_steam_external(external):
            continue
        uid = str(external.get("uid") or "").strip()
        if _STEAM_APPID.match(uid):
            # Leading zeros would make two spellings of one appid, and the sync
            # looks this up with the integer Steam hands back.
            uids.setdefault(str(int(uid)), None)
    return tuple((EXTERNAL_ID_SOURCE_STEAM, uid) for uid in uids)


def _record_from_igdb(entry: dict[str, Any]) -> GameRecord:
    released = entry.get("first_release_date")
    cover = entry.get("cover") or {}
    # Absent for anything IGDB has not scored — the key is missing rather than
    # null, so `.get` is doing real work here and not just being defensive.
    rating = entry.get("total_rating")
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
        # Coerced because IGDB sends a bare int for a whole score and the column
        # is double precision.
        igdb_rating=float(rating) if rating is not None else None,
        igdb_rating_count=entry.get("total_rating_count"),
        external_ids=_steam_uids_from_igdb(entry),
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
    # The lookup rows survive the wipe, so without this every facet would keep
    # the count it had when it still had games behind it.
    await refresh_facet_counts(db)
    logger.info("Emptied the games catalog: %s", contents.summary_line())
    return contents


@dataclass(frozen=True, slots=True)
class FacetCounts:
    """How many genres and platforms came out of the recount with any games."""

    genres: int
    platforms: int

    def summary_line(self) -> str:
        return f"{self.genres} genre(s) and {self.platforms} platform(s) now have games behind them"


async def refresh_facet_counts(db: AsyncSession) -> FacetCounts:
    """Recompute `genres.game_count` and `platforms.game_count` from scratch.

    Recomputed, not incremented, for the same reason `refresh_game_rating` is:
    an import that reassigns a game's platforms deletes association rows as well
    as adding them, and a counter maintained by deltas drifts the first time one
    of those paths is missed.

    Called once at the end of a catalog run rather than inside `upsert_games`.
    A full IGDB walk is ~700 pages, and each of these costs a pass over the
    association table — paying that per page would add minutes to the sync to
    produce intermediate numbers nothing ever reads.
    """
    for model, facet_id in (
        (Genre, game_genres.c.genre_id),
        (Platform, game_platforms.c.platform_id),
    ):
        # Zeroed first, so a facet whose last game went away is covered by the
        # same two statements as one that gained games. The alternative is an
        # anti-join for the empties, and these tables are hundreds of rows.
        await db.execute(sa.update(model).values(game_count=0))

        totals = (
            sa.select(facet_id.label("facet_id"), sa.func.count().label("total"))
            .group_by(facet_id)
            .subquery()
        )
        await db.execute(
            sa.update(model).where(model.id == totals.c.facet_id).values(game_count=totals.c.total)
        )

    await db.commit()

    async def populated(model: type[Genre] | type[Platform]) -> int:
        return (
            await db.execute(
                sa.select(sa.func.count()).select_from(model).where(model.game_count > 0)
            )
        ).scalar_one()

    counts = FacetCounts(genres=await populated(Genre), platforms=await populated(Platform))
    logger.info("Recounted browse facets: %s", counts.summary_line())
    return counts


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


async def _write_external_ids(
    db: AsyncSession, owned: Sequence[tuple[uuid.UUID, tuple[tuple[str, str], ...]]]
) -> int:
    """Rewrite the store-id mapping for games whose record carried one.

    Only games with at least one id are touched. IGDB omits `external_games`
    entirely for a game with no store listings, which is indistinguishable from
    the field not having been asked for, so treating "no ids" as "delete the ids"
    would let one malformed page silently unmap the catalog. Within a game that
    *did* report ids the set is replaced, so a delisted store entry does
    disappear.
    """
    rows = {
        (source, uid): {"source": source, "uid": uid, "game_id": game_id}
        # Last writer wins on a duplicate (source, uid), matching how
        # `upsert_games` deduplicates records. Postgres refuses an ON CONFLICT
        # that would touch the same row twice in one statement, so this has to
        # collapse before the insert rather than after it.
        for game_id, pairs in owned
        for source, uid in pairs
    }
    if not rows:
        return 0

    affected_sources = {source for source, _ in rows}
    game_ids = [game_id for game_id, pairs in owned if pairs]
    await db.execute(
        sa.delete(GameExternalId).where(
            GameExternalId.game_id.in_(game_ids),
            GameExternalId.source.in_(affected_sources),
        )
    )

    statement = pg_insert(GameExternalId).values(list(rows.values()))
    await db.execute(
        statement.on_conflict_do_update(
            index_elements=[GameExternalId.source, GameExternalId.uid],
            # The uid may already belong to a game outside this batch — IGDB
            # sometimes moves a store id between a game and its remaster. The
            # mapping has one row per store id by design, so the newest import
            # wins rather than the insert failing the whole page.
            set_={"game_id": statement.excluded.game_id},
        )
    )
    return len(rows)


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

    owned_external_ids: list[tuple[Game, tuple[tuple[str, str], ...]]] = []
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
        # Unconditional, like every other field here, and for the same reason the
        # genre assignment below spells out: IGDB drops `total_rating` from the
        # payload when a game falls back under its threshold, and a score that no
        # longer exists upstream has to be able to stop existing here. Guarding
        # this with `is not None` would make a withdrawn score permanent.
        #
        # `rating_average` and `rating_count` are ours and are deliberately not
        # touched — the import has no opinion about what our members think.
        game.igdb_rating = record.igdb_rating
        game.igdb_rating_count = record.igdb_rating_count
        # Assigning the full list lets SQLAlchemy diff the association rows, so a
        # game that lost a platform upstream loses it here too.
        game.genres = [genres[slug] for slug in map(slugify, record.genres) if slug in genres]
        game.platforms = [
            platforms[slug] for slug in map(slugify, record.platforms) if slug in platforms
        ]
        if record.external_ids:
            owned_external_ids.append((game, record.external_ids))

    if owned_external_ids:
        # The newly created games have no id until they reach the database, and
        # the mapping is keyed on it.
        await db.flush()
        result.external_ids_written = await _write_external_ids(
            db, [(game.id, pairs) for game, pairs in owned_external_ids]
        )

    # Once for the batch, not once per record: nothing in the loop reads the
    # database back, so there is nothing to make visible between iterations.
    await db.commit()
    return result
