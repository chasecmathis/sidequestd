"""Linking a Steam account — SPEC §6.13.

The callback tests carry most of the weight here. It is the one endpoint in the
app that a stranger can reach with hand-written parameters and, if it were
credulous, walk away wearing somebody else's library as verified evidence.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token, create_oauth_state_token
from app.models.connections import PlatformAccount, PlatformLibraryItem
from app.models.enums import ConnectionProvider
from app.models.user import User
from app.services import connections as connections_service
from app.services import steam as steam_service

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]

STEAM_ID = "76561197960287930"
CLAIMED_ID = f"https://steamcommunity.com/openid/id/{STEAM_ID}"

PROFILE = steam_service.SteamProfile(
    steam_id=STEAM_ID,
    persona_name="ada",
    avatar_url="https://avatars.steamstatic.com/ada_full.jpg",
    profile_url="https://steamcommunity.com/id/ada/",
    is_public=True,
)


@pytest.fixture(autouse=True)
def configured(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test here assumes the deployment has a Steam key."""
    monkeypatch.setattr(settings, "steam_api_key", "steam-test-key")
    monkeypatch.setattr(settings, "api_public_url", "http://localhost:8000")
    monkeypatch.setattr(settings, "web_app_url", "http://localhost:3000")


@pytest.fixture(autouse=True)
def no_background_sync(monkeypatch: pytest.MonkeyPatch) -> list[uuid.UUID]:
    """Record what the endpoints schedule instead of talking to Steam."""
    scheduled: list[uuid.UUID] = []

    async def _record(account_id: uuid.UUID) -> None:
        scheduled.append(account_id)

    monkeypatch.setattr(steam_service, "sync_library_in_background", _record)
    return scheduled


@pytest.fixture
def steam_openid(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """Stand in for Steam's `check_authentication` endpoint.

    `control["is_valid"]` is what Steam is made to answer, and `control["posts"]`
    records what we sent it — which is the only way to assert that the round trip
    happens at all rather than being quietly skipped.
    """
    control: dict[str, Any] = {"is_valid": "true", "posts": []}

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *_: object) -> None:
            return None

        async def post(self, url: str, data: dict[str, str]) -> httpx.Response:
            control["posts"].append(data)
            body = f"ns:http://specs.openid.net/auth/2.0\nis_valid:{control['is_valid']}\n"
            return httpx.Response(200, text=body, request=httpx.Request("POST", url))

        async def get(self, url: str, params: dict[str, Any]) -> httpx.Response:
            raise AssertionError("no GET expected in this flow")

    monkeypatch.setattr(steam_service, "_new_client", lambda: _Client())
    return control


@pytest.fixture
def steam_profile(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    control: dict[str, Any] = {"profile": PROFILE}

    async def _fetch(steam_id: str) -> steam_service.SteamProfile | None:
        profile = control["profile"]
        if profile is None:
            return None
        return replace(profile, steam_id=steam_id)

    monkeypatch.setattr(steam_service, "fetch_profile", _fetch)
    return control


def _callback_params(**overrides: str) -> dict[str, str]:
    """A well-formed assertion, before any test bends one field out of shape."""
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "id_res",
        "openid.op_endpoint": "https://steamcommunity.com/openid/login",
        "openid.claimed_id": CLAIMED_ID,
        "openid.identity": CLAIMED_ID,
        "openid.return_to": f"{steam_service.callback_url()}?state=x",
        "openid.response_nonce": "2026-08-17T00:00:00Zabc",
        "openid.assoc_handle": "1234567890",
        "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce",
        "openid.sig": "Zm9ydW5uaW5n",
    }
    params.update(overrides)
    return params


async def _callback(client: AsyncClient, state: str, **overrides: str) -> httpx.Response:
    params = _callback_params(**overrides)
    params["state"] = state
    return await client.get("/api/v1/connections/steam/callback", params=params)


def _state_for(user: User) -> str:
    return create_oauth_state_token(user.id, steam_service.PROVIDER, ttl_minutes=10)


def _redirect_query(response: httpx.Response) -> dict[str, list[str]]:
    assert response.status_code == 303
    return parse_qs(urlparse(response.headers["location"]).query)


# --- Starting the flow ------------------------------------------------------


async def test_start_hands_back_a_well_formed_steam_url(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    user = await make_user("ada")

    response = await client.get("/api/v1/connections/steam/start", headers=auth_headers(user))

    assert response.status_code == 200
    parsed = urlparse(response.json()["authorize_url"])
    query = parse_qs(parsed.query)
    assert parsed.hostname == "steamcommunity.com"
    assert query["openid.mode"] == ["checkid_setup"]
    # identifier_select is what makes Steam ask *which* account, rather than us
    # having to know it in advance — the whole reason this flow works at all.
    assert query["openid.identity"] == ["http://specs.openid.net/auth/2.0/identifier_select"]
    # Steam rejects a return_to that does not sit under the realm.
    assert query["openid.return_to"][0].startswith(query["openid.realm"][0])


async def test_starting_requires_signing_in(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/connections/steam/start")).status_code == 401


async def test_start_is_unavailable_without_a_key(
    client: AsyncClient,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "steam_api_key", None)
    user = await make_user("ada")

    response = await client.get("/api/v1/connections/steam/start", headers=auth_headers(user))

    assert response.status_code == 503


# --- The callback -----------------------------------------------------------


async def test_a_verified_callback_links_the_account(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
    no_background_sync: list[uuid.UUID],
) -> None:
    user = await make_user("ada")

    response = await _callback(client, _state_for(user))

    assert _redirect_query(response)["connected"] == ["steam"]
    account = (await db.execute(sa.select(PlatformAccount))).scalar_one()
    assert account.user_id == user.id
    assert account.provider_account_id == STEAM_ID
    assert account.provider_username == "ada"
    # The library is pulled after the response, not during it.
    assert no_background_sync == [account.id]


async def test_the_assertion_is_checked_with_steam_itself(
    client: AsyncClient,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """The round trip is the only thing making these parameters mean anything.

    Asserted on the outbound request rather than the outcome, because a version
    of this code that trusted the query string would still pass a test that only
    looked at the response.
    """
    user = await make_user("ada")

    await _callback(client, _state_for(user))

    assert len(steam_openid["posts"]) == 1
    sent = steam_openid["posts"][0]
    assert sent["openid.mode"] == "check_authentication"
    # Every signed field has to go back untouched or Steam cannot re-check its
    # own signature.
    assert sent["openid.sig"] == "Zm9ydW5uaW5n"
    assert sent["openid.claimed_id"] == CLAIMED_ID


async def test_an_assertion_steam_disowns_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """The forgery case: right shape, wrong provenance."""
    steam_openid["is_valid"] = "false"
    user = await make_user("ada")

    response = await _callback(client, _state_for(user))

    assert _redirect_query(response)["error"] == ["verification"]
    assert (await db.execute(sa.select(PlatformAccount))).first() is None


@pytest.mark.parametrize(
    "claimed_id",
    [
        "https://steamcommunity.evil.com/openid/id/76561197960287930",
        "https://evil.com/https://steamcommunity.com/openid/id/76561197960287930",
        "http://steamcommunity.com/openid/id/76561197960287930",
        "https://steamcommunity.com/openid/id/123",
        "https://steamcommunity.com/openid/id/76561197960287930/../999",
        "not a url at all",
    ],
)
async def test_a_claimed_id_that_is_not_steams_is_refused(
    claimed_id: str,
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """Rejected before Steam is asked, so a bad host never even gets a round trip."""
    user = await make_user("ada")

    response = await _callback(client, _state_for(user), **{"openid.claimed_id": claimed_id})

    assert _redirect_query(response)["error"] == ["verification"]
    assert steam_openid["posts"] == []
    assert (await db.execute(sa.select(PlatformAccount))).first() is None


async def test_an_assertion_aimed_at_another_endpoint_is_refused(
    client: AsyncClient,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """`return_to` is part of what Steam signed; it has to name this endpoint."""
    user = await make_user("ada")

    response = await _callback(
        client, _state_for(user), **{"openid.return_to": "https://evil.example/callback"}
    )

    assert _redirect_query(response)["error"] == ["verification"]
    assert steam_openid["posts"] == []


async def test_a_cancelled_sign_in_is_not_an_assertion(
    client: AsyncClient,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """The member declined on Steam's page. Not an error, but nothing to store."""
    user = await make_user("ada")

    response = await _callback(client, _state_for(user), **{"openid.mode": "cancel"})

    assert _redirect_query(response)["error"] == ["verification"]


@pytest.mark.parametrize("state", ["", "not-a-token", "a.b.c"])
async def test_a_callback_without_usable_state_is_refused(
    state: str,
    client: AsyncClient,
    db: AsyncSession,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """No state means no idea who this is; there is nobody to link the account to."""
    response = await _callback(client, state)

    assert _redirect_query(response)["error"] == ["state"]
    assert (await db.execute(sa.select(PlatformAccount))).first() is None


async def test_an_expired_state_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    user = await make_user("ada")
    stale = create_oauth_state_token(
        user.id,
        steam_service.PROVIDER,
        ttl_minutes=10,
        now=datetime.now(UTC) - timedelta(hours=2),
    )

    response = await _callback(client, stale)

    assert _redirect_query(response)["error"] == ["state"]
    assert (await db.execute(sa.select(PlatformAccount))).first() is None


async def test_an_access_token_is_not_accepted_as_state(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """Both are signed with the same key, so only the `type` claim separates them.

    Without that check a leaked access token in a URL would be enough to link an
    account to somebody else's Steam profile.
    """
    user = await make_user("ada")

    response = await _callback(client, create_access_token(user.id).token)

    assert _redirect_query(response)["error"] == ["state"]
    assert (await db.execute(sa.select(PlatformAccount))).first() is None


async def test_a_steam_account_cannot_be_linked_twice(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """Two profiles wearing one library's hours would make the badge meaningless."""
    first = await make_user("ada")
    await _callback(client, _state_for(first))

    second = await make_user("grace")
    response = await _callback(client, _state_for(second))

    assert _redirect_query(response)["error"] == ["taken"]
    accounts = (await db.execute(sa.select(PlatformAccount))).scalars().all()
    assert [account.user_id for account in accounts] == [first.id]


async def test_relinking_the_same_account_refreshes_it(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """How somebody repairs a link, so it must not be a conflict with themselves."""
    user = await make_user("ada")
    await _callback(client, _state_for(user))

    steam_profile["profile"] = replace(PROFILE, persona_name="ada-renamed")
    response = await _callback(client, _state_for(user))

    assert _redirect_query(response)["connected"] == ["steam"]
    account = (await db.execute(sa.select(PlatformAccount))).scalar_one()
    assert account.provider_username == "ada-renamed"


async def test_linking_a_different_account_drops_the_old_library(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    steam_openid: dict[str, Any],
    steam_profile: dict[str, Any],
) -> None:
    """Otherwise verified badges would keep standing on a link that is gone."""
    user = await make_user("ada")
    await _callback(client, _state_for(user))
    account = (await db.execute(sa.select(PlatformAccount))).scalar_one()
    db.add(
        PlatformLibraryItem(
            platform_account_id=account.id, provider_game_id="1145360", playtime_minutes=600
        )
    )
    await db.commit()

    other = "76561197960287931"
    steam_profile["profile"] = replace(PROFILE, steam_id=other)
    await _callback(
        client,
        _state_for(user),
        **{
            "openid.claimed_id": f"https://steamcommunity.com/openid/id/{other}",
            "openid.identity": f"https://steamcommunity.com/openid/id/{other}",
        },
    )

    refreshed = (await db.execute(sa.select(PlatformAccount))).scalar_one()
    assert refreshed.provider_account_id == other
    assert refreshed.last_synced_at is None
    remaining = (await db.execute(sa.select(sa.func.count(PlatformLibraryItem.id)))).scalar_one()
    assert remaining == 0


# --- Reading and managing the link ------------------------------------------


async def test_connections_reports_availability_when_nothing_is_linked(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    user = await make_user("ada")

    response = await client.get("/api/v1/me/connections", headers=auth_headers(user))

    body = response.json()
    assert body == {"steam_available": True, "accounts": []}


async def test_connections_says_so_when_the_deployment_has_no_key(
    client: AsyncClient,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The client hides the button rather than offering one that always fails."""
    monkeypatch.setattr(settings, "steam_api_key", None)
    user = await make_user("ada")

    response = await client.get("/api/v1/me/connections", headers=auth_headers(user))

    assert response.json()["steam_available"] is False


async def test_a_linked_account_reports_its_library_totals(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    catalog: list[Any],
) -> None:
    user = await make_user("ada")
    account = PlatformAccount(
        user_id=user.id, provider=ConnectionProvider.STEAM, provider_account_id=STEAM_ID
    )
    db.add(account)
    await db.flush()
    db.add_all(
        [
            PlatformLibraryItem(
                platform_account_id=account.id,
                provider_game_id="1",
                game_id=catalog[0].id,
                match_source="EXTERNAL_ID",
                playtime_minutes=600,
            ),
            PlatformLibraryItem(
                platform_account_id=account.id, provider_game_id="2", playtime_minutes=90
            ),
        ]
    )
    await db.commit()

    response = await client.get("/api/v1/me/connections", headers=auth_headers(user))

    linked = response.json()["accounts"][0]
    assert linked["total_games"] == 2
    # The unmatched row still counts as owned; it just has no catalog entry.
    assert linked["matched_games"] == 1
    assert linked["total_playtime_minutes"] == 690


async def test_unlinking_removes_the_account_and_its_library(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    user = await make_user("ada")
    account = PlatformAccount(
        user_id=user.id, provider=ConnectionProvider.STEAM, provider_account_id=STEAM_ID
    )
    db.add(account)
    await db.flush()
    db.add(PlatformLibraryItem(platform_account_id=account.id, provider_game_id="1"))
    await db.commit()

    response = await client.delete("/api/v1/connections/steam", headers=auth_headers(user))

    assert response.status_code == 204
    assert (await db.execute(sa.select(PlatformAccount))).first() is None
    assert (await db.execute(sa.select(PlatformLibraryItem))).first() is None


async def test_unlinking_what_was_never_linked_says_so(
    client: AsyncClient, make_user: MakeUser, auth_headers: AuthHeaders
) -> None:
    user = await make_user("ada")

    response = await client.delete("/api/v1/connections/steam", headers=auth_headers(user))

    assert response.status_code == 404


async def test_visibility_can_be_turned_off(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
) -> None:
    user = await make_user("ada")
    db.add(
        PlatformAccount(
            user_id=user.id, provider=ConnectionProvider.STEAM, provider_account_id=STEAM_ID
        )
    )
    await db.commit()

    response = await client.patch(
        "/api/v1/connections/steam/visibility",
        headers=auth_headers(user),
        json={"is_visible": False},
    )

    assert response.status_code == 200
    assert response.json()["is_visible"] is False


# --- The manual re-sync -----------------------------------------------------


async def test_a_manual_sync_is_scheduled_rather_than_awaited(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    no_background_sync: list[uuid.UUID],
) -> None:
    user = await make_user("ada")
    account = PlatformAccount(
        user_id=user.id, provider=ConnectionProvider.STEAM, provider_account_id=STEAM_ID
    )
    db.add(account)
    await db.commit()

    response = await client.post("/api/v1/connections/steam/sync", headers=auth_headers(user))

    assert response.status_code == 200
    assert no_background_sync == [account.id]


async def test_syncing_again_too_soon_is_refused(
    client: AsyncClient,
    db: AsyncSession,
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    no_background_sync: list[uuid.UUID],
) -> None:
    user = await make_user("ada")
    db.add(
        PlatformAccount(
            user_id=user.id,
            provider=ConnectionProvider.STEAM,
            provider_account_id=STEAM_ID,
            last_synced_at=datetime.now(UTC) - timedelta(minutes=5),
        )
    )
    await db.commit()

    response = await client.post("/api/v1/connections/steam/sync", headers=auth_headers(user))

    assert response.status_code == 429
    assert no_background_sync == []


async def test_the_cooldown_expires(db: AsyncSession, make_user: MakeUser) -> None:
    user = await make_user("ada")
    account = PlatformAccount(
        user_id=user.id,
        provider=ConnectionProvider.STEAM,
        provider_account_id=STEAM_ID,
        last_synced_at=datetime.now(UTC) - timedelta(minutes=5),
    )

    later = datetime.now(UTC) + timedelta(hours=1)
    assert connections_service.sync_cooldown_remaining(account) > 0
    assert connections_service.sync_cooldown_remaining(account, now=later) == 0


async def test_a_never_synced_account_may_sync_immediately(
    db: AsyncSession, make_user: MakeUser
) -> None:
    user = await make_user("ada")
    account = PlatformAccount(
        user_id=user.id, provider=ConnectionProvider.STEAM, provider_account_id=STEAM_ID
    )

    assert connections_service.sync_cooldown_remaining(account) == 0
