"""Enumerations used across the schema (SPEC §7)."""

from __future__ import annotations

import enum


class FollowStatus(enum.StrEnum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"


class FollowState(enum.StrEnum):
    """One viewer's standing with another account, as a Follow button shows it.

    Derived, never stored: `NONE` is the absence of a `Follow` row and the other
    two are that row's `FollowStatus`. It lives beside the status it flattens so
    the mapping is readable in one place — nothing persists this, so it needs no
    enum type in the database and no migration.
    """

    NONE = "NONE"
    REQUESTED = "REQUESTED"
    FOLLOWING = "FOLLOWING"


class MediaType(enum.StrEnum):
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"


class ProcessingStatus(enum.StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    READY = "READY"
    FAILED = "FAILED"


class BacklogStatus(enum.StrEnum):
    TO_BE_PLAYED = "TO_BE_PLAYED"
    PLAYING = "PLAYING"
    COMPLETED = "COMPLETED"
    DROPPED = "DROPPED"


class ConnectionProvider(enum.StrEnum):
    """A gaming platform a member can link their account to.

    Only Steam for now, and it is the only one with a sanctioned way in: Steam
    acts as an OpenID provider and publishes owned games and playtime through a
    documented Web API. PlayStation, Xbox and Nintendo have no public consumer
    API, so every client for them is reverse-engineered. The enum exists rather
    than a bare boolean so adding one later is a value, not a reshaping.
    """

    STEAM = "STEAM"


class LibraryMatchSource(enum.StrEnum):
    """How a synced library entry was resolved to a catalog game.

    This is the honesty mechanism behind the verified playtime badge.
    `EXTERNAL_ID` came from the store id IGDB publishes for the game and is
    exact. `TITLE` is a trigram guess, kept only so a member's showcase is not
    full of holes, and never allowed to back a verified claim.
    """

    EXTERNAL_ID = "EXTERNAL_ID"
    TITLE = "TITLE"


class PlatformSyncStatus(enum.StrEnum):
    """The outcome of the last library sync, as the settings screen reports it.

    `PROFILE_PRIVATE` is split out from `FAILED` because it is not a failure the
    app can fix and it is by far the most common one: Steam answers a member
    whose "Game details" are not public with an empty payload and a 200, which
    is indistinguishable from an empty library unless it is looked for. The
    member has to change a setting on Steam, and can only be told that if the
    case is carried this far.
    """

    OK = "OK"
    PROFILE_PRIVATE = "PROFILE_PRIVATE"
    FAILED = "FAILED"


class NotificationType(enum.StrEnum):
    NEW_FOLLOWER = "NEW_FOLLOWER"
    FOLLOW_REQUEST = "FOLLOW_REQUEST"
    FOLLOW_REQUEST_APPROVED = "FOLLOW_REQUEST_APPROVED"
    REVIEW_LIKED = "REVIEW_LIKED"
    REVIEW_COMMENTED = "REVIEW_COMMENTED"
    COMMENT_REPLIED = "COMMENT_REPLIED"
    BACKLOG_GAME_REVIEWED = "BACKLOG_GAME_REVIEWED"
