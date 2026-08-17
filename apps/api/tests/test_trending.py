"""Trending scores and the Discover tab — SPEC §6.5, §6.11."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.cli import trending as trending_cli
from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus
from app.models.game import Game, TrendingScore
from app.models.review import Review
from app.models.user import User
from app.schemas.game import TrendingWindow
from app.services.trending import WEIGHT_BACKLOG_ADD, WEIGHT_REVIEW, recompute_trending_scores

TRENDING = "/api/v1/games/trending"
DISCOVER = "/api/v1/games/discover"


async def _review(db: AsyncSession, user: User, game: Game, *, age: timedelta) -> Review:
    review = Review(user_id=user.id, game_id=game.id, rating=8)
    db.add(review)
    await db.flush()
    # created_at is a server default, so backdating has to happen after insert.
    review.created_at = datetime.now(UTC) - age
    await db.flush()
    return review


# --- Recompute -------------------------------------------------------------


async def test_recompute_scores_recent_activity(
    db: AsyncSession, make_user, catalog: list[Game]
) -> None:
    user = await make_user("logger")
    hot, cold = catalog[0], catalog[1]
    await _review(db, user, hot, age=timedelta(hours=1))
    db.add(BacklogItem(user_id=user.id, game_id=hot.id, status=BacklogStatus.PLAYING))
    await db.flush()

    written = await recompute_trending_scores(db, window=TrendingWindow.WEEK)

    assert written == 1
    score = await db.get(TrendingScore, (hot.id, TrendingWindow.WEEK.value))
    assert score is not None
    assert score.score == WEIGHT_REVIEW + WEIGHT_BACKLOG_ADD
    assert await db.get(TrendingScore, (cold.id, TrendingWindow.WEEK.value)) is None


async def test_activity_outside_the_window_does_not_count(
    db: AsyncSession, make_user, catalog: list[Game]
) -> None:
    user = await make_user("logger")
    await _review(db, user, catalog[0], age=timedelta(days=40))

    assert await recompute_trending_scores(db, window=TrendingWindow.WEEK) == 0
    assert await recompute_trending_scores(db, window=TrendingWindow.MONTH) == 0


async def test_recompute_replaces_the_previous_run(
    db: AsyncSession, make_user, catalog: list[Game]
) -> None:
    """A game that went quiet has to drop out, not linger at its old score."""
    user = await make_user("logger")
    review = await _review(db, user, catalog[0], age=timedelta(hours=1))
    await recompute_trending_scores(db, window=TrendingWindow.WEEK)

    await db.delete(review)
    await db.flush()
    await recompute_trending_scores(db, window=TrendingWindow.WEEK)

    assert await db.get(TrendingScore, (catalog[0].id, TrendingWindow.WEEK.value)) is None


async def test_windows_are_scored_independently(
    db: AsyncSession, make_user, catalog: list[Game]
) -> None:
    user = await make_user("logger")
    await _review(db, user, catalog[0], age=timedelta(days=3))

    await recompute_trending_scores(db, window=TrendingWindow.DAY)
    await recompute_trending_scores(db, window=TrendingWindow.WEEK)

    assert await db.get(TrendingScore, (catalog[0].id, TrendingWindow.DAY.value)) is None
    assert await db.get(TrendingScore, (catalog[0].id, TrendingWindow.WEEK.value)) is not None


# --- The CLI ---------------------------------------------------------------

# Argument logic only, the same way `test_games_import.py` covers its CLI. The
# run itself opens `SessionLocal`, which is a different connection from the one
# each test's transaction is held open on, so it would see none of the seeded
# activity; `recompute_trending_scores` is covered directly above instead.


def _asked_for(argv: list[str]) -> list[TrendingWindow]:
    return trending_cli._windows(trending_cli._parse_args(argv))


async def test_the_cli_defaults_to_one_window() -> None:
    assert _asked_for([]) == [TrendingWindow.WEEK]
    assert _asked_for(["--window", "24h"]) == [TrendingWindow.DAY]


async def test_all_windows_covers_every_window_the_api_serves() -> None:
    """The scheduled job runs this form; a missed window returns [] forever."""
    assert _asked_for(["--all-windows"]) == list(TrendingWindow)


async def test_a_single_window_and_all_windows_cannot_be_combined() -> None:
    """Accepting both would silently ignore one of them."""
    with pytest.raises(SystemExit) as exit_info:
        trending_cli._parse_args(["--window", "24h", "--all-windows"])
    assert exit_info.value.code == 2


# --- The endpoint ----------------------------------------------------------


async def test_trending_is_empty_before_the_job_has_run(
    client: AsyncClient, catalog: list[Game]
) -> None:
    """No fallback to an arbitrary list — a made-up ranking is worse than none."""
    response = await client.get(TRENDING)

    assert response.status_code == 200
    assert response.json() == []


async def test_trending_returns_the_materialised_ranking(
    client: AsyncClient, db: AsyncSession, make_user, catalog: list[Game]
) -> None:
    user = await make_user("logger")
    top, second = catalog[0], catalog[1]
    await _review(db, user, top, age=timedelta(hours=1))
    db.add(BacklogItem(user_id=user.id, game_id=second.id, status=BacklogStatus.TO_BE_PLAYED))
    await db.flush()
    await recompute_trending_scores(db, window=TrendingWindow.WEEK)

    body = (await client.get(TRENDING)).json()

    assert [entry["game"]["id"] for entry in body] == [str(top.id), str(second.id)]
    assert body[0]["score"] > body[1]["score"]
    assert body[0]["window"] == "7d"


async def test_an_unknown_window_is_rejected(client: AsyncClient) -> None:
    assert (await client.get(TRENDING, params={"window": "forever"})).status_code == 422


async def test_browsing_by_trending_puts_unranked_games_last(
    client: AsyncClient, db: AsyncSession, make_user, catalog: list[Game]
) -> None:
    user = await make_user("logger")
    await _review(db, user, catalog[3], age=timedelta(hours=1))
    await recompute_trending_scores(db, window=TrendingWindow.WEEK)

    body = (await client.get("/api/v1/games", params={"sort": "trending", "limit": 50})).json()

    assert body["items"][0]["id"] == str(catalog[3].id)
    assert len(body["items"]) == len(catalog), "unranked games must still be browsable"


# --- Discover --------------------------------------------------------------


async def test_discover_returns_every_section_in_one_call(
    client: AsyncClient, catalog: list[Game]
) -> None:
    response = await client.get(DISCOVER)

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"trending", "new_releases", "recommended", "genres", "platforms"}
    assert body["new_releases"], "the seed catalog has dated games"
    assert body["genres"] and body["platforms"], "browse facets drive the filter UI"


async def test_new_releases_are_newest_first_and_exclude_undated_games(
    client: AsyncClient, db: AsyncSession, catalog: list[Game]
) -> None:
    db.add(Game(title="Someday", slug="someday", release_date=None))
    await db.flush()

    body = (await client.get(DISCOVER)).json()

    dates = [card["release_date"] for card in body["new_releases"]]
    assert all(dates)
    assert dates == sorted(dates, reverse=True)


async def test_new_releases_exclude_games_that_have_not_shipped(
    client: AsyncClient, db: AsyncSession, catalog: list[Game]
) -> None:
    """Upstream dates announcements years out, and they would sort to the top."""
    db.add(Game(title="Vaporware", slug="vaporware", release_date=date(2999, 1, 1)))
    await db.flush()

    body = (await client.get(DISCOVER)).json()

    today = datetime.now(UTC).date().isoformat()
    assert "Vaporware" not in [card["title"] for card in body["new_releases"]]
    assert all(card["release_date"] <= today for card in body["new_releases"])


async def test_new_releases_include_a_game_released_today(
    client: AsyncClient, db: AsyncSession, catalog: list[Game]
) -> None:
    """The cutoff is inclusive: a release day is a day, not an instant."""
    today = datetime.now(UTC).date()
    db.add(Game(title="Out Now", slug="out-now", release_date=today))
    await db.flush()

    body = (await client.get(DISCOVER)).json()

    assert body["new_releases"][0]["title"] == "Out Now"


async def test_recommendations_are_an_honest_stub(
    client: AsyncClient, registered_user: dict[str, object], catalog: list[Game]
) -> None:
    """Personalisation needs the ratings that arrive with the reviews slice."""
    response = await client.get(
        DISCOVER, headers={"Authorization": f"Bearer {registered_user['access_token']}"}
    )

    assert response.json()["recommended"] == []
