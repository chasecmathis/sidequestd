"""The Home feed (SPEC §6.4, §8).

A feed item is an **envelope**, not a review. SPEC §6.4 says Home is unified —
"Alex added *Elden Ring* to Playing" sits inline between reviews, and §6.11 calls
those activity events — so the wire shape carried a `type` discriminator from the
first version, when `FeedItem` was still a union of one. The backlog slice is the
event source that made it real, and doing so cost exactly what it was supposed
to: one member and one enum value. A client that was already switching on
`item.type` keeps working; one that had assumed a bare review would have needed
rewriting. The recommended blend from SPEC §6.4 is the third member and cost the
same, which is the whole argument for the shape.

`id` and `occurred_at` are on the envelope rather than read off the payload,
because they are what a client needs *before* it knows what kind of item this is:
a key to render the list by, and the value it is ordered on. Reaching inside for
them — `item.review.id` — is code that crashes on the first activity event rather
than skipping it, which is the one failure this whole shape exists to prevent.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.models.enums import BacklogStatus
from app.schemas.game import GameSummary, TrendingGame
from app.schemas.review import ReviewSummary
from app.schemas.user import UserPublic


class FeedItemType(enum.StrEnum):
    """What kind of thing an item is. Extended, never renamed — the value is on
    the wire and clients branch on it.

    Each value names a *specific* event rather than a category, so a second kind
    of activity is a new member of the union carrying its own fields, instead of
    a pile of optional ones on an existing member that only some events fill in.
    """

    REVIEW = "review"
    BACKLOG_ACTIVITY = "backlog_activity"
    RECOMMENDED_REVIEW = "recommended_review"


class RecommendationReason(enum.StrEnum):
    """Why a recommended item is in front of you (SPEC §6.4, §6.5).

    SPEC §6.4 asks for the blend to be "clearly distinguishable from pure follow
    feed", and a separate `type` is what makes it distinguishable. This is the
    next question a reader asks once they have noticed — *why this?* — and it is
    a closed set rather than a sentence because the client writes the sentence
    and can translate it.
    """

    RECOMMENDED_GAME = "recommended_game"
    SUGGESTED_ACCOUNT = "suggested_account"


class FeedReviewItem(BaseModel):
    """A review from someone the viewer follows — the hero content of SPEC §6.4.

    The review is the full `ReviewSummary` every other surface returns, counters
    included, so a feed row renders a live like button and comment count without
    a second request per item.
    """

    # No default, so the discriminator is *required* on the wire rather than
    # optional: a client that has to check whether the field is there before
    # branching on it is a client that will forget to.
    type: Literal[FeedItemType.REVIEW]
    id: uuid.UUID = Field(
        description="The item's id — the review's, for this kind. Unique per `type`."
    )
    occurred_at: datetime = Field(description="What the feed is ordered by, newest first")
    review: ReviewSummary


class FeedActivityItem(BaseModel):
    """Someone you follow moved a game between backlog lists (SPEC §6.11).

    The lightweight half of the unified Home from SPEC §6.4 — "Alex added *Elden
    Ring* to Playing", "Sam completed *Hades*" — which exists so Home still has a
    pulse on a day when nobody you follow wrote a review. Reviews stay the hero
    content; this is a line, not a card.

    Only the *current* status is here, not what it moved from. The event is
    derived from the backlog row itself rather than from an events table, and
    that row remembers where a game is, not the route it took. "Completed
    *Hades*" is the whole of what SPEC §6.11 asks for, and inventing a `from`
    field the data cannot back would be worse than not having one.
    """

    type: Literal[FeedItemType.BACKLOG_ACTIVITY]
    id: uuid.UUID = Field(description="The backlog item's id. Unique per `type`.")
    occurred_at: datetime = Field(description="When the status changed, newest first")
    actor: UserPublic = Field(description="Whose list moved")
    game: GameSummary
    status: BacklogStatus = Field(description="The list the game is on now")


class FeedRecommendedItem(BaseModel):
    """A review from outside the follow graph, blended in (SPEC §6.4).

    Its own member of the union rather than a `recommended: bool` on
    `FeedReviewItem`, because SPEC §6.4 requires the blend to be "clearly
    distinguishable from pure follow feed" and a flag is exactly the thing a
    client forgets to read. A type it has to branch on cannot be missed, and the
    branch is where the label and the "why" go.

    The payload is the identical `ReviewSummary`, so a recommended row is as
    interactive as any other — likeable, commentable, and by an author the reader
    can follow on the spot. Nothing about the review is different; only how it
    got here.
    """

    type: Literal[FeedItemType.RECOMMENDED_REVIEW]
    id: uuid.UUID = Field(description="The review's id. Unique per `type`.")
    occurred_at: datetime = Field(description="When the review was written, newest first")
    review: ReviewSummary
    reason: RecommendationReason = Field(description="What put this in front of the reader")


FeedItem = Annotated[
    FeedReviewItem | FeedActivityItem | FeedRecommendedItem, Field(discriminator="type")
]


class FeedSuggestions(BaseModel):
    """What Home shows instead of a feed when there is nothing to show.

    SPEC §6.4 asks for suggested accounts and trending content for a viewer who
    follows nobody. Both sections are deliberately small: this is a prompt to go
    and follow someone, not a second Discover tab.
    """

    accounts: list[UserPublic] = Field(
        description="Public accounts worth following, most-followed first, "
        "excluding anyone the viewer already follows or has asked to."
    )
    trending: list[TrendingGame] = Field(
        description="The materialised ranking from SPEC §6.11. Empty until the "
        "trending job has run against some activity."
    )
