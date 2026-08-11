"""Personalised recommendations (SPEC §6.4, §6.5).

Two signals, kept apart and then blended:

* **Content** — the genres the viewer has told us they like, by pinning a game to
  their profile (SPEC §6.2) or by rating one highly. A candidate scores the sum
  of the affinities of the genres it shares with them.
* **Collaborative** — games rated highly by the people whose ratings agree with
  the viewer's. Agreement is measured per co-rated game and summed, so somebody
  who has rated forty of the same games the same way outranks somebody who
  happened to agree about one.

Both are ordinary aggregate SQL. There is no model to train, nothing to persist
and no new dependency, which is what makes the output reproducible: the same rows
in, the same ranking out, every time. That property is what the tests are written
against, and it is worth more here than a better ranking would be — a
recommendation nobody can explain is one nobody can fix.

Each signal is rescaled to 0..1 before the two are added, so the weights below
mean what they look like they mean. Without it the blend would be settled by
whichever signal happened to produce the larger raw numbers, and since one counts
genre overlaps while the other sums similarities, that is not a comparison of
anything.

**A viewer with nothing to go on gets the fallback, not an empty list.** Cold
start is what is hot now (SPEC §6.11's trending) topped up with what has always
been popular, minus anything they already know about. Signed-out Discover takes
the same path, so the tab is never empty for a visitor and never errors for a
brand-new account.

This module only ever *reads*. It is shared by `app.services.games` (the Discover
section) and `app.services.feed` (the blend and the suggested accounts), which is
why it is not inside either of them: a second copy of the scoring in the feed is
the one way those two surfaces could start disagreeing about what the viewer
likes.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.models.backlog import BacklogItem
from app.models.game import Game, game_genres
from app.models.review import Review
from app.models.user import FavoriteGame, User
from app.services.trending import list_trending

# Where SPEC §6.3's 1-10 scale turns positive: 7 is 3.5 stars. Below it a rating
# says the viewer played the game, not that they want another one like it.
LIKED_RATING = 7

# How much a liked game says about a genre: 1 at the threshold, 4 at full marks.
# A pinned favorite counts as much as a 10, because SPEC §6.2 makes the favorites
# list a deliberate, capped, curated choice rather than a rating among hundreds.
FAVORITE_WEIGHT = 4.0

# Two ratings this far apart on the 1-10 scale carry no agreement at all; closer
# than that, agreement falls off linearly. Four points is two whole stars — far
# enough that "we both liked it" still counts, near enough that one person's 9
# and another's 4 is not treated as taste in common.
AGREEMENT_TOLERANCE = 4.0

# Content leads. Collaborative filtering is the stronger signal at scale and the
# weaker one on a young instance, where a handful of overlapping ratings can make
# two people look alike by accident; genre affinity comes straight from what the
# viewer said about themselves and degrades more gracefully.
CONTENT_WEIGHT = 0.6
COLLABORATIVE_WEIGHT = 0.4

# Bounds on the work. The neighbourhood is capped so one very active account
# cannot drag the ranking, and each signal contributes at most this many
# candidates — far more than any surface shows, few enough that the blend is a
# dictionary operation rather than a table scan in Python.
NEIGHBOUR_LIMIT = 25
CANDIDATE_POOL = 200

# How deep the cold-start sources are read before known games are removed, so a
# viewer with a long backlog still gets a full section back.
FALLBACK_POOL = 50


# --- What the viewer already knows about ------------------------------------


def _known_games(viewer_id: uuid.UUID) -> sa.Select[tuple[uuid.UUID]]:
    """Games there is no point recommending, because the viewer has one already.

    Reviewed and backlogged are the two SPEC §6.5 implies. Favorites are here for
    the same reason and not a third rule: pinning a game to your profile is the
    strongest possible statement that you have played it, and being told to try
    your own favorite is the one recommendation that makes the whole section look
    broken.
    """
    known = sa.union(
        sa.select(Review.game_id).where(Review.user_id == viewer_id),
        sa.select(BacklogItem.game_id).where(BacklogItem.user_id == viewer_id),
        sa.select(FavoriteGame.game_id).where(FavoriteGame.user_id == viewer_id),
    ).subquery("known_games")
    return sa.select(known.c.game_id)


async def _known_game_ids(db: AsyncSession, viewer_id: uuid.UUID | None) -> set[uuid.UUID]:
    """The same set, materialised, for the fallback — which ranks before it filters."""
    if viewer_id is None:
        return set()
    return set((await db.scalars(_known_games(viewer_id))).all())


# --- Content signal (SPEC §6.5: "favorite genres") --------------------------


def _content_statement(viewer_id: uuid.UUID) -> sa.Select[tuple[uuid.UUID, float]]:
    """Candidate games scored by how much of the viewer's taste in genres they share.

    The affinity per genre is built inline rather than fetched and pushed back as
    a bind parameter list: it is a grouped subquery over two small tables, and
    keeping it in the statement means one round trip and no chance of the pool
    being scored against a profile that has since changed.
    """
    rated = (
        sa.select(
            game_genres.c.genre_id.label("genre_id"),
            sa.cast(Review.rating - LIKED_RATING + 1, sa.Float).label("weight"),
        )
        .select_from(Review)
        .join(game_genres, game_genres.c.game_id == Review.game_id)
        .where(Review.user_id == viewer_id, Review.rating >= LIKED_RATING)
    )
    pinned = (
        sa.select(
            game_genres.c.genre_id.label("genre_id"),
            sa.literal(FAVORITE_WEIGHT, type_=sa.Float()).label("weight"),
        )
        .select_from(FavoriteGame)
        .join(game_genres, game_genres.c.game_id == FavoriteGame.game_id)
        .where(FavoriteGame.user_id == viewer_id)
    )
    signals = sa.union_all(rated, pinned).subquery("genre_signals")
    weights = (
        sa.select(
            signals.c.genre_id.label("genre_id"),
            sa.func.sum(signals.c.weight).label("weight"),
        )
        .group_by(signals.c.genre_id)
        .subquery("genre_affinity")
    )

    score = sa.func.sum(weights.c.weight)
    return (
        sa.select(game_genres.c.game_id, score.label("score"))
        .join(weights, weights.c.genre_id == game_genres.c.genre_id)
        .where(game_genres.c.game_id.not_in(_known_games(viewer_id)))
        .group_by(game_genres.c.game_id)
        .order_by(score.desc(), game_genres.c.game_id.desc())
        .limit(CANDIDATE_POOL)
    )


# --- Collaborative signal (SPEC §6.5: "similar users") ----------------------


def _similarity_statement(viewer_id: uuid.UUID) -> sa.Select[tuple[uuid.UUID, float]]:
    """Accounts whose ratings agree with the viewer's, most alike first.

    Similarity is a *sum* of per-game agreement rather than an average, so it
    grows with how much two people have actually compared. An average would rank
    a stranger who agreed about one game above a twin who agreed about thirty and
    differed about the thirty-first, which is the wrong way round for a
    suggestion.
    """
    mine = aliased(Review, name="mine")
    theirs = aliased(Review, name="theirs")

    distance = sa.func.abs(mine.rating - theirs.rating)
    agreement = sa.func.greatest(
        sa.literal(0.0),
        sa.literal(1.0) - sa.cast(distance, sa.Float) / sa.literal(AGREEMENT_TOLERANCE),
    )
    similarity = sa.func.sum(agreement)

    return (
        sa.select(theirs.user_id.label("user_id"), similarity.label("similarity"))
        .select_from(mine)
        .join(theirs, sa.and_(theirs.game_id == mine.game_id, theirs.user_id != viewer_id))
        .join(User, User.id == theirs.user_id)
        .where(mine.user_id == viewer_id, User.is_active.is_(True))
        .group_by(theirs.user_id)
        # Agreeing about nothing is not a neighbour, and carrying those rows into
        # the candidate query would multiply every score by zero for no reason.
        .having(similarity > 0)
        .order_by(similarity.desc(), theirs.user_id.desc())
        .limit(NEIGHBOUR_LIMIT)
    )


def _collaborative_statement(viewer_id: uuid.UUID) -> sa.Select[tuple[uuid.UUID, float]]:
    """Candidate games scored by how much the viewer's neighbours liked them."""
    neighbours = _similarity_statement(viewer_id).subquery("neighbours")

    enthusiasm = sa.cast(Review.rating - LIKED_RATING + 1, sa.Float)
    score = sa.func.sum(neighbours.c.similarity * enthusiasm)

    return (
        sa.select(Review.game_id, score.label("score"))
        .join(neighbours, neighbours.c.user_id == Review.user_id)
        .where(
            Review.rating >= LIKED_RATING,
            Review.game_id.not_in(_known_games(viewer_id)),
        )
        .group_by(Review.game_id)
        .order_by(score.desc(), Review.game_id.desc())
        .limit(CANDIDATE_POOL)
    )


async def similar_users(
    db: AsyncSession, viewer_id: uuid.UUID, *, limit: int
) -> Sequence[uuid.UUID]:
    """The neighbourhood on its own — who to suggest following (SPEC §6.4).

    Returns ids and not users: whether any of these accounts is *eligible* to be
    suggested is a question about the follow graph and about privacy, and
    `app.services.feed` is what owns that.
    """
    neighbours = _similarity_statement(viewer_id).subquery("neighbours")
    ordered = (
        sa.select(neighbours.c.user_id)
        # Re-stated because a subquery's ordering is not something to rely on.
        .order_by(neighbours.c.similarity.desc(), neighbours.c.user_id.desc())
        .limit(limit)
    )
    return list((await db.scalars(ordered)).all())


# --- Blending ---------------------------------------------------------------


async def _scores(
    db: AsyncSession, statement: sa.Select[tuple[uuid.UUID, float]]
) -> dict[uuid.UUID, float]:
    return {row[0]: float(row[1]) for row in (await db.execute(statement)).all()}


def _normalised(scores: dict[uuid.UUID, float]) -> dict[uuid.UUID, float]:
    """Rescale one signal to 0..1 so the blend weights mean what they say.

    An empty or entirely non-positive signal contributes nothing rather than
    dividing by zero, which is also the right answer: it has no opinion, so the
    other signal decides.
    """
    top = max(scores.values(), default=0.0)
    if top <= 0.0:
        return {}
    return {game_id: score / top for game_id, score in scores.items()}


async def _blended_ids(db: AsyncSession, viewer_id: uuid.UUID, *, limit: int) -> list[uuid.UUID]:
    content = _normalised(await _scores(db, _content_statement(viewer_id)))
    collaborative = _normalised(await _scores(db, _collaborative_statement(viewer_id)))

    blended = {
        game_id: CONTENT_WEIGHT * content.get(game_id, 0.0)
        + COLLABORATIVE_WEIGHT * collaborative.get(game_id, 0.0)
        for game_id in content.keys() | collaborative.keys()
    }
    # Ties break on the id, descending, which is what every other ranked list
    # here does — `uuid.bytes` orders the same way Postgres orders the column, so
    # the fallback below and this ranking agree about what "then by id" means.
    ordered = sorted(blended.items(), key=lambda row: (row[1], row[0].bytes), reverse=True)
    return [game_id for game_id, _ in ordered[:limit]]


# --- Cold start (SPEC §6.5) -------------------------------------------------


def _popular_statement(limit: int) -> sa.Select[tuple[uuid.UUID]]:
    """Popular all-time (SPEC §6.5): most reviewed, best liked among those.

    The count leads and the average breaks its ties, in that order on purpose. A
    single 10/10 is not evidence of anything, and ranking by rating alone would
    put it above a game four hundred people scored 9.
    """
    return (
        sa.select(Review.game_id)
        .group_by(Review.game_id)
        .order_by(
            sa.func.count().desc(),
            sa.func.avg(Review.rating).desc(),
            Review.game_id.desc(),
        )
        .limit(limit)
    )


async def _fallback_ids(
    db: AsyncSession, viewer_id: uuid.UUID | None, *, limit: int
) -> list[uuid.UUID]:
    """What to show somebody we know nothing about yet.

    Hot first, then popular all-time behind it, because "what people are playing
    this week" is a better first impression than "what people have always
    played" — and the second is only there so a quiet week still fills the row.

    Both are read deep and filtered afterwards: a viewer can be cold on ratings
    and still have thirty games on a list, and truncating before excluding those
    would hand back a short section for no reason.

    Deliberately not topped up from the catalog when there is no activity at all
    to rank. An arbitrary slice of games presented as a recommendation is worse
    than an empty section that says why it is empty, and Discover already has a
    New Releases row for exactly that case.
    """
    ranked = [game.id for game, _ in await list_trending(db, limit=FALLBACK_POOL)]
    seen = set(ranked)
    ranked += [
        game_id
        for game_id in (await db.scalars(_popular_statement(FALLBACK_POOL))).all()
        if game_id not in seen
    ]

    known = await _known_game_ids(db, viewer_id)
    return [game_id for game_id in ranked if game_id not in known][:limit]


# --- The two things other modules call --------------------------------------


async def recommended_game_ids(
    db: AsyncSession, viewer_id: uuid.UUID | None, *, limit: int
) -> list[uuid.UUID]:
    """Games to put in front of this viewer, best first.

    Ids rather than rows, because the feed blend wants them for a WHERE clause
    and only Discover needs the games themselves.

    An anonymous viewer, or one whose taste matches nothing left to recommend,
    lands on the fallback. There is no error path: a Discover tab that 500s
    because the reader has not rated anything yet would be a strange thing to
    ship.
    """
    if viewer_id is not None:
        blended = await _blended_ids(db, viewer_id, limit=limit)
        if blended:
            return blended
    return await _fallback_ids(db, viewer_id, limit=limit)


async def recommend_games(
    db: AsyncSession, viewer_id: uuid.UUID | None, *, limit: int
) -> Sequence[Game]:
    """The Discover section from SPEC §6.5, in ranked order.

    One query for the whole row, with the same eager loads a catalog read uses,
    then reordered in Python — `IN` does not preserve the order it was given, and
    the order is the entire point of a ranking.
    """
    ranked = await recommended_game_ids(db, viewer_id, limit=limit)
    if not ranked:
        return []

    found = await db.scalars(
        sa.select(Game)
        .where(Game.id.in_(ranked))
        .options(selectinload(Game.genres), selectinload(Game.platforms))
    )
    by_id = {game.id: game for game in found.all()}
    return [by_id[game_id] for game_id in ranked if game_id in by_id]
