"""Trending games (SPEC §6.5, §6.11).

Trending is *materialised*, not computed per request: `recompute_trending_scores`
writes one row per game per window into `trending_scores`, and the Discover tab
only ever reads that table. SPEC §6.11 specifies a scheduled worker; until the
queue exists `.github/workflows/trending.yml` runs `python -m app.cli.trending
--all-windows` daily, and the CLI is also the manual path.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.backlog import BacklogItem
from app.models.game import Game, TrendingScore
from app.models.review import Like, Review
from app.schemas.game import TrendingWindow

DEFAULT_TRENDING_WINDOW = TrendingWindow.WEEK

# How far back each window reaches. The set of windows itself is `TrendingWindow`,
# which is what the endpoints validate against.
TRENDING_WINDOWS: dict[TrendingWindow, timedelta] = {
    TrendingWindow.DAY: timedelta(hours=24),
    TrendingWindow.WEEK: timedelta(days=7),
    TrendingWindow.MONTH: timedelta(days=30),
}

# TODO(trending worker): SPEC §6.11 wants recency decay and per-signal weights
# tuned against real traffic. These flat weights are a placeholder that ranks
# sensibly but treats an event on day 1 exactly like one on day 7.
WEIGHT_REVIEW = 3.0
WEIGHT_BACKLOG_ADD = 1.0
WEIGHT_LIKE = 0.5


async def list_trending(
    db: AsyncSession, *, window: TrendingWindow = DEFAULT_TRENDING_WINDOW, limit: int = 20
) -> Sequence[tuple[Game, float]]:
    """Read the materialised ranking. Empty until the recompute job has run."""
    statement = (
        sa.select(Game, TrendingScore.score)
        .join(TrendingScore, TrendingScore.game_id == Game.id)
        .where(TrendingScore.window == window, TrendingScore.score > 0)
        .options(selectinload(Game.genres), selectinload(Game.platforms))
        .order_by(TrendingScore.score.desc(), Game.id.desc())
        .limit(limit)
    )
    rows = (await db.execute(statement)).all()
    return [(row[0], float(row[1])) for row in rows]


def _activity_since(window: TrendingWindow) -> datetime:
    return datetime.now(UTC) - TRENDING_WINDOWS[window]


async def recompute_trending_scores(
    db: AsyncSession, *, window: TrendingWindow = DEFAULT_TRENDING_WINDOW
) -> int:
    """Aggregate recent activity into one score per game. Returns rows written.

    Rewrites the whole window rather than upserting: a game that stopped being
    active must drop out, and at catalog scale a full rewrite inside one
    transaction is cheaper to reason about than reconciling deletions.
    """
    since = _activity_since(window)

    reviews = (
        sa.select(
            Review.game_id.label("game_id"),
            (sa.func.count() * WEIGHT_REVIEW).label("score"),
        )
        .where(Review.created_at >= since)
        .group_by(Review.game_id)
    )
    backlog_adds = (
        sa.select(
            BacklogItem.game_id.label("game_id"),
            (sa.func.count() * WEIGHT_BACKLOG_ADD).label("score"),
        )
        .where(BacklogItem.created_at >= since)
        .group_by(BacklogItem.game_id)
    )
    likes = (
        sa.select(
            Review.game_id.label("game_id"),
            (sa.func.count() * WEIGHT_LIKE).label("score"),
        )
        .join(Like, Like.review_id == Review.id)
        .where(Like.created_at >= since)
        .group_by(Review.game_id)
    )

    weighted = sa.union_all(reviews, backlog_adds, likes).subquery("weighted")
    totals = (
        sa.select(weighted.c.game_id, sa.func.sum(weighted.c.score).label("score"))
        .group_by(weighted.c.game_id)
        .subquery("totals")
    )

    await db.execute(sa.delete(TrendingScore).where(TrendingScore.window == window))
    await db.execute(
        # computed_at is left to its server default so every row in a run shares
        # the database clock rather than the worker's.
        sa.insert(TrendingScore).from_select(
            ["game_id", "window", "score"],
            sa.select(
                totals.c.game_id, sa.literal(window.value, type_=sa.String()), totals.c.score
            ),
        )
    )
    written = await db.scalar(
        sa.select(sa.func.count()).select_from(TrendingScore).where(TrendingScore.window == window)
    )
    await db.commit()
    return written or 0
