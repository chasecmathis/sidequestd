"""Probing, thumbnailing, and the PENDING → READY transition — SPEC §6.3.

The pipeline runs offline: images go through Pillow and a clip's length is read
out of its container, so nothing here needs ffmpeg or a bucket.
"""

from __future__ import annotations

import io
import struct
import uuid
from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import MediaType, ProcessingStatus
from app.models.game import Game
from app.models.review import Review, ReviewMedia
from app.models.user import User
from app.services import media as media_service
from app.services import storage
from app.services.exceptions import UnreadableMediaError, UnsupportedMediaTypeError
from tests.conftest import GIF_1PX, PNG_1PX, PNG_4X2, FakeObjectStore, _box, make_mp4

MakeUser = Callable[..., Awaitable[User]]

MP4_5S = make_mp4(5.0)


# --- Sniffing video (SPEC §6.3 formats) -------------------------------------


@pytest.mark.parametrize(
    ("brand", "expected"),
    [
        (b"isom", "video/mp4"),
        (b"mp42", "video/mp4"),
        (b"avc1", "video/mp4"),
        (b"qt  ", "video/quicktime"),
    ],
)
def test_video_brands_are_recognised(brand: bytes, expected: str) -> None:
    assert storage.detect_content_type(make_mp4(1.0, brand=brand)) == expected


def test_an_audio_only_container_is_not_video() -> None:
    # `M4A ` is the same ISO box structure with no picture in it. Accepting any
    # `ftyp` would let it through and then fail to play.
    assert storage.detect_content_type(make_mp4(1.0, brand=b"M4A ")) is None


def test_images_are_still_recognised() -> None:
    assert storage.detect_content_type(PNG_1PX) == "image/png"
    assert storage.detect_content_type(GIF_1PX) == "image/gif"


def test_the_extension_follows_the_sniffed_type() -> None:
    review_id = uuid.uuid4()

    key = storage.build_key(storage.REVIEW_VIDEO_POLICY, review_id, "video/quicktime")

    assert key.startswith(f"reviews/{review_id}/")
    assert key.endswith(".mov")


# --- Reading a clip's length ------------------------------------------------


def test_duration_comes_from_the_movie_header() -> None:
    assert media_service.video_duration(make_mp4(12.5)) == pytest.approx(12.5)


def test_a_non_default_timescale_is_respected() -> None:
    # Timescale is ticks per second; 90kHz is common in broadcast-derived files.
    assert media_service.video_duration(make_mp4(3.0, timescale=90_000)) == pytest.approx(3.0)


def test_a_64_bit_movie_header_is_read() -> None:
    # Version 1 widens the creation, modification and duration fields.
    header = struct.pack(">4sQQIQ", b"\x01\x00\x00\x00", 0, 0, 1000, 7000)
    data = _box(b"ftyp", b"isom" + struct.pack(">I", 512) + b"isom") + _box(
        b"moov", _box(b"mvhd", header + bytes(80))
    )

    assert media_service.video_duration(data) == pytest.approx(7.0)


def test_a_file_with_no_movie_box_has_no_duration() -> None:
    assert media_service.video_duration(b"\x00\x00\x00\x14ftypisom\x00\x00\x02\x00isom") is None


def test_an_unknown_duration_reads_as_no_duration() -> None:
    # A fragmented MP4 writes 0xFFFFFFFF here and puts the real length in the
    # fragments. Treating that as 4294967 seconds would refuse the file for being
    # too long, which is the wrong reason.
    header = struct.pack(">4sIIII", b"\x00\x00\x00\x00", 0, 0, 1000, 0xFFFFFFFF)
    data = _box(b"ftyp", b"isom" + struct.pack(">I", 512) + b"isom") + _box(
        b"moov", _box(b"mvhd", header + bytes(80))
    )

    assert media_service.video_duration(data) is None


def test_a_truncated_box_stops_the_walk_instead_of_raising() -> None:
    # Someone else's file, cut short mid-upload.
    assert media_service.video_duration(make_mp4(5.0)[:20]) is None


# --- Inspecting an upload ---------------------------------------------------


def test_inspecting_an_image_reports_its_dimensions() -> None:
    probe = media_service.inspect(PNG_4X2)

    assert probe.media_type is MediaType.IMAGE
    assert (probe.width, probe.height) == (4, 2)
    assert probe.duration_seconds is None


def test_inspecting_a_clip_reports_its_length() -> None:
    probe = media_service.inspect(MP4_5S)

    assert probe.media_type is MediaType.VIDEO
    assert probe.duration_seconds == pytest.approx(5.0)
    assert probe.width is None


def test_inspecting_something_we_do_not_accept_raises() -> None:
    with pytest.raises(UnsupportedMediaTypeError):
        media_service.inspect(b"%PDF-1.7\n")


def test_a_png_header_with_no_image_behind_it_raises() -> None:
    with pytest.raises(UnreadableMediaError):
        media_service.inspect(PNG_1PX[:20])


# --- Thumbnailing -----------------------------------------------------------


def _jpeg(width: int, height: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "navy").save(buffer, format="JPEG")
    return buffer.getvalue()


def test_a_thumbnail_fits_inside_the_target_box() -> None:
    thumbnail, width, height = media_service.render_thumbnail(_jpeg(2000, 1000))

    assert (width, height) == (2000, 1000)
    with Image.open(io.BytesIO(thumbnail)) as rendered:
        assert rendered.size == (640, 320)
        assert rendered.format == "JPEG"


def test_a_small_image_is_not_blown_up() -> None:
    thumbnail, _, _ = media_service.render_thumbnail(_jpeg(80, 40))

    with Image.open(io.BytesIO(thumbnail)) as rendered:
        assert rendered.size == (80, 40)


def test_a_transparent_png_thumbnails_without_an_alpha_channel() -> None:
    # JPEG has no alpha, so the conversion has to happen rather than throw.
    buffer = io.BytesIO()
    Image.new("RGBA", (10, 10), (255, 0, 0, 0)).save(buffer, format="PNG")

    thumbnail, _, _ = media_service.render_thumbnail(buffer.getvalue())

    with Image.open(io.BytesIO(thumbnail)) as rendered:
        assert rendered.mode == "RGB"


# --- Processing (SPEC §6.3: status transitions) -----------------------------

REVIEWS = "/api/v1/reviews"


@pytest.fixture
def headers(registered_user: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {registered_user['access_token']}"}


@pytest.fixture
async def review_id(client: AsyncClient, headers: dict[str, str], catalog: list[Game]) -> uuid.UUID:
    response = await client.post(
        REVIEWS, headers=headers, json={"game_id": str(catalog[0].id), "rating": 8}
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def attach(
    client: AsyncClient, headers: dict[str, str], review_id: uuid.UUID, payload: bytes
) -> uuid.UUID:
    response = await client.post(
        f"{REVIEWS}/{review_id}/media",
        headers=headers,
        files={"file": ("file.bin", payload, "application/octet-stream")},
    )
    assert response.status_code == 201, response.text
    return uuid.UUID(response.json()["id"])


async def test_processing_takes_an_image_from_pending_to_ready(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    media_id = await attach(client, headers, review_id, PNG_4X2)
    assert (await db.get(ReviewMedia, media_id)).processing_status is ProcessingStatus.PENDING  # type: ignore[union-attr]

    item = await media_service.process_media(db, media_id)

    assert item is not None
    assert item.processing_status is ProcessingStatus.READY


async def test_processing_fills_in_the_thumbnail_and_dimensions(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    media_id = await attach(client, headers, review_id, PNG_4X2)

    item = await media_service.process_media(db, media_id)

    assert item is not None
    assert (item.width, item.height) == (4, 2)
    assert item.thumbnail_url is not None
    assert item.thumbnail_url.endswith("_thumb.jpg")


async def test_the_thumbnail_is_stored_alongside_the_original(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    media_id = await attach(client, headers, review_id, PNG_4X2)

    await media_service.process_media(db, media_id)

    assert len(object_store.keys) == 2
    thumbnail_key = next(key for key in object_store.keys if key.endswith("_thumb.jpg"))
    payload, content_type = object_store.objects[thumbnail_key]
    assert content_type == "image/jpeg"
    with Image.open(io.BytesIO(payload)) as rendered:
        assert rendered.format == "JPEG"


async def test_the_review_shows_the_thumbnail_once_processed(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    # What the profile grid tiles on (SPEC §6.2).
    media_id = await attach(client, headers, review_id, PNG_4X2)
    await media_service.process_media(db, media_id)

    body = (await client.get(f"{REVIEWS}/{review_id}")).json()

    assert body["media"][0]["processing_status"] == "READY"
    assert body["thumbnail_url"] == body["media"][0]["thumbnail_url"]


async def test_processing_a_clip_records_its_length(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    media_id = await attach(client, headers, review_id, MP4_5S)

    item = await media_service.process_media(db, media_id)

    assert item is not None
    assert item.processing_status is ProcessingStatus.READY
    assert item.duration_seconds == pytest.approx(5.0)


async def test_a_clip_gets_no_poster_frame_yet(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    # Extracting a frame needs ffmpeg, which this slice deliberately does without.
    # Clients fall back to the game's cover art rather than waiting for one.
    media_id = await attach(client, headers, review_id, MP4_5S)

    item = await media_service.process_media(db, media_id)

    assert item is not None
    assert item.thumbnail_url is None
    assert len(object_store.keys) == 1


async def test_processing_twice_does_not_redo_the_work(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    # The background task and the catch-up worker can both reach the same row.
    media_id = await attach(client, headers, review_id, PNG_4X2)
    await media_service.process_media(db, media_id)
    first = dict(object_store.objects)

    await media_service.process_media(db, media_id)

    assert object_store.objects.keys() == first.keys()


async def test_a_corrupt_file_ends_up_failed_rather_than_stuck(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    # Truncated after the upload passed its header check — the pixels are gone.
    media_id = await attach(client, headers, review_id, PNG_4X2)
    key = next(iter(object_store.objects))
    object_store.objects[key] = (PNG_4X2[:24], "image/png")

    item = await media_service.process_media(db, media_id)

    assert item is not None
    assert item.processing_status is ProcessingStatus.FAILED


async def test_a_row_pointing_outside_our_bucket_fails_instead_of_retrying(
    db: AsyncSession, review_id: uuid.UUID, object_store: FakeObjectStore
) -> None:
    item = ReviewMedia(
        review_id=review_id,
        type=MediaType.IMAGE,
        url="https://images.igdb.com/somebody-elses.png",
        position=0,
    )
    db.add(item)
    await db.flush()

    processed = await media_service.process_media(db, item.id)

    assert processed is not None
    assert processed.processing_status is ProcessingStatus.FAILED


async def test_processing_an_item_that_no_longer_exists_is_harmless(
    db: AsyncSession,
) -> None:
    assert await media_service.process_media(db, uuid.uuid4()) is None


# --- The catch-up worker ----------------------------------------------------


async def test_the_worker_drains_what_uploads_left_pending(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    for _ in range(3):
        await attach(client, headers, review_id, PNG_4X2)

    handled = await media_service.process_pending(db)

    assert handled == 3
    review = await db.get(Review, review_id)
    assert review is not None
    await db.refresh(review, ["media"])
    assert [item.processing_status for item in review.media] == [ProcessingStatus.READY] * 3


async def test_the_worker_has_nothing_to_do_on_a_clean_queue(db: AsyncSession) -> None:
    assert await media_service.process_pending(db) == 0


async def test_the_worker_respects_its_batch_size(
    client: AsyncClient,
    db: AsyncSession,
    headers: dict[str, str],
    review_id: uuid.UUID,
    object_store: FakeObjectStore,
) -> None:
    for _ in range(3):
        await attach(client, headers, review_id, PNG_4X2)

    assert await media_service.process_pending(db, limit=2) == 2
    assert await media_service.process_pending(db) == 1
