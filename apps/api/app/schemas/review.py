"""Review representations (SPEC §6.3, §8).

Ratings travel as the stored 1-10 integer, with `stars` alongside as the 0.5-5.0
value SPEC §6.3 specifies for display. Both are on the wire on purpose: the
integer is what a client sends back and what stats are computed from, and the
float is what every surface renders, so deriving it in one place stops four
clients from disagreeing about how to round.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, computed_field, field_validator

from app.models.enums import MediaType, ProcessingStatus
from app.models.review import MAX_RATING, MIN_RATING, REVIEW_TEXT_MAX_LENGTH
from app.schemas.connections import VerifiedPlaytime
from app.schemas.game import GameSummary
from app.schemas.user import UserPublic

Rating = Annotated[
    int,
    Field(
        ge=MIN_RATING,
        le=MAX_RATING,
        description="Half-star stops on a five-star scale, stored 1-10 (SPEC §6.3)",
    ),
]
ReviewText = Annotated[str, Field(min_length=1, max_length=REVIEW_TEXT_MAX_LENGTH)]
PlaytimeMinutes = Annotated[
    int, Field(ge=0, description="Minutes the author says they played, if they tracked it")
]


class ReviewMediaItem(BaseModel):
    """One slot in the carousel (SPEC §6.3).

    `processing_status` is what a client polls: an item arrives PENDING with only
    its original URL, and gains `thumbnail_url` and dimensions when it reaches
    READY. Video never gains a thumbnail in this slice — see
    `app.services.media._process_video` — so clients fall back to the game's cover
    art in grid surfaces rather than waiting for one.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    type: MediaType
    url: str
    thumbnail_url: str | None
    width: int | None
    height: int | None
    duration_seconds: float | None
    alt_text: str | None = Field(description="Author-supplied description (SPEC §9 accessibility)")
    position: int
    processing_status: ProcessingStatus


class ReviewSummary(BaseModel):
    """A review as a feed row or a grid tile shows it.

    No `from_attributes`: the counters are not columns, so this is assembled from
    a `ReviewWithStats` rather than validated straight off the model.
    """

    id: uuid.UUID
    author: UserPublic
    game: GameSummary
    rating: int
    review_text: str | None
    playtime_minutes: int | None
    created_at: datetime
    updated_at: datetime

    like_count: int
    comment_count: int
    viewer_has_liked: bool = Field(
        description="Whether the caller has liked this. Always false when signed out."
    )

    media_count: int
    thumbnail_url: str | None = Field(
        description="What the profile grid tiles with: the first media thumbnail, "
        "falling back to the game's cover art (SPEC §6.2)."
    )

    verified_playtime: VerifiedPlaytime | None = Field(
        default=None,
        description=(
            "Playtime the author's linked platform published for this game, when "
            "the library entry was matched by store id. Distinct from "
            "`playtime_minutes`, which is what the author typed: this one is "
            "evidence and that one is a claim. Absent when the author has no "
            "linked account, has hidden it, or the game only matched by title."
        ),
    )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def stars(self) -> float:
        """The 0.5-5.0 value from SPEC §6.3. Derived so clients cannot drift."""
        return self.rating / 2


class ReviewDetail(ReviewSummary):
    """Everything the Review Detail screen needs, carousel included (SPEC §6.3)."""

    media: list[ReviewMediaItem]


class ReviewCreate(BaseModel):
    """POST /reviews. One per game — see `ReviewAlreadyExistsError`."""

    model_config = ConfigDict(extra="forbid")

    game_id: uuid.UUID = Field(description="Catalog id; the game must already exist")
    rating: Rating
    review_text: ReviewText | None = None
    playtime_minutes: PlaytimeMinutes | None = None


class ReviewUpdate(BaseModel):
    """PATCH /reviews/{id}, with the same semantics as `UserUpdate`.

    An omitted key is left alone and an explicit null clears the column, which is
    how a user deletes the text of a review without deleting the rating with it.
    The game is deliberately absent: see `app.services.reviews.update_review`.
    """

    model_config = ConfigDict(extra="forbid")

    rating: Rating | None = None
    review_text: ReviewText | None = None
    playtime_minutes: PlaytimeMinutes | None = None

    @field_validator("rating")
    @classmethod
    def _rating_cannot_be_cleared(cls, value: int | None) -> int | None:
        """Null clears the other two fields, but a review without a rating is not
        a review — SPEC §6.3 makes the text and the playtime the optional parts.

        Only runs on a value the client actually sent, so leaving `rating` out
        still means "don't touch it".
        """
        if value is None:
            raise ValueError("A review must keep a rating. Delete the review instead.")
        return value
