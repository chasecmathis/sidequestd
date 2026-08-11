"""Search result shapes (SPEC §6.6).

Game results reuse `GameSummary`. Users get their own shape because a result card
must not leak anything a private account gates — see `UserSearchResult`.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

SearchQuery = Annotated[str, StringConstraints(min_length=1, max_length=100, strip_whitespace=True)]


class UserSearchResult(BaseModel):
    """A user search card.

    SPEC §6.7: a private account still *appears* in search — hiding it would make
    it impossible to send a follow request — but everything gated behind approval
    is withheld. The shell (handle, display name, avatar) is always present;
    `review_count` is a stat, so it is null unless the viewer may see it.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str | None
    avatar_url: str | None
    is_private: bool
    review_count: int | None = Field(
        default=None,
        description="Null when the account is private and the viewer is not an approved follower.",
    )
