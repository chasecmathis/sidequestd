"""Game and user search (SPEC §6.6).

Matching runs over *normalized keys*: generated columns built by the
`search_normalize` SQL function, which strips accents, case and punctuation
(see app.models.search_keys). So "pokemon" finds "Pokémon" and "spiderman"
finds "Spider-Man". The query goes through the same function, in the database,
so the two sides cannot drift.

A row matches when any of three things holds, each served by a trigram index:
every word of the query appears in its key, in any order; the query with its
spaces removed appears in its key with spaces removed; or it is a close fuzzy
match, which is what catches typos. A query too short to contain a trigram
falls back to a prefix match on a btree instead. Ranking blends text closeness
with popularity for games and with the follow graph for users.

The weights and the measurements behind them are in
`.context/decisions/2026-10-search-relevance.md`, and
`tests/test_search_relevance.py` is what they are tuned against.
"""

from __future__ import annotations

import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute, aliased, selectinload

from app.models.enums import FollowStatus
from app.models.game import Game, GameAlias
from app.models.review import Review
from app.models.social import Follow
from app.models.user import User
from app.services.pagination import (
    DEFAULT_PAGE_SIZE,
    KeysetPage,
    KeysetSort,
    fetch_keyset_page,
)
from app.services.users import content_is_visible_to

# Fuzzy matches need at least this word similarity. 0.5 lets "eldin ring" find
# "Elden Ring" (0.57) without letting unrelated titles in.
FUZZY_THRESHOLD = 0.5

# pg_trgm extracts nothing from a string shorter than this, so an index cannot
# narrow it: a pattern like '%ff%' makes the GIN index hand back every row.
MIN_TRIGRAM_LENGTH = 3

# Text closeness. word_similarity says "the query is in here", which is what a
# half-typed title needs; similarity adds a slight preference for the closer,
# shorter title, so "hades" puts "Hades" above "Hades II".
WORD_SIMILARITY_SHARE = 0.7
# Typing a whole title or handle puts it first, whatever else is popular.
EXACT_MATCH_BONUS = 1.0

# An alias is a slightly weaker claim than the title, and a display name than
# a handle, so an equal match on the stronger one wins.
ALIAS_WEIGHT = 0.95
DISPLAY_NAME_WEIGHT = 0.9

# Popularity, 0..1 on a log scale: IGDB's rating count plus our own reviews,
# which count extra because they are this community's signal. The ceiling is
# roughly where IGDB's most-rated games sit.
POPULARITY_WEIGHT = 0.25
REVIEW_WEIGHT = 5
POPULARITY_CEILING = 5000
_POPULARITY_SCALE = math.log1p(POPULARITY_CEILING)

# Closeness in the follow graph, for a signed-in viewer. Accepted follows only.
FOLLOWING_BOOST = 0.30
FOLLOWER_BOOST = 0.20
FRIEND_OF_FRIEND_BOOST = 0.10
FRIEND_OF_FRIEND_PATH_CAP = 3

SearchColumn = InstrumentedAttribute[Any]


@dataclass(frozen=True, slots=True)
class UserHit:
    """A user search row with the privacy decision already applied.

    `review_count` is None when the account is private and the viewer has not
    been approved — see `search_users`.
    """

    user: User
    review_count: int | None


@dataclass(frozen=True, slots=True)
class NormalizedQuery:
    """What the user typed, as `search_normalize` keys it."""

    key: str

    @property
    def compact(self) -> str:
        return self.key.replace(" ", "")

    @property
    def is_empty(self) -> bool:
        """Nothing searchable was typed: "!!!", or a lone "@"."""
        return not self.key

    @property
    def is_short(self) -> bool:
        """Too short for a trigram index; see MIN_TRIGRAM_LENGTH."""
        return len(self.compact) < MIN_TRIGRAM_LENGTH

    @property
    def long_words(self) -> tuple[str, ...]:
        """The words an index can look up. Shorter ones ("v" in "gta v") are left
        to the compact and fuzzy conditions: as a filter of their own they would
        make the index return every row."""
        return tuple(word for word in self.key.split() if len(word) >= MIN_TRIGRAM_LENGTH)


async def _normalize(db: AsyncSession, raw: str) -> NormalizedQuery:
    """Key `raw` with the database's own function, and set this transaction's
    threshold for the fuzzy `<%` operator, in one round trip.

    `set_config(..., true)` is transaction-local, so the setting cannot leak to
    another request through the connection pool. A leading "@" needs no code
    of its own: it is punctuation, so "@ripley" is keyed `ripley`.
    """
    row = (
        await db.execute(
            sa.select(
                sa.func.search_normalize(raw),
                sa.func.set_config("pg_trgm.word_similarity_threshold", str(FUZZY_THRESHOLD), True),
            )
        )
    ).one()
    return NormalizedQuery(key=row[0] or "")


def _inline(value: str) -> sa.BindParameter[str]:
    """A pattern rendered into the SQL rather than sent as a parameter.

    The trigram and prefix indexes can only be used when the planner can see the
    pattern. A bound parameter hides it whenever Postgres switches a prepared
    statement to its generic plan, which here would be a sequential scan of the
    catalog. Safe to inline: SQLAlchemy quotes it, and a normalized key holds only
    letters, digits and spaces anyway, so it carries no LIKE wildcards either.
    """
    return sa.literal(value, sa.Text, literal_execute=True)


def _matches(
    key: SearchColumn, compact: SearchColumn, q: NormalizedQuery
) -> sa.ColumnElement[bool]:
    if q.is_short:
        return key.like(_inline(f"{q.key}%"))

    conditions: list[sa.ColumnElement[bool]] = [
        compact.like(_inline(f"%{q.compact}%")),
        _inline(q.key).op("<%", is_comparison=True)(key),
    ]
    if q.long_words:
        conditions.append(sa.and_(*(key.like(_inline(f"%{word}%")) for word in q.long_words)))
    return sa.or_(*conditions)


def _text_score(key: SearchColumn, q: NormalizedQuery) -> sa.ColumnElement[float]:
    """How closely `key` matches. NULL when `key` is (an absent display name)."""
    exact = sa.case((key == q.key, EXACT_MATCH_BONUS), else_=0.0)
    similarity = sa.func.similarity(key, q.key, type_=sa.Float)
    if q.is_short:
        return similarity + exact

    word_similarity = sa.func.word_similarity(q.key, key, type_=sa.Float)
    return (
        WORD_SIMILARITY_SHARE * word_similarity + (1 - WORD_SIMILARITY_SHARE) * similarity + exact
    )


# --- Games -----------------------------------------------------------------


def _popularity() -> sa.ColumnElement[float]:
    ratings = sa.func.coalesce(Game.igdb_rating_count, 0) + REVIEW_WEIGHT * Game.rating_count
    return sa.func.least(
        1.0, sa.func.ln(1 + ratings, type_=sa.Float) / _POPULARITY_SCALE, type_=sa.Float
    )


async def search_games(
    db: AsyncSession,
    query: str,
    *,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[Game]:
    q = await _normalize(db, query)
    if q.is_empty:
        return KeysetPage(items=[], next_cursor=None)

    title_hits = sa.select(
        Game.id.label("game_id"), _text_score(Game.search_key, q).label("text")
    ).where(_matches(Game.search_key, Game.search_compact, q))

    if q.is_short:
        # A prefix of an alias is too weak a signal to be worth a second scan.
        matched = title_hits.subquery("matched")
    else:
        alias_hits = sa.select(
            GameAlias.game_id, (ALIAS_WEIGHT * _text_score(GameAlias.search_key, q)).label("text")
        ).where(_matches(GameAlias.search_key, GameAlias.search_compact, q))
        # A UNION rather than `OR EXISTS (alias…)`: an EXISTS inside the OR stops
        # Postgres combining the index scans, and it walks the whole catalog
        # instead (1.5 s against 22 ms at 350k games). Scoring inside each branch
        # rather than per game afterwards keeps a broad query cheap too.
        matched = sa.union_all(title_hits, alias_hits).subquery("matched")

    best = (
        sa.select(matched.c.game_id, sa.func.max(matched.c.text).label("text"))
        .group_by(matched.c.game_id)
        .subquery("best")
    )
    score = best.c.text + POPULARITY_WEIGHT * _popularity()

    statement = (
        sa.select(Game, score)
        .join(best, best.c.game_id == Game.id)
        .options(selectinload(Game.genres), selectinload(Game.platforms))
    )

    return await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=score,
            id_column=Game.id,
            bind_type=sa.Float(),
            parse=float,
            descending=True,
        ),
        cursor=cursor,
        limit=limit,
    )


# --- Users -----------------------------------------------------------------


async def _visible_review_counts(
    db: AsyncSession, user_ids: Sequence[uuid.UUID], viewer_id: uuid.UUID | None
) -> dict[uuid.UUID, int]:
    """Review counts for the subset of `user_ids` whose stats the viewer may see.

    Users missing from the result are gated, which is what turns into a null
    `review_count` on the card. Batched over the whole page — one query, no N+1.
    """
    if not user_ids:
        return {}

    statement = (
        sa.select(User.id, sa.func.count(Review.id))
        .outerjoin(Review, Review.user_id == User.id)
        .where(User.id.in_(user_ids), content_is_visible_to(viewer_id))
        .group_by(User.id)
    )
    return {row[0]: row[1] for row in (await db.execute(statement)).all()}


async def search_users(
    db: AsyncSession,
    query: str,
    *,
    viewer_id: uuid.UUID | None = None,
    cursor: str | None = None,
    limit: int = DEFAULT_PAGE_SIZE,
) -> KeysetPage[UserHit]:
    """Search handles and display names.

    Private accounts are returned — SPEC §6.7 keeps them findable, otherwise
    sending a follow request would be impossible — but everything behind the
    approval gate is withheld, leaving only the shell the card renders.
    """
    q = await _normalize(db, query)
    if q.is_empty:
        return KeysetPage(items=[], next_cursor=None)

    relevance = sa.func.greatest(
        _text_score(User.username_key, q),
        sa.func.coalesce(_text_score(User.display_name_key, q), 0.0) * DISPLAY_NAME_WEIGHT,
        type_=sa.Float,
    )
    candidates = (
        sa.select(User.id.label("user_id"), (relevance + _social_boost(viewer_id)).label("score"))
        .where(
            User.is_active.is_(True),
            sa.or_(
                _matches(User.username_key, User.username_compact, q),
                _matches(User.display_name_key, User.display_name_compact, q),
            ),
        )
        .subquery("candidates")
    )
    statement = sa.select(User, candidates.c.score).join(
        candidates, candidates.c.user_id == User.id
    )

    page = await fetch_keyset_page(
        db,
        statement,
        KeysetSort(
            expression=candidates.c.score,
            id_column=User.id,
            bind_type=sa.Float(),
            parse=float,
            descending=True,
        ),
        cursor=cursor,
        limit=limit,
    )

    counts = await _visible_review_counts(db, [user.id for user in page.items], viewer_id)
    return KeysetPage(
        items=[UserHit(user=user, review_count=counts.get(user.id)) for user in page.items],
        next_cursor=page.next_cursor,
    )


def _social_boost(viewer_id: uuid.UUID | None) -> sa.ColumnElement[float]:
    """How close a candidate sits to the viewer in the follow graph.

    Friend-of-friend paths only run through accounts the viewer follows with an
    *accepted* follow, whose following lists SPEC §6.7 already lets the viewer
    read, so the ordering reveals nothing the viewer could not see on those
    profiles. A pending request counts for nothing, as it unlocks nothing.
    """
    if viewer_id is None:
        return sa.literal(0.0, sa.Float)

    accepted = FollowStatus.ACCEPTED
    viewer_follows = aliased(Follow)
    their_follows = aliased(Follow)

    following = sa.exists().where(
        Follow.follower_id == viewer_id,
        Follow.followee_id == User.id,
        Follow.status == accepted,
    )
    follower = sa.exists().where(
        Follow.follower_id == User.id,
        Follow.followee_id == viewer_id,
        Follow.status == accepted,
    )
    paths = (
        sa.select(sa.func.count())
        .select_from(their_follows)
        .join(viewer_follows, viewer_follows.followee_id == their_follows.follower_id)
        .where(
            viewer_follows.follower_id == viewer_id,
            viewer_follows.status == accepted,
            their_follows.followee_id == User.id,
            their_follows.status == accepted,
        )
        .scalar_subquery()
    )

    boost = (
        sa.case((following, FOLLOWING_BOOST), else_=0.0)
        + sa.case((follower, FOLLOWER_BOOST), else_=0.0)
        + sa.func.least(paths, FRIEND_OF_FRIEND_PATH_CAP)
        * (FRIEND_OF_FRIEND_BOOST / FRIEND_OF_FRIEND_PATH_CAP)
    )
    # Following someone who follows you back is otherwise a path to yourself.
    return sa.case((User.id == viewer_id, 0.0), else_=boost)
