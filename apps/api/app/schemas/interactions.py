"""Likes and comments (SPEC §6.10, §8).

The counters here are the same three fields every review response already
carries, in their own envelope: a like button needs to know what its number
became, and a review is a large thing to re-read to find out.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, computed_field

from app.models.review import COMMENT_MAX_LENGTH
from app.schemas.user import UserPublic

CommentText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=COMMENT_MAX_LENGTH, strip_whitespace=True),
]


class ReviewInteractions(BaseModel):
    """A review's counters after a like or an unlike.

    Carries `comment_count` as well, so one type describes the whole footer of a
    review rather than the half this endpoint happened to touch — a client that
    renders both from one object cannot end up showing two different reviews'
    numbers side by side.
    """

    review_id: uuid.UUID
    like_count: int
    comment_count: int
    viewer_has_liked: bool = Field(description="Whether the caller has liked this review")


class CommentItem(BaseModel):
    """One comment, top-level or reply (SPEC §6.10)."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    review_id: uuid.UUID
    author: UserPublic
    parent_comment_id: uuid.UUID | None = Field(
        description="The top-level comment this answers, or null when it is one"
    )
    text: str
    created_at: datetime
    updated_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def edited(self) -> bool:
        """Whether the text has been changed since it was posted.

        Derived here rather than left to the client: both timestamps are set from
        the same statement on insert, so the comparison is exact, and four clients
        each deciding how much clock skew counts as "edited" would not be.
        """
        return self.updated_at > self.created_at


class CommentThread(CommentItem):
    """A top-level comment with the replies underneath it.

    One level deep and no cursor on `replies`: SPEC §6.10 caps threading at a
    single level, so this is the whole subtree rather than the first page of it.
    """

    replies: list[CommentItem]


class CommentCreate(BaseModel):
    """POST /reviews/{id}/comments."""

    model_config = ConfigDict(extra="forbid")

    text: CommentText
    parent_comment_id: uuid.UUID | None = Field(
        default=None,
        description="Reply to this comment. It must be a top-level comment on the "
        "same review (SPEC §6.10 allows one level of threading).",
    )


class CommentUpdate(BaseModel):
    """PATCH /comments/{id}. Text is the only thing a comment has to change."""

    model_config = ConfigDict(extra="forbid")

    text: CommentText
