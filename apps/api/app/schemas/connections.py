"""Linked platform accounts on the wire.

Two audiences, two shapes. `ConnectionStatus` is what the owner sees on their
settings screen: whether a link exists, when it last synced, and what went wrong
if anything did. `PlatformShowcase` is what everybody else sees on their profile,
and it deliberately carries no sync diagnostics — a stranger has no use for
another member's sync error, and "their last sync failed" is not a fact about a
profile worth publishing.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import ConnectionProvider, PlatformSyncStatus
from app.schemas.game import GameSummary


class LinkedAccount(BaseModel):
    """The link itself, as its owner sees it."""

    model_config = ConfigDict(from_attributes=True)

    provider: ConnectionProvider
    provider_account_id: str = Field(description="SteamID64 for Steam")
    provider_username: str | None = Field(default=None, description="Persona name, mirrored")
    provider_avatar_url: str | None = None
    profile_url: str | None = None
    is_visible: bool = Field(description="Whether the link shows on the member's profile")
    connected_at: datetime
    last_synced_at: datetime | None = Field(
        default=None, description="Null until the first sync has run"
    )
    last_sync_status: PlatformSyncStatus | None = Field(
        default=None,
        description=(
            "PROFILE_PRIVATE is split out from FAILED because it is the one "
            "outcome the member can fix themselves, by making their Steam game "
            "details public."
        ),
    )
    sync_cooldown_minutes: int = Field(
        default=0, description="Minutes until a manual re-sync is allowed; 0 when it is"
    )
    total_games: int = 0
    matched_games: int = Field(
        default=0,
        description="How many library entries resolved to a catalog game. The rest "
        "are tools, soundtracks and games the catalog has not imported.",
    )
    total_playtime_minutes: int = 0


class ConnectionStatus(BaseModel):
    """`GET /me/connections` — every link the caller holds, plus availability."""

    steam_available: bool = Field(
        description="False when this deployment has no Steam Web API key, in which "
        "case the client should not offer the connect button at all."
    )
    accounts: list[LinkedAccount]


class ConnectionStart(BaseModel):
    """Where to send the browser to begin linking."""

    authorize_url: str


class VisibilityUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_visible: bool


class ShowcaseGame(BaseModel):
    """One game on a profile's platform showcase."""

    model_config = ConfigDict(from_attributes=True)

    game: GameSummary
    playtime_minutes: int
    last_played_at: datetime | None = None


class PlatformShowcase(BaseModel):
    """A linked platform as it appears on somebody else's profile."""

    provider: ConnectionProvider
    provider_username: str | None = None
    profile_url: str | None = None
    total_games: int
    total_playtime_minutes: int
    most_played: list[ShowcaseGame]


class VerifiedPlaytime(BaseModel):
    """Playtime the platform published, attached to a review at read time.

    Derived on every read rather than stored on the review. That is what keeps it
    honest: it cannot drift from the library it came from, and it disappears the
    moment the member unlinks or hides the connection, which a column copied at
    write time could not do.
    """

    model_config = ConfigDict(from_attributes=True)

    provider: ConnectionProvider
    playtime_minutes: int
    last_played_at: datetime | None = None


class PlaytimeSuggestion(BaseModel):
    """`GET /me/connections/playtime` — a prefill for the review composer."""

    game_id: uuid.UUID
    playtime_minutes: int | None = Field(
        default=None, description="Null when no linked library has this game"
    )
    provider: ConnectionProvider | None = None
