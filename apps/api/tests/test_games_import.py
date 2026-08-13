"""The catalog import/sync service and its CLI — SPEC §2."""

from __future__ import annotations

import json
import re
import time
from collections.abc import Awaitable, Callable
from datetime import date
from pathlib import Path

import httpx
import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.cli import import_games as import_games_cli
from app.core.config import settings
from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus
from app.models.game import Game, Genre, Platform
from app.models.review import Review
from app.models.user import FavoriteGame, User
from app.services import games_import
from app.services.exceptions import IgdbNotConfiguredError
from app.services.games_import import (
    IGDB_SOURCE,
    SEED_SOURCE,
    GameRecord,
    ImportResult,
    _build_query,
    count_catalog,
    delete_all_games,
    fetch_igdb_records,
    igdb_is_configured,
    iter_igdb_records,
    load_seed_records,
    slugify,
    upsert_games,
)
from tests.conftest import SEED_GAME_COUNT

# --- The bundled fixture ---------------------------------------------------


def test_the_shipped_fixture_parses_and_is_complete() -> None:
    records = load_seed_records()

    assert len(records) == SEED_GAME_COUNT
    for record in records:
        assert record.external_id and record.title
        assert record.genres, f"{record.title} has no genres to browse by"
        assert record.platforms, f"{record.title} has no platforms to filter by"


def test_the_fixture_has_no_duplicate_external_ids() -> None:
    """The upsert keys on external_id, so a duplicate would silently collapse."""
    ids = [record.external_id for record in load_seed_records()]

    assert len(ids) == len(set(ids))


def test_the_fixture_has_no_duplicate_cover_art() -> None:
    """Two games sharing a cover URL means one of them is showing the wrong game."""
    covers = [record.cover_url for record in load_seed_records() if record.cover_url]

    assert len(covers) == len(set(covers))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("The Witcher 3: Wild Hunt", "the-witcher-3-wild-hunt"),
        ("PC (Microsoft Windows)", "pc-microsoft-windows"),
        ("Xbox Series X|S", "xbox-series-x-s"),
        ("Pokémon Rouge", "pokemon-rouge"),
        ("  spaced  out  ", "spaced-out"),
    ],
)
def test_slugify(value: str, expected: str) -> None:
    assert slugify(value) == expected


# --- Upsert ----------------------------------------------------------------


async def test_import_creates_games_genres_and_platforms(db: AsyncSession) -> None:
    result = await upsert_games(db, load_seed_records(), source=SEED_SOURCE)

    assert result.games_created == SEED_GAME_COUNT
    assert result.games_updated == 0
    assert result.genres_created > 0
    assert result.platforms_created > 0

    count = (await db.execute(sa.select(sa.func.count(Game.id)))).scalar_one()
    assert count == SEED_GAME_COUNT


async def test_import_links_the_many_to_many_sides(db: AsyncSession) -> None:
    await upsert_games(db, load_seed_records(), source=SEED_SOURCE)

    game = (
        await db.execute(
            sa.select(Game)
            .where(Game.title == "The Witcher 3: Wild Hunt")
            .options(selectinload(Game.genres), selectinload(Game.platforms))
        )
    ).scalar_one()

    assert {genre.slug for genre in game.genres} == {"role-playing-rpg", "adventure"}
    assert "nintendo-switch" in {platform.slug for platform in game.platforms}
    assert game.release_date == date(2015, 5, 19)
    assert game.external_source == SEED_SOURCE


async def test_reimporting_updates_in_place_instead_of_duplicating(db: AsyncSession) -> None:
    """Re-running the sync must be safe — that is the whole point of external_id."""
    records = load_seed_records()
    await upsert_games(db, records, source=SEED_SOURCE)

    second = await upsert_games(db, records, source=SEED_SOURCE)

    assert second.games_created == 0
    assert second.games_updated == SEED_GAME_COUNT
    assert second.genres_created == 0
    count = (await db.execute(sa.select(sa.func.count(Game.id)))).scalar_one()
    assert count == SEED_GAME_COUNT


async def test_an_upstream_edit_is_applied_on_the_next_sync(db: AsyncSession) -> None:
    original = GameRecord(
        external_id="42",
        title="Provisional Title",
        summary="Placeholder.",
        release_date=date(2030, 1, 1),
        genres=("Indie",),
        platforms=("PC (Microsoft Windows)",),
    )
    await upsert_games(db, [original], source=SEED_SOURCE)

    revised = GameRecord(
        external_id="42",
        title="Final Title",
        summary="The real blurb.",
        release_date=date(2031, 6, 1),
        genres=("Indie", "Puzzle"),
        platforms=("Nintendo Switch",),
    )
    await upsert_games(db, [revised], source=SEED_SOURCE)

    game = (
        await db.execute(
            sa.select(Game)
            .where(Game.external_id == "42")
            .options(selectinload(Game.genres), selectinload(Game.platforms))
        )
    ).scalar_one()
    assert game.title == "Final Title"
    assert game.release_date == date(2031, 6, 1)
    assert {genre.slug for genre in game.genres} == {"indie", "puzzle"}
    # A platform dropped upstream is dropped here too, not merged in.
    assert {platform.slug for platform in game.platforms} == {"nintendo-switch"}


async def test_two_games_sharing_a_title_get_distinct_slugs(db: AsyncSession) -> None:
    """`games.slug` is unique, and remakes really do reuse the exact title."""
    await upsert_games(
        db,
        [
            GameRecord(external_id="100", title="Prey"),
            GameRecord(external_id="101", title="Prey"),
        ],
        source=SEED_SOURCE,
    )

    slugs = (await db.execute(sa.select(Game.slug).where(Game.title == "Prey"))).scalars().all()
    assert sorted(slugs) == ["prey", "prey-2"]


async def test_a_title_repeated_within_one_batch_gets_a_slug_each(db: AsyncSession) -> None:
    """Slugs are handed out from an in-memory set now, not read back per record.

    The old code flushed after every game so the next `LIKE` query could see it;
    this is what has to hold instead.
    """
    await upsert_games(
        db,
        [GameRecord(external_id=str(index), title="Prey") for index in range(3)],
        source=SEED_SOURCE,
    )

    slugs = (await db.execute(sa.select(Game.slug).where(Game.title == "Prey"))).scalars().all()
    assert sorted(slugs) == ["prey", "prey-2", "prey-3"]


async def test_a_later_batch_keeps_counting_from_what_is_already_stored(
    db: AsyncSession,
) -> None:
    """The in-memory set is seeded from the catalog, so pages do not collide."""
    await upsert_games(
        db,
        [GameRecord(external_id=str(index), title="Prey") for index in range(3)],
        source=SEED_SOURCE,
    )

    await upsert_games(db, [GameRecord(external_id="4", title="Prey")], source=SEED_SOURCE)

    slug = (await db.execute(sa.select(Game.slug).where(Game.external_id == "4"))).scalar_one()
    assert slug == "prey-4"


async def test_a_batch_carrying_one_id_twice_writes_one_row(db: AsyncSession) -> None:
    # external_id is unique, so two rows would fail at commit and take the whole
    # page with them. The later record is the one upstream sent last.
    result = await upsert_games(
        db,
        [
            GameRecord(external_id="7", title="First Guess"),
            GameRecord(external_id="7", title="Corrected"),
        ],
        source=SEED_SOURCE,
    )

    assert result.games_created == 1
    game = (await db.execute(sa.select(Game).where(Game.external_id == "7"))).scalar_one()
    assert game.title == "Corrected"


async def test_a_batch_costs_a_fixed_number_of_queries(
    db: AsyncSession, engine: sa.ext.asyncio.AsyncEngine
) -> None:
    """The guard on the thing that made a full IGDB import unusable.

    Slug allocation used to run one `LIKE` query per new game — and under this
    database's collation the unique index on `slug` cannot serve a prefix match,
    so each one scanned the whole index of a table the import was still growing.
    What matters is not the wall clock but that the cost stops tracking the batch
    size, so that is what is asserted.
    """
    statements = 0

    @sa.event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _count(*_args: object, **_kwargs: object) -> None:
        nonlocal statements
        statements += 1

    records = [
        GameRecord(
            external_id=f"bulk-{index}",
            title=f"Bulk Game {index}",
            genres=("Indie",),
            platforms=("Nintendo Switch",),
        )
        for index in range(200)
    ]
    await upsert_games(db, records, source=SEED_SOURCE)

    # Taxonomy, the existing-rows lookup, slug allocation, and the flush and
    # commit that follow. Twenty is loose enough not to be brittle and tight
    # enough that anything per-record blows straight through it.
    assert statements < 20


async def test_a_genre_shared_by_two_games_is_created_once(db: AsyncSession) -> None:
    result = await upsert_games(
        db,
        [
            GameRecord(external_id="200", title="One", genres=("Indie",)),
            GameRecord(external_id="201", title="Two", genres=("Indie",)),
        ],
        source=SEED_SOURCE,
    )

    assert result.genres_created == 1
    count = (
        await db.execute(sa.select(sa.func.count(Genre.id)).where(Genre.slug == "indie"))
    ).scalar_one()
    assert count == 1


async def test_a_record_with_no_title_is_skipped_not_crashed_on(db: AsyncSession) -> None:
    result = await upsert_games(
        db,
        [GameRecord(external_id="300", title="   "), GameRecord(external_id="301", title="Real")],
        source=SEED_SOURCE,
    )

    assert result.skipped == ["300"]
    assert result.games_created == 1


async def test_importing_nothing_is_a_no_op(db: AsyncSession) -> None:
    result = await upsert_games(db, [], source=SEED_SOURCE)

    assert result.games_created == 0
    assert (await db.execute(sa.select(sa.func.count(Platform.id)))).scalar_one() == 0


async def test_a_custom_fixture_file_can_be_loaded(db: AsyncSession, tmp_path: Path) -> None:
    fixture = tmp_path / "mine.json"
    fixture.write_text(
        json.dumps(
            {
                "source": "seed",
                "games": [
                    {
                        "external_id": "900",
                        "title": "Homegrown",
                        "release_date": "2024-01-02",
                        "genres": ["Puzzle"],
                        "platforms": ["Nintendo Switch"],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )

    result = await upsert_games(db, load_seed_records(fixture), source=SEED_SOURCE)

    assert result.games_created == 1


# --- The IGDB path ---------------------------------------------------------


@pytest.fixture
def unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin the credentials to absent for the duration of a test.

    Settings are read from the environment at import time, so a developer who has
    exported IGDB_CLIENT_ID to try the live sync would otherwise change what
    these tests mean — and the second one would leave the suite entirely, making
    a real call to Twitch's OAuth endpoint. What is under test is the behaviour
    when nothing is configured, so that state is asserted rather than inherited.
    """
    monkeypatch.setattr(settings, "igdb_client_id", None)
    monkeypatch.setattr(settings, "igdb_client_secret", None)


@pytest.mark.usefixtures("unconfigured")
def test_igdb_is_not_configured_by_default() -> None:
    """The offline path has to be the default, or a fresh checkout can't run."""
    assert igdb_is_configured() is False


@pytest.mark.usefixtures("unconfigured")
async def test_fetching_from_igdb_without_credentials_says_so(db: AsyncSession) -> None:
    with pytest.raises(IgdbNotConfiguredError) as caught:
        await fetch_igdb_records()

    assert "seed" in caught.value.detail


def test_credentials_switch_the_import_to_the_live_path(monkeypatch: pytest.MonkeyPatch) -> None:
    """The other half of the same switch, so neither direction is assumed."""
    monkeypatch.setattr(settings, "igdb_client_id", "client")
    monkeypatch.setattr(settings, "igdb_client_secret", "secret")

    assert igdb_is_configured() is True


def test_half_a_credential_pair_is_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    # A half-filled .env should fall back to the seed rather than start a sync
    # that can only fail at the token endpoint.
    monkeypatch.setattr(settings, "igdb_client_id", "client")
    monkeypatch.setattr(settings, "igdb_client_secret", None)

    assert igdb_is_configured() is False


# --- The query IGDB is actually sent ---------------------------------------


def test_the_query_asks_only_for_main_games() -> None:
    """Without this the catalog fills with DLC, bundles and ports (SPEC §2).

    Asserted through the constant rather than its spelling: which field carries
    this is IGDB's business and has changed once already.
    """
    assert f"where {games_import.IGDB_MAIN_GAMES_FILTER}" in _build_query(limit=10)


def test_paging_by_id_asks_only_for_what_it_has_not_seen() -> None:
    query = _build_query(limit=10, after_id=42)

    assert "id > 42" in query
    assert "sort id asc" in query
    # Offset paging over a result set upstream is still editing drops rows.
    assert "offset" not in query


def test_the_single_page_path_still_leads_with_the_best_known_games() -> None:
    """`--igdb --limit 200` is a sampler, so popularity order is the useful one."""
    query = _build_query(limit=200, offset=400)

    assert "sort rating_count desc" in query
    assert "offset 400" in query


def test_the_query_asks_for_the_upstream_score() -> None:
    """Without these two fields the IGDB half of a game's scores is dark forever.

    Spelled out rather than checked through `IGDB_FIELDS` wholesale, because the
    point is *which* score: `total_rating` is the blended one. Note that a bare
    `"rating_count" in query` would pass on the popularity sort alone and prove
    nothing.
    """
    query = _build_query(limit=10)

    assert "total_rating" in query
    assert "total_rating_count" in query


# --- The upstream score -----------------------------------------------------


def test_an_upstream_score_is_read_off_the_payload() -> None:
    record = games_import._record_from_igdb(
        {"id": 7, "name": "Scored", "total_rating": 87, "total_rating_count": 1204}
    )

    # Coerced to float: IGDB sends a bare int for a whole score.
    assert record.igdb_rating == pytest.approx(87.0)
    assert isinstance(record.igdb_rating, float)
    assert record.igdb_rating_count == 1204


def test_a_game_nobody_scored_carries_no_score() -> None:
    """IGDB omits the keys rather than sending null, so `.get` is load-bearing."""
    record = games_import._record_from_igdb({"id": 7, "name": "Unscored"})

    assert record.igdb_rating is None
    assert record.igdb_rating_count is None


async def test_a_changed_score_is_refreshed_on_the_next_sync(db: AsyncSession) -> None:
    """The failure this guards is invisible on create and only shows on re-import."""
    await upsert_games(
        db,
        [GameRecord(external_id="77", title="Scored", igdb_rating=71.0, igdb_rating_count=300)],
        source=IGDB_SOURCE,
    )
    await upsert_games(
        db,
        [GameRecord(external_id="77", title="Scored", igdb_rating=88.5, igdb_rating_count=1500)],
        source=IGDB_SOURCE,
    )

    game = (await db.execute(sa.select(Game).where(Game.external_id == "77"))).scalar_one()
    assert game.igdb_rating == pytest.approx(88.5)
    assert game.igdb_rating_count == 1500


async def test_a_withdrawn_score_is_cleared_rather_than_kept(db: AsyncSession) -> None:
    """IGDB drops `total_rating` when a game falls back under its threshold.

    Assigning unconditionally is what lets that reach us. A `is not None` guard
    would make the first score a game ever had permanent.
    """
    await upsert_games(
        db,
        [GameRecord(external_id="78", title="Faded", igdb_rating=64.0, igdb_rating_count=12)],
        source=IGDB_SOURCE,
    )
    await upsert_games(db, [GameRecord(external_id="78", title="Faded")], source=IGDB_SOURCE)

    game = (await db.execute(sa.select(Game).where(Game.external_id == "78"))).scalar_one()
    assert game.igdb_rating is None
    assert game.igdb_rating_count is None


def test_the_offline_fixture_carries_scores_and_gaps() -> None:
    """Both render branches need to be reachable with no IGDB account."""
    records = load_seed_records()

    assert any(record.igdb_rating is not None for record in records)
    assert any(record.igdb_rating is None for record in records)
    assert all(
        0 <= record.igdb_rating <= 100 for record in records if record.igdb_rating is not None
    )


async def test_our_own_average_is_not_the_import_s_business(db: AsyncSession) -> None:
    """`rating_average` belongs to reviews; a catalog sync must not touch it."""
    await upsert_games(
        db,
        [GameRecord(external_id="79", title="Ours", igdb_rating=90.0)],
        source=IGDB_SOURCE,
    )

    game = (await db.execute(sa.select(Game).where(Game.external_id == "79"))).scalar_one()
    assert game.rating_average is None
    assert game.rating_count == 0


# --- Walking the whole catalog ----------------------------------------------


@pytest.fixture
def igdb(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """A fake IGDB that serves games 1..N by id. Returns the queries it was sent.

    The credentials are pinned on so the configuration guard passes, and the
    transport is local, so none of this leaves the machine.
    """
    monkeypatch.setattr(settings, "igdb_client_id", "client")
    monkeypatch.setattr(settings, "igdb_client_secret", "secret")
    # The real pacing is four requests a second; the suite should not spend three
    # seconds proving that twelve pages arrive.
    monkeypatch.setattr(games_import, "IGDB_MIN_REQUEST_INTERVAL", 0)

    queries: list[str] = []
    catalog_size = 5

    def handle(request: httpx.Request) -> httpx.Response:
        if request.url.host == "id.twitch.tv":
            return httpx.Response(200, json={"access_token": "token"})

        query = request.content.decode()
        queries.append(query)
        after = int(re.search(r"id > (\d+)", query).group(1))  # type: ignore[union-attr]
        limit = int(re.search(r"limit (\d+)", query).group(1))  # type: ignore[union-attr]
        ids = [game_id for game_id in range(1, catalog_size + 1) if game_id > after][:limit]
        return httpx.Response(
            200, json=[{"id": game_id, "name": f"Game {game_id}"} for game_id in ids]
        )

    monkeypatch.setattr(
        games_import,
        "_new_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handle)),
    )
    return queries


async def _drain(**kwargs: object) -> list[tuple[list[GameRecord], int]]:
    return [page async for page in iter_igdb_records(**kwargs)]  # type: ignore[arg-type]


@pytest.mark.usefixtures("igdb")
async def test_a_full_sync_walks_past_the_first_page() -> None:
    """The whole point of --all: one call, every page, in id order."""
    pages = await _drain(page_size=2)

    assert [record.external_id for records, _ in pages for record in records] == [
        "1",
        "2",
        "3",
        "4",
        "5",
    ]


@pytest.mark.usefixtures("igdb")
async def test_a_full_sync_stops_at_the_end_of_the_catalog() -> None:
    # A short page means there is no more, so asking again would be a wasted
    # round trip — and an empty one would loop forever if it were not checked.
    pages = await _drain(page_size=2)

    assert len(pages) == 3


@pytest.mark.usefixtures("igdb")
async def test_a_full_sync_reports_the_id_to_resume_from() -> None:
    """A run this long gets interrupted; the last id is what makes that cheap."""
    pages = await _drain(page_size=2)

    assert [last_id for _, last_id in pages] == [2, 4, 5]


@pytest.mark.usefixtures("igdb")
async def test_resuming_asks_only_for_what_comes_after() -> None:
    pages = await _drain(page_size=2, after_id=3)

    assert [record.external_id for records, _ in pages for record in records] == ["4", "5"]


@pytest.mark.usefixtures("igdb")
async def test_a_trial_run_can_stop_early() -> None:
    pages = await _drain(page_size=2, max_pages=1)

    assert len(pages) == 1


async def test_a_full_sync_paces_itself(igdb: list[str], monkeypatch: pytest.MonkeyPatch) -> None:
    """IGDB allows four requests a second, and a full sync is ~700 of them."""
    monkeypatch.setattr(games_import, "IGDB_MIN_REQUEST_INTERVAL", 0.05)
    started = time.perf_counter()

    await _drain(page_size=2)

    # Three pages, so two gaps: the first request does not wait for a turn.
    assert time.perf_counter() - started >= 0.1


@pytest.mark.usefixtures("unconfigured")
async def test_a_full_sync_without_credentials_says_so() -> None:
    with pytest.raises(IgdbNotConfiguredError):
        await _drain(page_size=2)


# --- Dropping the catalog ---------------------------------------------------


async def test_counting_the_catalog_reports_what_a_drop_would_take(
    db: AsyncSession,
    catalog: list[Game],
    make_user: Callable[..., Awaitable[User]],
    make_review: Callable[..., Awaitable[Review]],
) -> None:
    author = await make_user("ripley")
    await make_review(author)
    db.add(BacklogItem(user_id=author.id, game_id=catalog[0].id, status=BacklogStatus.PLAYING))
    db.add(FavoriteGame(user_id=author.id, game_id=catalog[1].id, position=0))
    await db.flush()

    contents = await count_catalog(db)

    assert contents.games == SEED_GAME_COUNT
    assert (contents.reviews, contents.backlog_items, contents.favorites) == (1, 1, 1)
    assert contents.user_content == 3
    # Counting is what the confirmation prompt reads from, so it must not delete.
    assert (await db.execute(sa.select(sa.func.count(Game.id)))).scalar_one() == SEED_GAME_COUNT


async def test_dropping_the_catalog_takes_the_rows_that_reference_it(
    db: AsyncSession,
    catalog: list[Game],
    make_user: Callable[..., Awaitable[User]],
    make_review: Callable[..., Awaitable[Review]],
) -> None:
    """Every game reference is ON DELETE CASCADE — the flag has to own that."""
    author = await make_user("hudson")
    await make_review(author)
    await db.flush()

    contents = await delete_all_games(db)

    assert contents.games == SEED_GAME_COUNT
    assert contents.reviews == 1
    assert (await db.execute(sa.select(sa.func.count(Game.id)))).scalar_one() == 0
    assert (await db.execute(sa.select(sa.func.count(Review.id)))).scalar_one() == 0
    # The account itself is not catalog data and stays signed up.
    assert await db.get(User, author.id) is not None


async def test_dropping_leaves_the_taxonomy_for_the_next_import(
    db: AsyncSession, catalog: list[Game]
) -> None:
    # Genres and platforms are unowned lookup rows keyed by slug, and the next
    # import resolves them by slug either way. Deleting them buys nothing.
    await delete_all_games(db)

    assert (await db.execute(sa.select(sa.func.count(Genre.id)))).scalar_one() > 0


async def test_dropping_an_empty_catalog_is_a_no_op(db: AsyncSession) -> None:
    contents = await delete_all_games(db)

    assert contents.games == 0


async def test_importing_after_a_drop_starts_from_nothing(
    db: AsyncSession, catalog: list[Game]
) -> None:
    """The pairing the flag exists for: a wipe, then a sync that creates rather
    than updates, so no stale seed row survives with its best-effort metadata."""
    await delete_all_games(db)

    result = await upsert_games(db, load_seed_records(), source=SEED_SOURCE)

    assert result.games_created == SEED_GAME_COUNT
    assert result.games_updated == 0


# --- Running totals ---------------------------------------------------------


def test_merging_page_results_adds_them_up() -> None:
    """--all reports one figure for a run that committed several hundred times."""
    total = ImportResult(source=IGDB_SOURCE, games_created=2, skipped=["7"])
    total.merge(ImportResult(source=IGDB_SOURCE, games_created=3, games_updated=1, skipped=["9"]))

    assert (total.games_created, total.games_updated) == (5, 1)
    assert total.skipped == ["7", "9"]


# --- The CLI's argument combinations ----------------------------------------


@pytest.mark.parametrize(
    ("argv", "expected"),
    [
        (["--all"], "--igdb"),
        (["--igdb", "--all", "--offset", "500"], "--after-id"),
        (["--igdb", "--limit", "501"], "caps a page"),
        (["--igdb", "--limit", "0"], "at least 1"),
        (["--igdb", "--all", "--max-pages", "0"], "at least 1"),
        (["--yes"], "nothing to confirm"),
    ],
)
def test_the_cli_explains_an_impossible_combination(
    argv: list[str], expected: str, capsys: pytest.CaptureFixture[str]
) -> None:
    """Each of these would otherwise fail hours in, or quietly do the wrong thing."""
    assert import_games_cli.main(argv) == 2

    assert expected in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [["--igdb", "--all"], ["--igdb", "--limit", "500"], ["--drop-existing", "--yes"], []],
    ids=["full sync", "one page", "drop then seed", "plain seed"],
)
def test_the_cli_accepts_the_documented_combinations(argv: list[str]) -> None:
    assert import_games_cli._reject_bad_combinations(import_games_cli._parse_args(argv)) is None
