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


class NotificationType(enum.StrEnum):
    NEW_FOLLOWER = "NEW_FOLLOWER"
    FOLLOW_REQUEST = "FOLLOW_REQUEST"
    FOLLOW_REQUEST_APPROVED = "FOLLOW_REQUEST_APPROVED"
    REVIEW_LIKED = "REVIEW_LIKED"
    REVIEW_COMMENTED = "REVIEW_COMMENTED"
    COMMENT_REPLIED = "COMMENT_REPLIED"
    BACKLOG_GAME_REVIEWED = "BACKLOG_GAME_REVIEWED"
