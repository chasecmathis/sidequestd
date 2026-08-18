"""Linking a Steam account, and reading the library behind it.

Steam is the one platform this app can integrate with honestly. It acts as an
OpenID 2.0 provider — "Sign in through Steam", the flow that exists precisely so
a third-party site never sees a Steam password — and it publishes owned games and
playtime through a documented Web API. PlayStation, Xbox and Nintendo have no
public consumer API; everything that talks to them is reverse-engineered.

Two things about the shape of this that are worth knowing before reading on:

* **OpenID 2.0 is not OpenID Connect.** There is no client secret, no token
  exchange and no consent screen listing scopes. Steam redirects the member back
  with a bundle of signed `openid.*` parameters, and the only way to know they
  are genuine is to hand them straight back to Steam and ask. `verify_callback`
  is that round trip, and skipping it would mean anyone who can type a URL could
  assert any SteamID and inherit its playtime as verified.

* **Nothing here is a credential.** The flow yields an identifier and nothing
  else. The single secret involved is one app-level Web API key, read from the
  environment, that this module uses to ask about public profiles.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final
from urllib.parse import urlencode, urljoin

import httpx

from app.core.config import settings
from app.services.exceptions import SteamNotConfiguredError, SteamVerificationError

logger = logging.getLogger(__name__)

PROVIDER: Final = "steam"

_OPENID_NS: Final = "http://specs.openid.net/auth/2.0"
# Tells Steam "I do not know who this is yet, ask them" — the member picks the
# account on Steam's own page and it comes back in `openid.claimed_id`.
_OPENID_IDENTIFIER_SELECT: Final = "http://specs.openid.net/auth/2.0/identifier_select"

# A SteamID64 is a fixed-width 17-digit number, and the claimed id is a URL on
# exactly one host. Anchored and specific on purpose: a looser pattern, or a
# split on "/", would happily read an id out of an attacker-controlled URL that
# merely contained the real one.
_CLAIMED_ID = re.compile(r"^https://steamcommunity\.com/openid/id/(\d{17})$")

# Steam answers `check_authentication` in OpenID's key-value form: bare
# `key:value` lines, not JSON.
_KEY_VALUE_LINE = re.compile(r"^([a-z_.]+):(.*)$")

# `communityvisibilitystate` from GetPlayerSummaries. Anything below this means
# the profile itself is not public, which is a different and more visible problem
# than the game-details setting the library sync trips over.
_VISIBILITY_PUBLIC: Final = 3


def steam_is_configured() -> bool:
    """Whether Steam linking is switched on for this deployment."""
    return bool(settings.steam_api_key)


def require_configured() -> None:
    if not steam_is_configured():
        raise SteamNotConfiguredError


def callback_url() -> str:
    """Where Steam sends the member back. Also the OpenID `return_to`."""
    return urljoin(settings.api_public_url.rstrip("/") + "/", "api/v1/connections/steam/callback")


def realm_url() -> str:
    """The scope of the assertion. Steam requires `return_to` to sit under it."""
    return settings.api_public_url.rstrip("/")


def build_authorize_url(state: str) -> str:
    """The Steam page to send the member to, carrying our signed state back."""
    return_to = f"{callback_url()}?state={state}"
    query = urlencode(
        {
            "openid.ns": _OPENID_NS,
            "openid.mode": "checkid_setup",
            "openid.return_to": return_to,
            "openid.realm": realm_url(),
            "openid.identity": _OPENID_IDENTIFIER_SELECT,
            "openid.claimed_id": _OPENID_IDENTIFIER_SELECT,
        }
    )
    return f"{settings.steam_openid_url}?{query}"


def _new_client() -> httpx.AsyncClient:
    """The HTTP client every Steam call goes through. Patched out in tests."""
    return httpx.AsyncClient(timeout=15.0)


def _parse_key_value(body: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for line in body.splitlines():
        match = _KEY_VALUE_LINE.match(line.strip())
        if match:
            fields[match.group(1)] = match.group(2)
    return fields


async def verify_callback(params: dict[str, str]) -> str:
    """Confirm Steam really made this assertion, and return the SteamID64.

    The parameters arrive on a plain browser redirect, so on their own they are
    just numbers in a URL. Genuineness comes from handing every one of them back
    to Steam unchanged with `mode=check_authentication`; Steam re-checks its own
    signature and answers `is_valid:true` or `is_valid:false`. Anything less than
    that answer is a refusal here.

    Raises `SteamVerificationError` for every rejection, deliberately without
    saying which check failed — the endpoint turns it into one generic redirect,
    and a caller probing for the difference learns nothing.
    """
    require_configured()

    if params.get("openid.mode") != "id_res":
        # `cancel` is the member declining on Steam's page, which is not an error
        # but is also not an assertion.
        raise SteamVerificationError

    # Must match the endpoint that is reading it. Without this an assertion
    # minted for some other `return_to` could be replayed here.
    return_to = params.get("openid.return_to", "")
    if not return_to.startswith(callback_url()):
        raise SteamVerificationError

    claimed = _CLAIMED_ID.match(params.get("openid.claimed_id", ""))
    if claimed is None:
        raise SteamVerificationError

    # Everything Steam sent, with only the mode swapped — the signature covers
    # the exact set of fields named in `openid.signed`, so dropping or reordering
    # any of them makes a genuine assertion fail to verify.
    echo = {key: value for key, value in params.items() if key.startswith("openid.")}
    echo["openid.mode"] = "check_authentication"

    async with _new_client() as http:
        response = await http.post(settings.steam_openid_url, data=echo)
        response.raise_for_status()
        fields = _parse_key_value(response.text)

    if fields.get("is_valid") != "true":
        logger.warning("Rejected a Steam OpenID assertion that did not verify")
        raise SteamVerificationError

    return claimed.group(1)


@dataclass(frozen=True, slots=True)
class OwnedGame:
    """One entry from a Steam library, normalised away from the wire shape."""

    appid: str
    title: str | None
    playtime_minutes: int
    last_played_at: datetime | None


@dataclass(frozen=True, slots=True)
class SteamProfile:
    """The public face of a Steam account, mirrored for display."""

    steam_id: str
    persona_name: str | None
    avatar_url: str | None
    profile_url: str | None
    is_public: bool


async def fetch_profile(steam_id: str) -> SteamProfile | None:
    """Read a player's summary. None when Steam does not return one at all."""
    require_configured()

    async with _new_client() as http:
        response = await http.get(
            f"{settings.steam_api_url}/ISteamUser/GetPlayerSummaries/v2/",
            params={"key": settings.steam_api_key, "steamids": steam_id},
        )
        response.raise_for_status()
        payload: dict[str, Any] = response.json()

    players = (payload.get("response") or {}).get("players") or []
    if not players:
        return None

    player = players[0]
    return SteamProfile(
        steam_id=steam_id,
        persona_name=player.get("personaname"),
        avatar_url=player.get("avatarfull") or player.get("avatarmedium"),
        profile_url=player.get("profileurl"),
        is_public=player.get("communityvisibilitystate") == _VISIBILITY_PUBLIC,
    )


class SteamProfilePrivateError(Exception):
    """Steam will not say what this member owns.

    Raised for the single most common way this feature fails, and the reason it
    is an exception rather than an empty result: a member whose "Game details"
    privacy is not Public gets a 200 whose `response` object is *empty* — no
    `games` key, no `game_count`, no error. That is indistinguishable from a
    genuinely empty library unless it is looked for, and the two need opposite
    responses. One is "you own nothing yet"; the other is "change this setting on
    Steam and try again", which is the only thing the member can act on.
    """


async def fetch_owned_games(steam_id: str) -> list[OwnedGame]:
    """Every game in a member's library, with the playtime Steam reports.

    `include_played_free_games` matters more than it looks: without it a library
    that is mostly free-to-play comes back nearly empty, and those are exactly the
    games with the biggest playtime figures attached.
    """
    require_configured()

    async with _new_client() as http:
        response = await http.get(
            f"{settings.steam_api_url}/IPlayerService/GetOwnedGames/v1/",
            params={
                "key": settings.steam_api_key,
                "steamid": steam_id,
                "include_appinfo": 1,
                "include_played_free_games": 1,
            },
        )
        response.raise_for_status()
        payload: dict[str, Any] = response.json()

    body = payload.get("response")
    if not isinstance(body, dict) or "games" not in body:
        # See SteamProfilePrivateError. `game_count: 0` with a `games` key absent
        # is a real empty library; an empty object is the privacy wall.
        if isinstance(body, dict) and body.get("game_count") == 0:
            return []
        raise SteamProfilePrivateError

    owned: list[OwnedGame] = []
    for entry in body["games"]:
        appid = entry.get("appid")
        if appid is None:
            continue
        last_played = entry.get("rtime_last_played") or 0
        owned.append(
            OwnedGame(
                appid=str(appid),
                title=(entry.get("name") or None),
                # Steam reports minutes, which is what `reviews.playtime_minutes`
                # already stores. No conversion anywhere in this feature.
                playtime_minutes=max(0, int(entry.get("playtime_forever") or 0)),
                last_played_at=(
                    datetime.fromtimestamp(last_played, tz=UTC) if last_played else None
                ),
            )
        )
    return owned


async def sync_library_in_background(account_id: uuid.UUID) -> None:
    """What the callback and the sync endpoint schedule.

    Opens its own session: background tasks run after the response, by which time
    the request's session is closed. Failures are swallowed and logged — they are
    recorded on the account as `last_sync_status`, which is where the settings
    screen reads them from, so there is nothing useful to raise into.
    """
    from app.db.session import SessionLocal
    from app.services.library_sync import sync_account

    try:
        async with SessionLocal() as session:
            await sync_account(session, account_id)
    except Exception:
        logger.exception("Background Steam sync failed for account %s", account_id)
