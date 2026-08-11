"""Notification representations (SPEC §6.12, §8).

A notification is a *sentence with a link*: "Sam liked your review of Hades",
tapping through to the review. So the wire shape is the parts of that sentence —
who (`actor`), what happened (`type`), and what it happened to (`review`,
`comment`) — and the client assembles the words, because the words are the one
part of this that has to be translated and re-worded without a deploy.

The targets are nullable and which of them is filled depends on `type`. That is
not modelled as a discriminated union the way `FeedItem` is, and the difference
is deliberate: a feed item's *payload* changes shape per kind, while every
notification renders identically — avatar, sentence, timestamp — and only the
sentence differs. A union here would make seven members that a client would
immediately flatten back into one row component.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import NotificationType
from app.schemas.game import GameSummary
from app.schemas.user import UserPublic


class NotificationReviewTarget(BaseModel):
    """The review a notification is about, as its sentence needs it.

    The game and nothing else: every sentence that carries a review names it by
    the game — "your review of *Hades*" — and the review's own author is the
    recipient on every type that has one, so sending it back would be telling
    them who they are.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    game: GameSummary


class NotificationCommentTarget(BaseModel):
    """The comment a notification is about (SPEC §6.10, §6.12).

    `text` is the whole comment rather than a snippet: SPEC §6.10 caps a comment
    at 500 characters, so the "excerpt" a list row wants is a substring of
    something already small, and cutting it here would only mean deciding on the
    server how many characters a client's row happens to fit.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    review_id: uuid.UUID = Field(description="Where the comment lives — the link target")
    text: str


class NotificationItem(BaseModel):
    """One row of the Notifications tab (SPEC §6.12)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: NotificationType = Field(description="What happened; the client turns it into a sentence")
    actor: UserPublic | None = Field(
        description="Who did it. Null only for a notification the system raised "
        "rather than a person, which nothing produces yet."
    )
    review: NotificationReviewTarget | None = Field(
        description="Set for likes, comments, replies and backlog-game-reviewed"
    )
    comment: NotificationCommentTarget | None = Field(
        description="Set for comments and replies; the review it belongs to is on `review`"
    )
    is_read: bool
    created_at: datetime


class UnreadCount(BaseModel):
    """What the badge on the Notifications tab shows (SPEC §6.12)."""

    count: int = Field(ge=0, description="Unread notifications for the caller")


class NotificationReadRequest(BaseModel):
    """POST /notifications/read.

    Omit `ids` — or send null — to mark the whole inbox read, which is SPEC
    §6.12's "mark all". An explicitly *empty* list marks nothing, on purpose: a
    client that meant "mark these" and computed an empty selection should get a
    no-op rather than silently clear the badge.
    """

    model_config = ConfigDict(extra="forbid")

    ids: list[uuid.UUID] | None = Field(
        default=None, description="Notifications to mark read; null or absent means all of them"
    )


class NotificationReadResult(BaseModel):
    """What changed, and what the badge should say now.

    Both numbers, so pressing "mark all read" is one round trip rather than a
    write followed by a re-read of the count it just changed.
    """

    marked: int = Field(ge=0, description="How many rows went from unread to read")
    unread_count: int = Field(ge=0, description="What is still unread afterwards")
