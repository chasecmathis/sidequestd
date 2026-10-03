"""Linking a Steam account — SPEC §6.13.

The callback is the odd one out in this codebase: it is the only endpoint that is
entered by a browser redirect from a third party rather than by the client, so it
cannot present a bearer token and cannot return JSON to anybody. It authenticates
on the signed `state` it issued at the start of the flow, and it answers with a
302 back to the client carrying a result code in the query string.

*Which* client is the only thing here that native changed. The flow has two
possible last hops now — the web app's address, or `sidequestd://`, which the
phone answers and the browser it opened hands straight back — and the choice
rides in the signed state rather than in a parameter of the callback's own. A
query parameter naming the redirect target is an open redirect with extra steps;
the state is already signed, already short-lived, and already the thing this
endpoint trusts, so it costs one claim to make the choice unforgeable.

Steam's `realm` and `return_to` are untouched by any of it. They are this API's
own URLs, they are what Steam signs, and they have to stay the addresses of a
real HTTPS server — only the hop *after* verification differs.

Everything else here is an ordinary authenticated JSON endpoint.
"""

from __future__ import annotations

import uuid
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Query, Request, status
from fastapi.responses import RedirectResponse

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.core.config import settings
from app.core.security import (
    OAUTH_CLIENT_NATIVE,
    OAUTH_CLIENT_WEB,
    InvalidTokenError,
    OAuthClient,
    create_oauth_state_token,
    decode_oauth_state_token,
)
from app.models.connections import PlatformAccount
from app.models.enums import ConnectionProvider
from app.schemas.connections import (
    ConnectionStart,
    ConnectionStatus,
    LinkedAccount,
    PlatformShowcase,
    PlaytimeSuggestion,
    ShowcaseGame,
    VisibilityUpdate,
)
from app.schemas.game import GameSummary
from app.services import connections as connections_service
from app.services import steam as steam_service
from app.services import users as users_service
from app.services.exceptions import (
    PlatformAccountTakenError,
    ServiceError,
    SteamVerificationError,
)

router = APIRouter(tags=["connections"])

# Where the callback sends the browser when it is done. One place so the success
# and failure paths cannot drift apart — and so both clients route the outcome to
# the same screen, which is what lets them share `callbackMessage` in
# `@sidequestd/core` for turning a code into a sentence.
_SETTINGS_PATH = "/settings/connections"


def _redirect_to_client(client: OAuthClient, **params: str) -> RedirectResponse:
    query = urlencode(params)
    if client == OAUTH_CLIENT_NATIVE:
        # `sidequestd://settings/connections?…`. The browser the app opened for
        # the sign-in refuses to navigate to a scheme it does not handle and
        # hands the URL back to the app instead, which is the whole mechanism:
        # the result arrives as a return value rather than as a page.
        target = f"{settings.native_app_scheme}://{_SETTINGS_PATH.lstrip('/')}?{query}"
    else:
        target = f"{settings.web_app_url.rstrip('/')}{_SETTINGS_PATH}?{query}"
    # 303: the browser arrived here on Steam's redirect and must follow this one
    # with a GET regardless of what it thinks it was doing.
    return RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)


async def _linked_payload(db: DbSession, account: PlatformAccount) -> LinkedAccount:
    stats = await connections_service.get_library_stats(db, account.id)
    payload = LinkedAccount.model_validate(account)
    return payload.model_copy(
        update={
            "sync_cooldown_minutes": connections_service.sync_cooldown_remaining(account),
            "total_games": stats.total_games,
            "matched_games": stats.matched_games,
            "total_playtime_minutes": stats.total_playtime_minutes,
        }
    )


@router.get(
    "/me/connections",
    response_model=ConnectionStatus,
    summary="The platform accounts you have linked",
)
async def read_my_connections(db: DbSession, current_user: CurrentUser) -> ConnectionStatus:
    """Also reports whether linking is available at all.

    A deployment without a Steam Web API key cannot complete the flow, and a
    connect button that always fails is worse than no button — so the client is
    told rather than left to discover it at the end.
    """
    account = await connections_service.get_account(db, current_user.id, ConnectionProvider.STEAM)
    return ConnectionStatus(
        steam_available=steam_service.steam_is_configured(),
        accounts=[await _linked_payload(db, account)] if account else [],
    )


@router.get(
    "/me/connections/playtime",
    response_model=PlaytimeSuggestion,
    summary="Your platform playtime for one game",
)
async def read_playtime_suggestion(
    db: DbSession,
    current_user: CurrentUser,
    game_id: Annotated[uuid.UUID, Query(description="Catalog id of the game")],
) -> PlaytimeSuggestion:
    """What the review composer offers as a prefill.

    Separate from the badge on purpose. This is a suggestion into a field the
    author still owns and can overwrite; the badge is the platform's own figure
    shown as evidence. Conflating them would mean either overwriting what
    somebody typed or claiming their typing was verified.
    """
    item = await connections_service.get_verified_playtime(db, current_user.id, game_id)
    return PlaytimeSuggestion(
        game_id=game_id,
        playtime_minutes=item.playtime_minutes if item else None,
        provider=ConnectionProvider.STEAM if item else None,
    )


@router.get(
    "/users/{user_id}/connections",
    response_model=list[PlatformShowcase],
    summary="The platforms shown on someone's profile",
    responses={403: {"description": "That account is private and you are not approved"}},
)
async def read_profile_connections(
    db: DbSession, viewer: OptionalUser, user_id: uuid.UUID
) -> list[PlatformShowcase]:
    """Empty rather than 404 when there is nothing to show.

    Gated twice: `require_visible_profile` is the same follow-graph check the rest
    of a profile goes through, and `is_visible` is the member's own switch for
    this particular link. Both have to pass — being willing to be seen is not the
    same as being willing to publish your play habits.
    """
    owner = await users_service.get_by_id(db, user_id)
    await users_service.require_content_access(db, owner, viewer.id if viewer else None)

    account = await connections_service.get_account(db, user_id, ConnectionProvider.STEAM)
    if account is None or not account.is_visible:
        return []

    stats = await connections_service.get_library_stats(db, account.id)
    most_played = await connections_service.get_most_played(db, account.id)
    return [
        PlatformShowcase(
            provider=account.provider,
            provider_username=account.provider_username,
            profile_url=account.profile_url,
            total_games=stats.total_games,
            total_playtime_minutes=stats.total_playtime_minutes,
            most_played=[
                ShowcaseGame(
                    game=GameSummary.model_validate(game),
                    playtime_minutes=item.playtime_minutes,
                    last_played_at=item.last_played_at,
                )
                for item, game in most_played
            ],
        )
    ]


@router.get(
    "/connections/steam/start",
    response_model=ConnectionStart,
    summary="Begin linking a Steam account",
    responses={503: {"description": "Steam linking is not configured here"}},
)
async def start_steam_link(
    current_user: CurrentUser,
    client: Annotated[
        OAuthClient,
        Query(description="Which client is asking, so the callback knows where to send them back"),
    ] = OAUTH_CLIENT_WEB,
) -> ConnectionStart:
    """Hand back the Steam URL to send the member to.

    Returned rather than redirected: the caller is the app's own client making an
    authenticated XHR, and it needs to move its *top-level* window to this URL.
    Answering with a 302 would only redirect the fetch. The phone does the same
    thing with `openAuthSessionAsync`, which is the platform's own window for
    exactly this — a browser the app can open and be handed the result of.

    Defaulting to `web` rather than requiring the parameter keeps the web
    client's request the one it has always sent, and means a client that has not
    heard of this cannot accidentally aim the callback at an app.
    """
    steam_service.require_configured()
    state = create_oauth_state_token(
        current_user.id,
        steam_service.PROVIDER,
        ttl_minutes=settings.steam_state_ttl_minutes,
        client=client,
    )
    return ConnectionStart(authorize_url=steam_service.build_authorize_url(state))


@router.get(
    "/connections/steam/callback",
    summary="Where Steam returns the member after they approve",
    include_in_schema=False,
    response_class=RedirectResponse,
)
async def finish_steam_link(
    request: Request,
    db: DbSession,
    background: BackgroundTasks,
    state: Annotated[str, Query(description="The signed state issued by /start")] = "",
) -> RedirectResponse:
    """Verify the assertion, store the link, and bounce back to whichever client began it.

    Every failure ends in a redirect carrying an `error` code rather than an HTTP
    error, because the thing reading this response is a browser address bar in the
    middle of a user journey, not a client that can render a JSON body.
    """
    try:
        began = decode_oauth_state_token(state, steam_service.PROVIDER)
    except InvalidTokenError:
        # Covers expiry, tampering, and a state minted for another provider. All
        # of them mean "start again", which is what the client offers.
        #
        # And the one case with no client to send it to: the state is where that
        # answer lives, so an unreadable state has none. The web is the honest
        # fallback — a `sidequestd://` URL on a machine with no app installed is
        # a dead end that reports nothing, where the web address is a page that
        # can say what went wrong to anybody who lands on it.
        return _redirect_to_client(OAUTH_CLIENT_WEB, error="state")

    try:
        steam_id = await steam_service.verify_callback(dict(request.query_params))
    except SteamVerificationError:
        return _redirect_to_client(began.client, error="verification")
    except ServiceError:
        return _redirect_to_client(began.client, error="unavailable")

    profile = await steam_service.fetch_profile(steam_id)
    if profile is None:
        # Verified as genuine but Steam will not describe the account. Nothing
        # useful can be stored or shown, so this is not treated as a link.
        return _redirect_to_client(began.client, error="profile")

    try:
        account = await connections_service.link_steam_account(db, began.user_id, profile)
    except PlatformAccountTakenError:
        return _redirect_to_client(began.client, error="taken")
    await db.commit()

    # The first sync runs after the response, on the same pattern the review
    # media pipeline uses: it takes seconds and the member is watching a redirect.
    background.add_task(steam_service.sync_library_in_background, account.id)
    return _redirect_to_client(began.client, connected="steam")


@router.post(
    "/connections/steam/sync",
    response_model=LinkedAccount,
    summary="Re-sync your Steam library now",
    responses={
        404: {"description": "You have not linked a Steam account"},
        429: {"description": "Synced too recently"},
    },
)
async def sync_steam_library(
    db: DbSession, current_user: CurrentUser, background: BackgroundTasks
) -> LinkedAccount:
    """Queue a refresh and hand back the link as it stands.

    Deliberately not the finished result: a full library takes seconds to walk,
    and holding the request open for it would make the button feel broken. The
    client polls `GET /me/connections` for the outcome, which it needs to do
    anyway for the sync the callback schedules.
    """
    account = await connections_service.require_account(
        db, current_user.id, ConnectionProvider.STEAM
    )
    connections_service.require_sync_allowed(account)
    background.add_task(steam_service.sync_library_in_background, account.id)
    return await _linked_payload(db, account)


@router.patch(
    "/connections/steam/visibility",
    response_model=LinkedAccount,
    summary="Show or hide the link on your profile",
    responses={404: {"description": "You have not linked a Steam account"}},
)
async def update_steam_visibility(
    db: DbSession, current_user: CurrentUser, payload: VisibilityUpdate
) -> LinkedAccount:
    """Hiding also withdraws the verified badge from this member's reviews."""
    account = await connections_service.set_visibility(
        db, current_user.id, ConnectionProvider.STEAM, is_visible=payload.is_visible
    )
    return await _linked_payload(db, account)


@router.delete(
    "/connections/steam",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink your Steam account",
    responses={404: {"description": "You have not linked a Steam account"}},
)
async def unlink_steam(db: DbSession, current_user: CurrentUser) -> None:
    """Takes the synced library with it, by cascade."""
    await connections_service.unlink_account(db, current_user.id, ConnectionProvider.STEAM)
