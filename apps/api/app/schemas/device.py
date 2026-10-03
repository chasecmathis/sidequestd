"""Registering a phone for push (SPEC §6.12).

Deliberately the smallest pair of shapes in the API. A device is an address and
a label for which store it came from; anything else a client might want to send —
a model name, an app version, a locale — would be data collected because it was
easy rather than because a notification needs it.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import DevicePlatform


class DeviceRegistration(BaseModel):
    """POST /users/me/devices.

    Idempotent by design: the client registers on every cold start rather than
    tracking whether it has registered before, because a token can be reissued
    by the OS at any time and a client that only registered once would go quiet
    without noticing.
    """

    model_config = ConfigDict(extra="forbid")

    token: str = Field(
        min_length=1,
        max_length=512,
        description="An Expo push token — `ExponentPushToken[…]`",
        examples=["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"],
    )
    platform: DevicePlatform = Field(description="Which store's build this token came from")


class DeviceRegistered(BaseModel):
    """What registration answers with.

    A body rather than a 204 for one reason: `push_enabled` tells the client
    whether this deployment can actually deliver anything, which is the
    difference between "we will notify you" and "we wrote your address down".
    A client that knows the answer can keep polling honestly instead of
    promising a badge that will never move on its own.
    """

    registered: bool = Field(description="The token is on file for the caller")
    push_enabled: bool = Field(description="Whether this deployment sends push at all")
