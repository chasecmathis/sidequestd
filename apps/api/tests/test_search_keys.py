"""The generated search keys search matches against (SPEC §6.6).

The database computes them with `search_normalize`, so these tests pin the
function itself: what it strips, what it keeps, and that every table that is
searched carries the columns.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.game import Game, GameAlias
from app.models.user import User

MakeUser = Callable[..., Awaitable[User]]


async def test_a_title_is_keyed_without_accents_case_or_punctuation(db: AsyncSession) -> None:
    game = Game(title="Pokémon: Let's Go, Pikachu!", slug="pokemon-lets-go")
    db.add(game)
    await db.flush()

    key, compact = (
        await db.execute(sa.select(Game.search_key, Game.search_compact).where(Game.id == game.id))
    ).one()

    assert key == "pokemon let s go pikachu"
    assert compact == "pokemonletsgopikachu"


async def test_non_latin_letters_survive_normalization(db: AsyncSession) -> None:
    """Stripping everything outside a-z would leave these names unsearchable."""
    game = Game(title="ファイナルファンタジー VII", slug="ff7-jp")
    db.add(game)
    await db.flush()

    key = await db.scalar(sa.select(Game.search_key).where(Game.id == game.id))

    assert key == "ファイナルファンタジー vii"


async def test_an_alias_is_keyed_like_a_title(db: AsyncSession) -> None:
    game = Game(title="Grand Theft Auto V", slug="gta-v")
    db.add(game)
    await db.flush()
    alias = GameAlias(game_id=game.id, alias="G.T.A. V")
    db.add(alias)
    await db.flush()

    key, compact = (
        await db.execute(
            sa.select(GameAlias.search_key, GameAlias.search_compact).where(
                GameAlias.id == alias.id
            )
        )
    ).one()

    assert key == "g t a v"
    assert compact == "gtav"


async def test_handles_and_display_names_are_keyed(db: AsyncSession, make_user: MakeUser) -> None:
    user = await make_user("ripley_88", display_name="Zoë Washburne")

    row = (
        await db.execute(
            sa.select(
                User.username_key,
                User.username_compact,
                User.display_name_key,
                User.display_name_compact,
            ).where(User.id == user.id)
        )
    ).one()

    assert tuple(row) == ("ripley 88", "ripley88", "zoe washburne", "zoewashburne")


async def test_no_display_name_means_no_display_name_key(
    db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user("hicks")

    key = await db.scalar(sa.select(User.display_name_key).where(User.id == user.id))

    assert key is None
