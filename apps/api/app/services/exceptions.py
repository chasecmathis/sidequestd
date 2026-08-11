"""Domain errors raised by services and translated to HTTP responses in main.py.

Keeping these separate from HTTPException means the service layer stays usable
from background workers and the CLI, not just from request handlers.
"""

from __future__ import annotations


class ServiceError(Exception):
    """Base class. `status_code` drives the HTTP response."""

    status_code: int = 400
    detail: str = "Request could not be processed."

    def __init__(self, detail: str | None = None) -> None:
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class ConflictError(ServiceError):
    """A uniqueness constraint the user can fix by choosing another value."""

    status_code = 409

    def __init__(self, detail: str, *, field: str) -> None:
        self.field = field
        super().__init__(detail)


class UsernameTakenError(ConflictError):
    def __init__(self) -> None:
        super().__init__("That username is already taken.", field="username")


class EmailTakenError(ConflictError):
    def __init__(self) -> None:
        super().__init__("An account with that email address already exists.", field="email")


class InvalidCredentialsError(ServiceError):
    status_code = 401
    # Deliberately does not say which half was wrong — that would confirm which
    # emails and usernames are registered.
    detail = "Incorrect username, email, or password."


class InactiveAccountError(ServiceError):
    status_code = 403
    detail = "This account has been deactivated."


class InvalidRefreshTokenError(ServiceError):
    status_code = 401
    detail = "Your session has expired. Please sign in again."


class InvalidResetTokenError(ServiceError):
    status_code = 400
    detail = "This password reset link is invalid or has expired."


class GameNotFoundError(ServiceError):
    status_code = 404
    detail = "That game is not in the catalog."


class InvalidCursorError(ServiceError):
    status_code = 400
    # Cursors are opaque and only ever come from a previous response, so a bad
    # one means a hand-edited URL rather than something the user can fix.
    detail = "That pagination cursor is not valid. Start from the first page."


class UserNotFoundError(ServiceError):
    status_code = 404
    detail = "No such user."


class ProfileIsPrivateError(ServiceError):
    """SPEC §6.7: the shell is public, everything behind it needs approval.

    403 rather than 404: the account demonstrably exists — it is returned by
    search and its shell is readable — so pretending otherwise would only
    confuse the client without hiding anything.
    """

    status_code = 403
    detail = "This account is private. Follow them to see their activity."


class SelfFollowError(ServiceError):
    status_code = 400
    # `no_self_follow` on the follows table would catch this anyway, but as a
    # 500 several layers from the mistake. SPEC §6.7 makes following a
    # relationship between two people, so this is a malformed request.
    detail = "You cannot follow yourself."


class FollowRequestNotFoundError(ServiceError):
    status_code = 404
    # Also raised when the edge exists but is already ACCEPTED: there is nothing
    # left to approve, and saying so is friendlier than a conflict about a
    # request the user can no longer see.
    detail = "There is no pending follow request from that user."


class NotAFollowerError(ServiceError):
    status_code = 404
    # A pending request is not a follower — declining is the verb for that, so
    # this deliberately does not remove one.
    detail = "That user is not one of your followers."


class AlreadyFavoritedError(ConflictError):
    def __init__(self) -> None:
        super().__init__("That game is already one of your favorites.", field="game_id")


class FavoriteLimitReachedError(ServiceError):
    status_code = 409

    def __init__(self, limit: int) -> None:
        super().__init__(
            f"Favorites are capped at {limit} games. Remove one before adding another."
        )


class FavoriteNotFoundError(ServiceError):
    status_code = 404
    detail = "That game is not one of your favorites."


class InvalidFavoriteOrderError(ServiceError):
    status_code = 400
    # A reorder is a permutation of what is already there. Anything else is a
    # client bug — most likely a stale list — and silently adding or dropping
    # rows to make it fit would lose whatever the other tab had just changed.
    detail = "The new order must list exactly the games currently in your favorites."


class BacklogItemNotFoundError(ServiceError):
    status_code = 404
    detail = "That game is not on any of your lists."


class InvalidBacklogOrderError(ServiceError):
    status_code = 400
    # Same rule as favorites: a reorder is a permutation of what is on the list.
    # Anything else means the client is working from a stale copy, and a game the
    # request does not mention is one another tab may have just moved.
    detail = "The new order must list exactly the games currently on that list."


class UnsupportedMediaTypeError(ServiceError):
    status_code = 415

    def __init__(self, allowed: str) -> None:
        super().__init__(f"Unsupported file type. Allowed: {allowed}.")


class FileTooLargeError(ServiceError):
    status_code = 413

    def __init__(self, max_bytes: int) -> None:
        super().__init__(f"That file is too large. The limit is {max_bytes // 1024 // 1024} MB.")


class StorageUnavailableError(ServiceError):
    status_code = 503
    detail = "File storage is unavailable right now. Please try again in a moment."


class ReviewNotFoundError(ServiceError):
    status_code = 404
    detail = "That review does not exist."


class ReviewAlreadyExistsError(ConflictError):
    """SPEC §6.3: one review per user per game, enforced by a unique constraint.

    Points at editing rather than just refusing: the user's intent — "record what
    I think of this game" — is still achievable, just through a different verb.
    """

    def __init__(self) -> None:
        super().__init__(
            "You have already reviewed this game. Edit your existing review instead.",
            field="game_id",
        )


class NotReviewOwnerError(ServiceError):
    status_code = 403
    detail = "You can only edit or delete your own reviews."


class CommentNotFoundError(ServiceError):
    status_code = 404
    detail = "That comment does not exist."


class NotCommentOwnerError(ServiceError):
    status_code = 403
    # Deliberately not extended to the review's author: moderating other people's
    # words on your review is a product decision SPEC §6.10 does not make, and
    # quietly allowing it here would be that decision made by accident.
    detail = "You can only edit or delete your own comments."


class CommentDepthError(ServiceError):
    status_code = 400
    # SPEC §6.10 caps threading at one level. Rejecting rather than re-parenting
    # to the top-level ancestor: silently attaching a reply somewhere other than
    # where it was aimed changes who it reads as answering.
    detail = "Replies can only be made to a top-level comment, not to another reply."


class MediaLimitReachedError(ServiceError):
    status_code = 409

    def __init__(self, limit: int) -> None:
        super().__init__(f"A review can hold at most {limit} photos or clips.")


class MultipleVideosError(ServiceError):
    status_code = 409
    # SPEC §6.3 caps MVP at one clip per review; multiple videos is named there as
    # a fast-follow, so this is a temporary limit rather than a rule.
    detail = "A review can include one video clip. Remove the existing clip first."


class VideoTooLongError(ServiceError):
    status_code = 400

    def __init__(self, max_seconds: int) -> None:
        super().__init__(f"Video clips must be {max_seconds} seconds or shorter.")


class UnreadableMediaError(ServiceError):
    status_code = 400
    # The bytes sniffed as a format we accept but then would not parse, so the
    # file is truncated or corrupt rather than the wrong kind of thing.
    detail = "That file could not be read. It may be incomplete — try uploading it again."


class MediaNotFoundError(ServiceError):
    status_code = 404
    detail = "That media item is not attached to this review."


class IgdbNotConfiguredError(ServiceError):
    status_code = 503
    detail = (
        "IGDB credentials are not configured. Set IGDB_CLIENT_ID and "
        "IGDB_CLIENT_SECRET, or import the bundled seed fixture instead."
    )
