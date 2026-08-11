"""User-facing representations. `hashed_password` is never part of any of them."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.models.enums import FollowState
from app.models.user import BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH, USERNAME_MAX_LENGTH
from app.schemas.game import GameSummary

# Instagram-style handles: letters, digits, underscore and dot.
USERNAME_PATTERN = re.compile(r"^[a-zA-Z0-9._]+$")

Username = Annotated[
    str,
    StringConstraints(min_length=3, max_length=USERNAME_MAX_LENGTH, strip_whitespace=True),
]
DisplayName = Annotated[
    str, StringConstraints(min_length=1, max_length=DISPLAY_NAME_MAX_LENGTH, strip_whitespace=True)
]
Bio = Annotated[str, StringConstraints(max_length=BIO_MAX_LENGTH)]


def validate_username(value: str) -> str:
    """Shared by every schema that accepts a handle; normalises to lower case."""
    if not USERNAME_PATTERN.match(value):
        raise ValueError("Username may only contain letters, numbers, underscores and periods.")
    if value.startswith(".") or value.endswith("."):
        raise ValueError("Username may not start or end with a period.")
    if ".." in value:
        raise ValueError("Username may not contain consecutive periods.")
    return value.lower()


class UserPublic(BaseModel):
    """The profile shell visible to anyone, including non-followers of a private
    account (SPEC §6.7)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str | None
    bio: str | None
    avatar_url: str | None
    is_private: bool
    created_at: datetime


class UserMe(UserPublic):
    """The authenticated user's own record — adds fields that are private to them."""

    email: str
    email_verified_at: datetime | None


class UserUpdate(BaseModel):
    """PATCH body for `/users/me`.

    Absent and null mean different things: an omitted key leaves the column
    alone, an explicit `null` clears it. That is why every field defaults to None
    *and* the handler reads `model_fields_set` rather than the values — sending
    `{"bio": null}` has to be able to erase a bio.
    """

    display_name: DisplayName | None = None
    bio: Bio | None = None
    is_private: bool | None = Field(
        default=None, description="SPEC §6.7. Going private keeps existing followers."
    )

    model_config = ConfigDict(extra="forbid")


class UsernameAvailability(BaseModel):
    username: str
    available: bool


# --- Profiles (SPEC §6.2, §6.8) --------------------------------------------


class RatingBucket(BaseModel):
    """One bar of the rating distribution chart (SPEC §6.8)."""

    rating: int = Field(description="1-10, where 10 is five stars")
    count: int


class ProfileStats(BaseModel):
    """Light gamification only — SPEC §6.8 rules out leaderboards and points.

    Every count is zero and `average_rating` is null on an account with no
    activity: an average of nothing is not 0.0, and saying it is would draw a bar
    chart implying the user rates everything terribly.
    """

    games_reviewed: int
    review_count: int
    average_rating: float | None = Field(
        default=None,
        description="Mean rating given, on the 1-10 scale. Null when nothing is rated.",
    )
    total_playtime_minutes: int = Field(description="Summed over reviews that recorded playtime")
    completed_count: int = Field(description="Backlog items marked COMPLETED")
    backlog_count: int = Field(description="Backlog items still on the To Be Played list")
    rating_distribution: list[RatingBucket] = Field(
        description="Always 1-10 inclusive, zero-filled, so a client can draw the axis blind."
    )
    member_since: datetime


class FavoriteGameEntry(BaseModel):
    """A pinned game plus where it sits in the curated order (SPEC §6.2)."""

    position: int
    game: GameSummary


class UserProfile(UserPublic):
    """A profile as one viewer sees it (SPEC §6.2).

    The shell — avatar, handle, display name, bio, follower counts — is public
    even for a private account, because SPEC §6.7 needs a stranger to be able to
    find the account and send a follow request. Everything gated sits behind
    `can_view_content`: `stats` is null and `favorite_games` is empty when the
    viewer has not been approved, and the followers/following *lists* refuse
    outright. Counts stay visible either way, as they do on Instagram.
    """

    follower_count: int
    following_count: int
    is_viewer: bool = Field(description="True when this is the caller's own profile")
    can_view_content: bool = Field(
        description="False for a private account the viewer does not follow (SPEC §6.7)"
    )
    viewer_follow_state: FollowState = Field(
        description="What the viewer's Follow button should say. NONE when signed "
        "out and on your own profile, where there is no button to draw."
    )
    follows_viewer: bool = Field(
        description="True when this account follows the caller — an accepted edge "
        "the caller may remove (SPEC §6.7). A pending request does not count."
    )
    # Required rather than defaulted, so both are always present in the payload
    # and a client never has to tell "absent" apart from "gated".
    favorite_games: list[FavoriteGameEntry]
    stats: ProfileStats | None


class FavoriteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_id: uuid.UUID = Field(description="Catalog id; the game must already exist")


class FavoriteReorder(BaseModel):
    """A permutation of the current favorites — see `InvalidFavoriteOrderError`."""

    model_config = ConfigDict(extra="forbid")

    game_ids: list[uuid.UUID] = Field(description="Every current favorite, in the new order")


class AvailabilityQuery(BaseModel):
    username: Username = Field(description="Handle to check for availability")

    @field_validator("username")
    @classmethod
    def _check_username(cls, value: str) -> str:
        return validate_username(value)
