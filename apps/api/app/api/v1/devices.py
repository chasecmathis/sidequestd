"""Push device registration — SPEC §6.12, §8.

Two endpoints, both about the caller's own phone. Like the notifications router
next door, neither takes a user id: a device belongs to whoever is signed in on
it, and an id in the path would only be a way to register a token against
somebody else.

`/users/me/devices` rather than the notifications root, because this is one more
thing that hangs off the signed-in member alongside `/users/me/avatar` and
`/users/me/favorites` — but it is tagged `notifications`, since delivery is the
only reason it exists and the generated client should file it there.

The router is registered ahead of `app.api.v1.users` so these literal paths are
matched before that module's `/users/{username}`. They differ by method today,
so nothing would break in the other order; the ordering is stated rather than
relied upon, which is the same care `users.py` takes internally.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Path

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.schemas.device import DeviceRegistered, DeviceRegistration
from app.services import devices as devices_service

router = APIRouter(prefix="/users/me/devices", tags=["notifications"])

Token = Annotated[str, Path(min_length=1, max_length=512, description="The token to forget")]


@router.post("", response_model=DeviceRegistered, summary="Register this device for push")
async def register_device(
    db: DbSession, current_user: CurrentUser, payload: DeviceRegistration
) -> DeviceRegistered:
    """Put a push token on file for the caller (SPEC §6.12).

    Idempotent, and idempotent in the strong sense: sending a token that is
    already registered to somebody *else* moves it to the caller rather than
    failing. That is not a convenience — a phone that changes hands would
    otherwise keep receiving the previous member's notifications on its lock
    screen, and the previous member is in no position to tell us to stop.

    Always a 200. There is nothing a client could do about a refusal here except
    lose its notifications, and the response says whether this deployment can
    deliver anything at all so a client can be honest about what it promised.
    """
    _ = await devices_service.register(
        db, current_user, token=payload.token, platform=payload.platform
    )
    return DeviceRegistered(registered=True, push_enabled=settings.push_enabled)


@router.delete("/{token}", response_model=DeviceRegistered, summary="Stop pushing to this device")
async def forget_device(db: DbSession, current_user: CurrentUser, token: Token) -> DeviceRegistered:
    """What signing out sends, before the session goes.

    A 200 whether or not there was a row, for the same reason unliking something
    you never liked is a success: the caller wanted this device not to be
    registered, and it is not. A 404 here would also confirm to anyone guessing
    tokens which of them exist.

    The token is a path segment and contains brackets — `ExponentPushToken[…]` —
    so a client has to percent-encode it. That is the only sharp edge in this
    module and it is the client's to handle.
    """
    _ = await devices_service.unregister(db, current_user, token=token)
    return DeviceRegistered(registered=False, push_enabled=settings.push_enabled)
