"""Follow actions and requests (SPEC §6.7, §8)."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import FollowState
from app.schemas.user import UserPublic


class FollowResult(BaseModel):
    """One directed edge as it stands after an action.

    Every mutating endpoint returns this, including the ones that removed the
    edge — a Follow button has to render *something* afterwards, and a `state` of
    NONE says what without a second request. `follower_count` is the number
    beside that button, so it moves in the same response that moved it.
    """

    model_config = ConfigDict(from_attributes=True)

    follower_id: uuid.UUID
    followee_id: uuid.UUID
    state: FollowState
    follower_count: int = Field(description="How many followers the followee has now")


class FollowRequest(BaseModel):
    """A pending request the signed-in user has received (SPEC §6.7).

    Only the requester's public shell: they are asking for access to gated
    content precisely because they do not have it yet, so the decision is made on
    the handle, name and picture alone.
    """

    model_config = ConfigDict(from_attributes=True)

    user: UserPublic
    requested_at: datetime
