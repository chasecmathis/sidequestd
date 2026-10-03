"""The push address book (SPEC §6.12).

Three operations and no cleverness: put a token on file for somebody, take it
off, and list the ones a recipient can be reached at. `app.services.push` is what
uses the third; the first two are the endpoints under `/users/me/devices`.

The one decision worth reading twice lives in `register`. Registering a token
that already exists **moves** it to the caller instead of adding a second row,
because the token identifies a *device* and a device has one owner. Sign out on a
phone and hand it to somebody else, and the row has to follow the phone —
otherwise the first account's notifications keep arriving on a lock screen the
first account no longer controls. Client-side deregistration on logout is the
first line of defence and this is the one that does not depend on the client
still being reachable when it happens.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.device import DeviceToken
from app.models.enums import DevicePlatform
from app.models.user import User


async def register(
    db: AsyncSession, user: User, *, token: str, platform: DevicePlatform
) -> DeviceToken:
    """Put `token` on file for `user`, or move it to them if it was elsewhere.

    One statement, because the read-then-write spelling has a race the client is
    actually capable of losing: the app registers on every cold start, and two
    launches close together — a notification tap that wakes a killed app while
    the user is also opening it — would both find no row and both insert one,
    which the unique constraint would then reject as a 500.
    """
    statement = (
        pg_insert(DeviceToken)
        .values(user_id=user.id, token=token, platform=platform)
        .on_conflict_do_update(
            constraint="uq_device_tokens_token",
            set_={
                "user_id": user.id,
                "platform": platform,
                "last_seen_at": sa.func.now(),
            },
        )
        .returning(DeviceToken)
    )
    device = (await db.scalars(statement)).one()
    await db.commit()
    return device


async def unregister(db: AsyncSession, user: User, *, token: str) -> bool:
    """Take a token off file. True when a row was actually removed.

    Scoped to the caller by the WHERE, so naming somebody else's token deletes
    nothing and is reported as a miss rather than as a 403 — the same reasoning
    `notifications.mark_read` gives, and the same reason: a 403 would confirm
    that a guessed token is real and in use.

    A miss is not an error at the endpoint either. Signing out of an app whose
    permission was never granted has no token to send, and signing out twice
    should not fail the second time.
    """
    removed = (
        await db.scalars(
            sa.delete(DeviceToken)
            .where(DeviceToken.user_id == user.id, DeviceToken.token == token)
            .returning(DeviceToken.id)
        )
    ).all()
    await db.commit()
    return len(removed) > 0


async def tokens_for(db: AsyncSession, recipient_ids: Iterable[uuid.UUID]) -> Sequence[str]:
    """Every address the given members can be reached at.

    Takes a set of recipients rather than one, so the fan-out notification —
    "somebody you follow reviewed a game on your list", which can have dozens of
    recipients — costs one query rather than one per person.
    """
    ids = list(recipient_ids)
    if not ids:
        return []

    rows = await db.scalars(sa.select(DeviceToken.token).where(DeviceToken.user_id.in_(ids)))
    return list(rows)


async def forget(db: AsyncSession, tokens: Sequence[str]) -> int:
    """Drop tokens the push service has told us are dead. Returns how many went.

    Expo answers a send with `DeviceNotRegistered` for an app that has been
    uninstalled or whose token was reissued, and that is the only reliable
    signal this table ever gets that a row is rubbish. Not acting on it means
    every future fan-out carries a growing tail of addresses that cannot
    receive, which is how a push implementation quietly becomes slow.
    """
    if not tokens:
        return 0

    removed = (
        await db.scalars(
            sa.delete(DeviceToken).where(DeviceToken.token.in_(tokens)).returning(DeviceToken.id)
        )
    ).all()
    await db.commit()
    return len(removed)
