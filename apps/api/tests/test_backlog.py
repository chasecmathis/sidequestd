"""Backlog lists — SPEC §6.9, §8.

The rule the whole feature rests on is "a game occupies at most one status", so
most of what is checked here is that moving a game is an *update*: one row before
and one row after, off the old list and onto the end of the new one, with the
gap it left closed behind it. The privacy section checks the other half of §6.9 —
that lists inherit the account's privacy rather than having a rule of their own.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.backlog import BacklogItem
from app.models.enums import BacklogStatus, FollowStatus
from app.models.game import Game
from app.models.social import Follow
from app.models.user import User

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]

BACKLOG_URL = "/api/v1/backlog"
MY_LISTS_URL = "/api/v1/users/me/lists"

TO_BE_PLAYED = BacklogStatus.TO_BE_PLAYED.value
PLAYING = BacklogStatus.PLAYING.value
COMPLETED = BacklogStatus.COMPLETED.value
DROPPED = BacklogStatus.DROPPED.value


@pytest.fixture
def headers(registered_user: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {registered_user['access_token']}"}


async def put(
    client: AsyncClient, headers: dict[str, str], game: Game, status: str
) -> dict[str, object]:
    response = await client.put(
        f"{BACKLOG_URL}/{game.id}", headers=headers, json={"status": status}
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


async def read_lists(
    client: AsyncClient, headers: dict[str, str], *, url: str = MY_LISTS_URL, **params: str
) -> dict[str, object]:
    response = await client.get(url, headers=headers, params=params)
    assert response.status_code == 200, response.text
    return dict(response.json())


def titles_on(body: dict[str, object], status: str) -> list[str]:
    """The games on one list, in the order the API returned them."""
    lists = body["lists"]
    assert isinstance(lists, list)
    entry = next(group for group in lists if group["status"] == status)
    return [item["game"]["title"] for item in entry["items"]]


def positions_on(body: dict[str, object], status: str) -> list[int]:
    lists = body["lists"]
    assert isinstance(lists, list)
    entry = next(group for group in lists if group["status"] == status)
    return [item["position"] for item in entry["items"]]


async def backdate(db: AsyncSession, *, minutes: int) -> None:
    """Move every backlog row into the past.

    `status_changed_at` defaults to `now()`, which in Postgres is the
    *transaction* clock — so within one test every row shares a timestamp, and
    "this did not move" would be true by accident. Backdating first is what makes
    a no-op distinguishable from a change.
    """
    await db.execute(
        sa.update(BacklogItem).values(
            status_changed_at=sa.text(f"now() - interval '{minutes} minutes'")
        )
    )
    await db.flush()


async def row_count(db: AsyncSession, user_id: uuid.UUID, game_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            sa.select(sa.func.count())
            .select_from(BacklogItem)
            .where(BacklogItem.user_id == user_id, BacklogItem.game_id == game_id)
        )
    ) or 0


# --- Reading your own lists -------------------------------------------------


async def test_a_new_account_gets_four_empty_lists(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    """All four, always: a profile draws four headings whether or not there is
    anything under them."""
    body = await read_lists(client, headers)

    lists = body["lists"]
    assert isinstance(lists, list)
    assert [group["status"] for group in lists] == [TO_BE_PLAYED, PLAYING, COMPLETED, DROPPED]
    assert all(group["items"] == [] for group in lists)


async def test_a_status_filter_returns_only_that_list(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await put(client, headers, catalog[0], TO_BE_PLAYED)
    await put(client, headers, catalog[1], PLAYING)

    body = await read_lists(client, headers, status=PLAYING)

    lists = body["lists"]
    assert isinstance(lists, list)
    assert [group["status"] for group in lists] == [PLAYING]
    assert titles_on(body, PLAYING) == [catalog[1].title]


async def test_the_entry_carries_the_card_a_list_renders(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    game = next(game for game in catalog if game.title == "Celeste")

    entry = await put(client, headers, game, TO_BE_PLAYED)

    card = entry["game"]
    assert isinstance(card, dict)
    assert card["release_year"] == 2018
    assert card["platforms"]


async def test_reading_your_own_lists_needs_a_caller(client: AsyncClient) -> None:
    assert (await client.get(MY_LISTS_URL)).status_code == 401


# --- Adding and moving (SPEC §6.9) ------------------------------------------


async def test_adding_a_game_puts_it_at_the_top_of_an_empty_list(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    entry = await put(client, headers, catalog[0], TO_BE_PLAYED)

    assert entry["status"] == TO_BE_PLAYED
    assert entry["position"] == 0


async def test_games_are_appended_in_the_order_they_were_added(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    for game in catalog[:3]:
        await put(client, headers, game, TO_BE_PLAYED)

    body = await read_lists(client, headers)

    assert titles_on(body, TO_BE_PLAYED) == [game.title for game in catalog[:3]]
    assert positions_on(body, TO_BE_PLAYED) == [0, 1, 2]


async def test_moving_a_game_leaves_exactly_one_row(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    registered_user: dict[str, object],
    catalog: list[Game],
) -> None:
    """The rule from SPEC §6.9: a game holds at most one status, so this is an
    UPDATE and not a second row claiming the same game is also unplayed."""
    user_id = uuid.UUID(str(registered_user["user"]["id"]))  # type: ignore[index]
    await put(client, headers, catalog[0], TO_BE_PLAYED)

    await put(client, headers, catalog[0], PLAYING)

    assert await row_count(db, user_id, catalog[0].id) == 1


async def test_moving_a_game_takes_it_off_the_list_it_was_on(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await put(client, headers, catalog[0], TO_BE_PLAYED)

    await put(client, headers, catalog[0], COMPLETED)

    body = await read_lists(client, headers)
    assert titles_on(body, TO_BE_PLAYED) == []
    assert titles_on(body, COMPLETED) == [catalog[0].title]


async def test_a_moved_game_lands_at_the_end_of_its_new_list(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """The owner's order within a list is theirs — an arrival does not push in."""
    await put(client, headers, catalog[0], PLAYING)
    await put(client, headers, catalog[1], PLAYING)
    await put(client, headers, catalog[2], TO_BE_PLAYED)

    moved = await put(client, headers, catalog[2], PLAYING)

    assert moved["position"] == 2
    assert titles_on(await read_lists(client, headers), PLAYING) == [
        catalog[0].title,
        catalog[1].title,
        catalog[2].title,
    ]


async def test_moving_a_game_closes_the_gap_it_left(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    for game in catalog[:3]:
        await put(client, headers, game, TO_BE_PLAYED)

    await put(client, headers, catalog[0], PLAYING)

    body = await read_lists(client, headers)
    assert titles_on(body, TO_BE_PLAYED) == [catalog[1].title, catalog[2].title]
    assert positions_on(body, TO_BE_PLAYED) == [0, 1]


async def test_setting_the_status_a_game_already_has_changes_nothing(
    client: AsyncClient, db: AsyncSession, headers: dict[str, str], catalog: list[Game]
) -> None:
    """A retried request must not re-announce the change to the owner's followers
    (SPEC §6.11), so `status_changed_at` stays where it was."""
    await put(client, headers, catalog[0], PLAYING)
    await put(client, headers, catalog[1], PLAYING)
    await backdate(db, minutes=90)
    before = (await read_lists(client, headers))["lists"]

    again = await put(client, headers, catalog[0], PLAYING)

    assert again["position"] == 0
    assert (await read_lists(client, headers))["lists"] == before


async def test_adding_a_game_that_is_not_in_the_catalog_is_a_404(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    response = await client.put(
        f"{BACKLOG_URL}/{uuid.uuid4()}", headers=headers, json={"status": PLAYING}
    )

    assert response.status_code == 404


async def test_an_unknown_status_is_rejected(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    response = await client.put(
        f"{BACKLOG_URL}/{catalog[0].id}", headers=headers, json={"status": "ABANDONED"}
    )

    assert response.status_code == 422


async def test_adding_to_a_list_needs_a_caller(client: AsyncClient, catalog: list[Game]) -> None:
    response = await client.put(f"{BACKLOG_URL}/{catalog[0].id}", json={"status": PLAYING})

    assert response.status_code == 401


async def test_one_persons_list_is_not_anothers(
    client: AsyncClient,
    headers: dict[str, str],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    await put(client, headers, catalog[0], PLAYING)
    hicks = await make_user("hicks")

    body = await read_lists(client, auth_headers(hicks))

    assert titles_on(body, PLAYING) == []


# --- Removing ---------------------------------------------------------------


async def test_removing_a_game_takes_it_off_the_backlog(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await put(client, headers, catalog[0], TO_BE_PLAYED)

    response = await client.delete(f"{BACKLOG_URL}/{catalog[0].id}", headers=headers)

    assert response.status_code == 204
    assert titles_on(await read_lists(client, headers), TO_BE_PLAYED) == []


async def test_removing_closes_the_gap_in_the_list(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    for game in catalog[:3]:
        await put(client, headers, game, TO_BE_PLAYED)

    await client.delete(f"{BACKLOG_URL}/{catalog[1].id}", headers=headers)

    body = await read_lists(client, headers)
    assert titles_on(body, TO_BE_PLAYED) == [catalog[0].title, catalog[2].title]
    assert positions_on(body, TO_BE_PLAYED) == [0, 1]


async def test_removing_a_game_that_is_on_no_list_is_a_404(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """Not a silent success: the client is looking at a list somebody else has
    already changed, and should re-read rather than believe it removed something."""
    response = await client.delete(f"{BACKLOG_URL}/{catalog[0].id}", headers=headers)

    assert response.status_code == 404


# --- Reordering (SPEC §6.9) -------------------------------------------------


async def test_reordering_rewrites_the_order_of_one_list(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    for game in catalog[:3]:
        await put(client, headers, game, PLAYING)

    response = await client.put(
        f"{BACKLOG_URL}/order",
        headers=headers,
        json={
            "status": PLAYING,
            "game_ids": [str(catalog[2].id), str(catalog[0].id), str(catalog[1].id)],
        },
    )

    assert response.status_code == 200, response.text
    assert [item["game"]["title"] for item in response.json()["items"]] == [
        catalog[2].title,
        catalog[0].title,
        catalog[1].title,
    ]
    assert [item["position"] for item in response.json()["items"]] == [0, 1, 2]


async def test_reordering_leaves_the_other_lists_alone(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await put(client, headers, catalog[0], PLAYING)
    await put(client, headers, catalog[1], PLAYING)
    await put(client, headers, catalog[2], TO_BE_PLAYED)

    await client.put(
        f"{BACKLOG_URL}/order",
        headers=headers,
        json={"status": PLAYING, "game_ids": [str(catalog[1].id), str(catalog[0].id)]},
    )

    assert titles_on(await read_lists(client, headers), TO_BE_PLAYED) == [catalog[2].title]


async def test_reordering_is_not_an_event(
    client: AsyncClient, db: AsyncSession, headers: dict[str, str], catalog: list[Game]
) -> None:
    """Tidying a list you already own is not news for your followers (SPEC §6.11)."""
    for game in catalog[:2]:
        await put(client, headers, game, PLAYING)
    await backdate(db, minutes=90)
    before = titles_on(await read_lists(client, headers), PLAYING)
    changed_at = [
        item["status_changed_at"]
        for group in (await read_lists(client, headers))["lists"]  # type: ignore[union-attr]
        for item in group["items"]
    ]

    await client.put(
        f"{BACKLOG_URL}/order",
        headers=headers,
        json={"status": PLAYING, "game_ids": [str(catalog[1].id), str(catalog[0].id)]},
    )

    after = await read_lists(client, headers)
    assert titles_on(after, PLAYING) == list(reversed(before))
    assert [
        item["status_changed_at"]
        for group in after["lists"]  # type: ignore[union-attr]
        for item in group["items"]
    ] == list(reversed(changed_at))


async def test_an_order_missing_a_game_is_refused(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    """A short list means a stale client, and reconciling it would drop whatever
    another tab had just added."""
    for game in catalog[:3]:
        await put(client, headers, game, PLAYING)

    response = await client.put(
        f"{BACKLOG_URL}/order",
        headers=headers,
        json={"status": PLAYING, "game_ids": [str(catalog[0].id), str(catalog[1].id)]},
    )

    assert response.status_code == 400


async def test_an_order_naming_a_game_from_another_list_is_refused(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await put(client, headers, catalog[0], PLAYING)
    await put(client, headers, catalog[1], TO_BE_PLAYED)

    response = await client.put(
        f"{BACKLOG_URL}/order",
        headers=headers,
        json={"status": PLAYING, "game_ids": [str(catalog[0].id), str(catalog[1].id)]},
    )

    assert response.status_code == 400


async def test_an_order_repeating_a_game_is_refused(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> None:
    await put(client, headers, catalog[0], PLAYING)
    await put(client, headers, catalog[1], PLAYING)

    response = await client.put(
        f"{BACKLOG_URL}/order",
        headers=headers,
        json={"status": PLAYING, "game_ids": [str(catalog[0].id), str(catalog[0].id)]},
    )

    assert response.status_code == 400


async def test_the_reorder_route_is_not_read_as_a_game_id(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    """`/backlog/order` is declared before `/backlog/{game_id}`; if that order is
    ever lost this is a 422 about an unparseable uuid instead."""
    response = await client.put(
        f"{BACKLOG_URL}/order", headers=headers, json={"status": PLAYING, "game_ids": []}
    )

    assert response.status_code == 200, response.text


# --- Someone else's lists, and privacy (SPEC §6.7, §6.9) --------------------


def backlog_url(user: User) -> str:
    return f"/api/v1/users/{user.id}/backlog"


async def test_a_public_accounts_lists_are_readable_signed_out(
    client: AsyncClient,
    headers: dict[str, str],
    registered_user: dict[str, object],
    catalog: list[Game],
) -> None:
    await put(client, headers, catalog[0], COMPLETED)
    user_id = str(registered_user["user"]["id"])  # type: ignore[index]

    response = await client.get(f"/api/v1/users/{user_id}/backlog")

    assert response.status_code == 200, response.text
    assert titles_on(response.json(), COMPLETED) == [catalog[0].title]


async def test_a_private_accounts_lists_are_withheld_from_a_stranger(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, catalog: list[Game]
) -> None:
    newt = await make_user("newt", is_private=True)
    db.add(
        BacklogItem(
            user_id=newt.id, game_id=catalog[0].id, status=BacklogStatus.PLAYING, position=0
        )
    )
    await db.flush()

    response = await client.get(backlog_url(newt))

    assert response.status_code == 403


async def test_an_approved_follower_may_read_them(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Game],
) -> None:
    newt = await make_user("newt", is_private=True)
    hicks = await make_user("hicks")
    db.add(
        BacklogItem(
            user_id=newt.id, game_id=catalog[0].id, status=BacklogStatus.PLAYING, position=0
        )
    )
    db.add(Follow(follower_id=hicks.id, followee_id=newt.id, status=FollowStatus.ACCEPTED))
    await db.flush()

    response = await client.get(backlog_url(newt), headers=auth_headers(hicks))

    assert response.status_code == 200
    assert titles_on(response.json(), PLAYING) == [catalog[0].title]


async def test_a_pending_request_does_not_unlock_them(
    client: AsyncClient, db: AsyncSession, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)
    hopeful = await make_user("hicks")
    db.add(Follow(follower_id=hopeful.id, followee_id=newt.id, status=FollowStatus.PENDING))
    await db.flush()

    response = await client.get(backlog_url(newt), headers=auth_headers(hopeful))

    assert response.status_code == 403


async def test_the_owner_may_always_read_their_own(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    newt = await make_user("newt", is_private=True)

    response = await client.get(backlog_url(newt), headers=auth_headers(newt))

    assert response.status_code == 200


async def test_lists_for_an_unknown_user_are_a_404(client: AsyncClient) -> None:
    assert (await client.get(f"/api/v1/users/{uuid.uuid4()}/backlog")).status_code == 404
