"""Test fixtures.

The suite runs against a real Postgres database (`sidequestd_test`, created by
infra/postgres/init) rather than SQLite, so the Alembic migration, the check
constraints, and the enum types are all exercised as they run in production.

Each test gets a session joined to an outer transaction that is rolled back
afterwards, so `commit()` inside application code behaves normally while leaving
the database untouched between tests.
"""

from __future__ import annotations

import os

# Must be set before app.core.config is imported: settings are read once at
# import time and cached.
os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://sidequestd:sidequestd@localhost:5432/sidequestd_test"
)
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("SECRET_KEY", "test-secret-key-not-used-anywhere-else")
os.environ.setdefault("MIN_PASSWORD_LENGTH", "10")
# Push delivery is scheduled from a commit hook, so leaving it on would make
# every producer's test — every like, follow and comment — reach for the network
# on its way past. `tests/test_push.py` drives `app.services.push` directly, with
# the HTTP client substituted, which is where that behaviour is actually pinned.
os.environ.setdefault("PUSH_ENABLED", "false")

import base64
import struct
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from dataclasses import dataclass, field

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.db.session import get_db
from app.main import create_app
from app.models.enums import NotificationType
from app.models.game import Game
from app.models.review import Review
from app.models.user import User
from app.services import media as media_service
from app.services import notifications, storage
from app.services.games_import import (
    SEED_SOURCE,
    load_seed_records,
    refresh_facet_counts,
    upsert_games,
)
from app.services.reviews import refresh_game_rating

TEST_PASSWORD = "correct-horse-battery-staple"

# The bundled fixture is committed data, so tests can name titles from it.
SEED_GAME_COUNT = 24


@pytest.fixture(scope="session", autouse=True)
def _migrated_database() -> Iterator[None]:
    """Rebuild the test schema from the Alembic migration once per session."""
    engine = sa.create_engine(settings.sync_database_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as connection:
        connection.execute(sa.text("DROP SCHEMA IF EXISTS public CASCADE"))
        connection.execute(sa.text("CREATE SCHEMA public"))
    engine.dispose()

    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", settings.sync_database_url)
    command.upgrade(config, "head")
    yield


@pytest.fixture
async def engine() -> AsyncIterator[sa.ext.asyncio.AsyncEngine]:
    """Function-scoped on purpose: asyncpg connections are bound to the event
    loop that opened them, and pytest-asyncio gives each test its own loop."""
    async_engine = create_async_engine(str(settings.database_url), poolclass=sa.pool.NullPool)
    yield async_engine
    await async_engine.dispose()


@pytest.fixture
async def db(engine: sa.ext.asyncio.AsyncEngine) -> AsyncIterator[AsyncSession]:
    """A session whose commits are savepoints inside a transaction we discard."""
    async with engine.connect() as connection:
        transaction = await connection.begin()
        session = AsyncSession(
            bind=connection,
            expire_on_commit=False,
            join_transaction_mode="create_savepoint",
        )
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()


@pytest.fixture
async def client(db: AsyncSession) -> AsyncIterator[AsyncClient]:
    app = create_app()

    async def _override_get_db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as http_client:
        yield http_client
    app.dependency_overrides.clear()


@dataclass(slots=True)
class SentEmail:
    to: str
    username: str
    reset_url: str

    @property
    def token(self) -> str:
        from urllib.parse import parse_qs, urlparse

        return parse_qs(urlparse(self.reset_url).query)["token"][0]


@pytest.fixture
def outbox(monkeypatch: pytest.MonkeyPatch) -> list[SentEmail]:
    """Capture password-reset emails instead of talking to SMTP."""
    sent: list[SentEmail] = []

    async def _capture(*, to: str, username: str, reset_url: str) -> None:
        sent.append(SentEmail(to=to, username=username, reset_url=reset_url))

    monkeypatch.setattr("app.services.auth.send_password_reset_email", _capture)
    return sent


@pytest.fixture
def registration_payload() -> dict[str, str]:
    return {
        "username": "ripley",
        "email": "ripley@example.com",
        "password": TEST_PASSWORD,
        "display_name": "Ellen Ripley",
    }


@pytest.fixture
async def registered_user(
    client: AsyncClient, registration_payload: dict[str, str]
) -> dict[str, object]:
    """A signed-up user plus the session issued at registration."""
    response = await client.post("/api/v1/auth/register", json=registration_payload)
    assert response.status_code == 201, response.text
    return dict(response.json())


# --- Games catalog ----------------------------------------------------------


@pytest.fixture
async def catalog(db: AsyncSession) -> list[Game]:
    """The bundled seed fixture, loaded through the real import path.

    Going through `upsert_games` rather than hand-building rows means the tests
    that read the catalog also cover the writer, and that the shipped fixture is
    verified rather than assumed to parse.

    The recount is the other half of that path — `app.cli.import_games` runs it
    at the end of every run — and without it the facet lists would come back in
    an order no real deployment ever serves.
    """
    await upsert_games(db, load_seed_records(), source=SEED_SOURCE)
    await refresh_facet_counts(db)
    return list((await db.execute(sa.select(Game))).scalars().all())


# --- Object storage ---------------------------------------------------------

# A real 1x1 PNG. The upload path sniffs the leading bytes rather than trusting
# the declared content type, so a test payload has to be a genuine image.
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
GIF_1PX = base64.b64decode("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")

# A 4x2 PNG, so a test can tell reported dimensions apart from a default.
PNG_4X2 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAFElEQVR4nGPkEjnBAANMcBYDAwMAFSAA6g/4K8QAAAAASUVORK5CYII="
)


def _box(box_type: bytes, body: bytes) -> bytes:
    """One ISO base media box: a 32-bit size, a four-character type, a payload."""
    return struct.pack(">I", len(body) + 8) + box_type + body


def make_mp4(seconds: float, *, brand: bytes = b"isom", timescale: int = 1000) -> bytes:
    """An MP4 container carrying a real movie header and no actual video.

    Built rather than committed as a fixture because the only part under test is
    the header the pipeline reads: the sniffed brand and the duration that the
    60-second cap in SPEC §6.3 is checked against. A genuine encoded clip would
    add megabytes to the repository and test ffmpeg rather than our parser.
    """
    ftyp = _box(b"ftyp", brand + struct.pack(">I", 512) + brand)
    # version+flags, creation, modification, timescale, duration, then the rate,
    # volume and matrix fields the parser skips.
    header = struct.pack(">4sIIII", b"\x00\x00\x00\x00", 0, 0, timescale, int(seconds * timescale))
    return ftyp + _box(b"moov", _box(b"mvhd", header + bytes(80)))


@dataclass(slots=True)
class FakeObjectStore:
    """Stands in for MinIO so the suite needs no bucket to run.

    Only the two functions that cross the network are replaced — validation, key
    generation and URL construction are the real code, so the parts most likely
    to be wrong are still under test.
    """

    objects: dict[str, tuple[bytes, str]] = field(default_factory=dict)
    deleted: list[str] = field(default_factory=list)

    @property
    def keys(self) -> list[str]:
        return list(self.objects)


@pytest.fixture
def object_store(monkeypatch: pytest.MonkeyPatch) -> FakeObjectStore:
    store = FakeObjectStore()

    async def _put(key: str, data: bytes, content_type: str) -> str:
        store.objects[key] = (data, content_type)
        return storage.public_url(key)

    async def _get(key: str) -> bytes:
        return store.objects[key][0]

    async def _delete(key: str) -> None:
        store.deleted.append(key)
        store.objects.pop(key, None)

    monkeypatch.setattr(storage, "put_object", _put)
    monkeypatch.setattr(storage, "get_object", _get)
    monkeypatch.setattr(storage, "delete_object", _delete)
    return store


@pytest.fixture(autouse=True)
def media_queue(monkeypatch: pytest.MonkeyPatch) -> list[uuid.UUID]:
    """Capture what an upload schedules instead of letting it run.

    Autouse because the real background task opens its *own* session — it runs
    after the response, when the request's session is gone — and that session
    would sit outside the transaction each test is rolled back inside. It would
    find no row, do nothing, and cost a connection. Tests drive
    `app.services.media` directly against `db` instead, which is also what makes
    the PENDING → READY transition observable rather than a race.
    """
    scheduled: list[uuid.UUID] = []

    async def _capture(media_id: uuid.UUID) -> None:
        scheduled.append(media_id)

    monkeypatch.setattr(media_service, "process_in_background", _capture)
    return scheduled


# --- Notifications (SPEC §6.12) ---------------------------------------------


@dataclass(slots=True)
class EmittedNotification:
    recipient_id: uuid.UUID
    actor_id: uuid.UUID
    type: NotificationType
    review_id: uuid.UUID | None = None
    comment_id: uuid.UUID | None = None


@pytest.fixture
def notifications_log(monkeypatch: pytest.MonkeyPatch) -> list[EmittedNotification]:
    """Capture what an action hands to the notifications seam, instead of storing it.

    `emit` writes a real row now, and `tests/test_notifications.py` asserts on
    those rows. This stays because it tests the other half: that each *producer*
    addresses the right event to the right person with the right target, which is
    a fact about the producer and should not have to be read back out of a table
    to be checked. Substituting the seam is also what makes "nothing at all was
    emitted" an assertion rather than an absence.
    """
    emitted: list[EmittedNotification] = []

    async def _capture(
        _db: AsyncSession,
        *,
        recipient_id: uuid.UUID,
        actor_id: uuid.UUID,
        type: NotificationType,
        review_id: uuid.UUID | None = None,
        comment_id: uuid.UUID | None = None,
    ) -> None:
        emitted.append(
            EmittedNotification(
                recipient_id=recipient_id,
                actor_id=actor_id,
                type=type,
                review_id=review_id,
                comment_id=comment_id,
            )
        )

    monkeypatch.setattr(notifications, "emit", _capture)
    return emitted


@pytest.fixture
def make_user(db: AsyncSession) -> Callable[..., Awaitable[User]]:
    """Create a user directly, skipping the registration round trip."""

    async def _make(
        username: str,
        *,
        display_name: str | None = None,
        bio: str | None = None,
        is_private: bool = False,
    ) -> User:
        user = User(
            username=username,
            email=f"{username}@example.com",
            hashed_password=hash_password(TEST_PASSWORD),
            display_name=display_name,
            bio=bio,
            is_private=is_private,
        )
        db.add(user)
        await db.flush()
        return user

    return _make


@pytest.fixture
def make_review(db: AsyncSession, catalog: list[Game]) -> Callable[..., Awaitable[Review]]:
    """A review by whoever asked for it, on a game from the seed catalog.

    Written straight to the database rather than posted: the interaction tests
    need something to like and comment on, and going through `POST /reviews`
    would make every one of them depend on the review endpoints working too.

    It does still refresh the game's rating counters, because bypassing the
    service must not mean bypassing the invariant — a fixture-built review that
    left `games.rating_average` disagreeing with `reviews` would surface as a
    failure in some unrelated test that merely happened to read a game.
    """

    async def _make(author: User, *, game: Game | None = None, rating: int = 8) -> Review:
        review = Review(user_id=author.id, game_id=(game or catalog[0]).id, rating=rating)
        db.add(review)
        await db.flush()
        await refresh_game_rating(db, review.game_id)
        return review

    return _make


@pytest.fixture
def auth_headers() -> Callable[[User], dict[str, str]]:
    """Sign in as a `make_user` account without a login round trip."""

    def _headers(user: User) -> dict[str, str]:
        return {"Authorization": f"Bearer {create_access_token(user.id).token}"}

    return _headers
