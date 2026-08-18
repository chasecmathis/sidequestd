"""SQLAlchemy models for the SPEC §7 data model.

Importing this package registers every mapper on ``Base.metadata``, which is what
Alembic's autogenerate compares against.
"""

from app.db.base import Base
from app.models.auth import PasswordResetToken, RefreshToken
from app.models.backlog import BacklogItem
from app.models.connections import PlatformAccount, PlatformLibraryItem
from app.models.enums import (
    BacklogStatus,
    ConnectionProvider,
    FollowStatus,
    LibraryMatchSource,
    MediaType,
    NotificationType,
    PlatformSyncStatus,
    ProcessingStatus,
)
from app.models.game import (
    Game,
    GameExternalId,
    Genre,
    Platform,
    TrendingScore,
    game_genres,
    game_platforms,
)
from app.models.notification import Notification
from app.models.review import Comment, Like, Review, ReviewMedia
from app.models.social import Follow
from app.models.user import FavoriteGame, User

__all__ = [
    "BacklogItem",
    "BacklogStatus",
    "Base",
    "Comment",
    "ConnectionProvider",
    "FavoriteGame",
    "Follow",
    "FollowStatus",
    "Game",
    "GameExternalId",
    "Genre",
    "LibraryMatchSource",
    "Like",
    "MediaType",
    "Notification",
    "NotificationType",
    "PasswordResetToken",
    "Platform",
    "PlatformAccount",
    "PlatformLibraryItem",
    "PlatformSyncStatus",
    "ProcessingStatus",
    "RefreshToken",
    "Review",
    "ReviewMedia",
    "TrendingScore",
    "User",
    "game_genres",
    "game_platforms",
]
