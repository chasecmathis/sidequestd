"""The review media pipeline (SPEC §6.3).

Two halves, on purpose:

* **Upload** is synchronous and cheap. It sniffs the file, checks it against the
  right `UploadPolicy`, and — for a clip — reads its length so the 60-second cap
  can be refused immediately rather than surfacing as a FAILED item minutes later.
  Nothing is decoded beyond the headers.
* **Processing** is asynchronous and does the expensive part: dimensions, a
  thumbnail for the grid, and the PENDING → READY transition clients poll on.

There is no queue yet, so processing is reached two ways: FastAPI schedules it
after the upload response (see `app.api.v1.reviews`), and `app.cli.process_media`
sweeps up anything a crash or restart stranded. Both call `process_media`, which
is idempotent — it only ever advances a row out of PENDING.

Everything runs offline. Images go through Pillow; a clip's duration is read
straight out of the ISO base media container, so there is no ffmpeg, no probe
subprocess and nothing to install beyond the Python dependencies. That does mean
video is *validated* but not *transcoded*, and has no poster frame — see
`_process_video`.
"""

from __future__ import annotations

import asyncio
import io
import logging
import struct
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import sqlalchemy as sa
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import SessionLocal
from app.models.enums import MediaType, ProcessingStatus
from app.models.review import ReviewMedia
from app.services import storage
from app.services.exceptions import UnreadableMediaError, VideoTooLongError

logger = logging.getLogger(__name__)

# SPEC §6.3.
MAX_VIDEO_SECONDS = 60

# Image policy first: it is the common case, and the two policies accept disjoint
# content types, so the order only affects how quickly the match is found.
REVIEW_POLICIES = (storage.REVIEW_IMAGE_POLICY, storage.REVIEW_VIDEO_POLICY)

# Big enough for a full-width phone carousel at 2x, small enough that a nine-tile
# profile grid is a few hundred kilobytes rather than a few megabytes.
THUMBNAIL_SIZE = (640, 640)
THUMBNAIL_QUALITY = 82

_MAX_UNSIGNED_32 = 0xFFFFFFFF
_MAX_UNSIGNED_64 = 0xFFFFFFFFFFFFFFFF


@dataclass(frozen=True, slots=True)
class MediaProbe:
    """What the headers say a file is, before anything is decoded."""

    media_type: MediaType
    content_type: str
    # The policy it was accepted under, so the caller builds its storage key from
    # the same decision that validated it rather than re-deriving one.
    policy: storage.UploadPolicy
    width: int | None
    height: int | None
    duration_seconds: float | None


# --- Reading the container --------------------------------------------------


def _boxes(data: bytes, start: int, end: int) -> Iterator[tuple[bytes, int, int]]:
    """Walk the ISO base media boxes in `data[start:end]`.

    Each box is a 32-bit big-endian size, a four-character type, then a payload.
    A size of 1 means the real size is the 64 bits that follow; 0 means "to the
    end". Anything that does not fit stops the walk rather than raising: the
    input is a stranger's file, and a truncated one should read as "no duration
    found", not as a crash.
    """
    offset = start
    while offset + 8 <= end:
        size = int.from_bytes(data[offset : offset + 4], "big")
        box_type = data[offset + 4 : offset + 8]
        header = 8

        if size == 1:
            if offset + 16 > end:
                return
            size = int.from_bytes(data[offset + 8 : offset + 16], "big")
            header = 16
        elif size == 0:
            size = end - offset

        if size < header or offset + size > end:
            return

        yield box_type, offset + header, offset + size
        offset += size


def _mvhd_duration(data: bytes, start: int, end: int) -> float | None:
    """Seconds from a movie header box: its duration divided by its timescale."""
    if end - start < 4:
        return None
    version = data[start]

    if version == 0 and end - start >= 20:
        timescale, duration = struct.unpack_from(">II", data, start + 12)
        unknown = duration == _MAX_UNSIGNED_32
    elif version == 1 and end - start >= 32:
        timescale, duration = struct.unpack_from(">IQ", data, start + 20)
        unknown = duration == _MAX_UNSIGNED_64
    else:
        return None

    if timescale == 0 or unknown:
        return None
    return float(duration) / float(timescale)


def video_duration(data: bytes) -> float | None:
    """A clip's length in seconds, or None if the container does not say.

    None happens for a fragmented MP4 (whose duration lives in the fragments) or
    when `moov` sits past the end of a truncated upload. Callers treat that as a
    reason to refuse the file rather than to guess: an unmeasurable clip cannot be
    held to the 60-second limit.
    """
    for box_type, body, end in _boxes(data, 0, len(data)):
        if box_type != b"moov":
            continue
        for inner_type, inner_body, inner_end in _boxes(data, body, end):
            if inner_type == b"mvhd":
                return _mvhd_duration(data, inner_body, inner_end)
    return None


def _image_size(data: bytes) -> tuple[int, int]:
    """Pixel dimensions, read from the header without decoding the pixels."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            return image.size
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise UnreadableMediaError from exc


def inspect(data: bytes) -> MediaProbe:
    """Validate an upload against the review policies and describe it.

    Raises `UnsupportedMediaTypeError` for anything not on the list, `FileTooLarge`
    past the size cap for its kind, and `VideoTooLongError` past 60 seconds.
    """
    policy, content_type = storage.match_policy(data, REVIEW_POLICIES)

    if content_type.startswith("video/"):
        duration = video_duration(data)
        if duration is None:
            raise UnreadableMediaError(
                "We could not read the length of that clip, so we can't check it "
                "against the 60-second limit. Re-export it as an MP4 and try again."
            )
        if duration > MAX_VIDEO_SECONDS:
            raise VideoTooLongError(MAX_VIDEO_SECONDS)
        return MediaProbe(
            media_type=MediaType.VIDEO,
            content_type=content_type,
            policy=policy,
            width=None,
            height=None,
            duration_seconds=duration,
        )

    width, height = _image_size(data)
    return MediaProbe(
        media_type=MediaType.IMAGE,
        content_type=content_type,
        policy=policy,
        width=width,
        height=height,
        duration_seconds=None,
    )


# --- Thumbnailing -----------------------------------------------------------


def render_thumbnail(data: bytes) -> tuple[bytes, int, int]:
    """A JPEG thumbnail plus the source's dimensions.

    `exif_transpose` first, so a photo taken sideways on a phone is stored the way
    it was framed. Converting to RGB flattens transparency onto black, which is
    what the dark grid shows behind it anyway, and drops every EXIF tag — the
    original still carries its metadata, which SPEC §9 wants stripped and this
    slice does not yet do.
    """
    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            frame = ImageOps.exif_transpose(image) or image
            frame = frame.convert("RGB")
            frame.thumbnail(THUMBNAIL_SIZE)

            buffer = io.BytesIO()
            frame.save(buffer, format="JPEG", quality=THUMBNAIL_QUALITY, optimize=True)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise UnreadableMediaError from exc

    return buffer.getvalue(), width, height


# --- Stripping metadata (SPEC §9) -------------------------------------------

# Re-encoded to drop what the camera wrote. GIF is deliberately not on the list:
# see `strip_image_metadata`.
_STRIPPABLE_IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})

# The boxes that remember where a clip was shot. `udta` carries the ISO 6709
# location atom (`©xyz`) alongside the capture date and the device make and
# model; `meta` carries the same facts in Apple's key/value form.
_METADATA_BOXES = frozenset({b"udta", b"meta"})


def strip_image_metadata(data: bytes, content_type: str) -> bytes:
    """The same picture, with none of the metadata the camera wrote into it.

    A phone photo carries EXIF, and EXIF carries GPS. SPEC §9 wants it gone
    before the file is stored, which is what this does; `render_thumbnail` only
    ever cleaned the derived thumbnail, and the original kept everything.

    Three details this gets right, each of which is wrong in the obvious version:

    * **Orientation is applied before it is discarded.** "Which way up is this?"
      is itself an EXIF tag, so dropping the block without acting on it first
      leaves every portrait photo lying on its side.
    * **An untransformed JPEG is re-encoded losslessly.** `quality="keep"` reuses
      the source's own quantisation tables instead of re-compressing at a guessed
      quality, so deleting a GPS tag does not cost a generation of image quality.
      It needs the tables the *opened* image is holding, which is why the
      unrotated path saves `image` rather than the transposed copy.
    * **GIF is passed through untouched.** Re-saving an animated GIF through
      Pillow returns its first frame and nothing else, and GIF has nowhere to put
      a location anyway — so the safe thing and the correct thing agree.
    """
    if content_type not in _STRIPPABLE_IMAGE_TYPES:
        return data

    try:
        with Image.open(io.BytesIO(data)) as image:
            image_format = image.format
            frame = ImageOps.exif_transpose(image) or image
            rotated = frame.size != image.size
            source = frame if rotated else image

            # `info` is where the decoder parked the EXIF block, the XMP packet
            # and any PNG text chunks. Several of Pillow's encoders read it back
            # when the caller does not pass `exif=` explicitly, so emptying it is
            # what actually guarantees nothing is carried forward — merely
            # omitting the argument is not enough, and differs between formats.
            source.info = {}

            save_kwargs: dict[str, object] = {}
            if image_format == "JPEG":
                save_kwargs["quality"] = 95 if rotated else "keep"
            elif image_format == "WEBP":
                save_kwargs["quality"] = 95

            buffer = io.BytesIO()
            source.save(buffer, format=image_format, **save_kwargs)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise UnreadableMediaError from exc

    return buffer.getvalue()


def _type_offset(data: bytes, body_start: int, box_type: bytes) -> int:
    """Where a box's four-character type sits, given where its body starts.

    An ordinary box is `[size 4][type 4][body]`, so the type is four bytes back.
    One that needed 64 bits for its size is `[1 4][type 4][largesize 8][body]`,
    which puts it twelve back. Reading the type at the near offset is what tells
    the two apart.
    """
    if data[body_start - 4 : body_start] == box_type:
        return body_start - 4
    return body_start - 12


def _blank_box(out: bytearray, data: bytes, body_start: int, box_end: int, box_type: bytes) -> None:
    """Turn one box into padding of exactly the same length."""
    type_at = _type_offset(data, body_start, box_type)
    out[type_at : type_at + 4] = b"free"
    out[body_start:box_end] = bytes(box_end - body_start)


def strip_video_metadata(data: bytes) -> bytes:
    """Blank the boxes an MP4 or QuickTime file uses to remember where it was shot.

    The obvious implementation — cut the offending boxes out and rejoin the rest
    — produces a file that will not play. In a progressive MP4 the `moov` box
    sits *before* `mdat`, so shortening it slides every byte after it, and the
    chunk offsets in the `stco`/`co64` tables are absolute file positions. They
    would all now be wrong, and nothing in the container records that they should
    have moved.

    So each box is overwritten where it lies instead: the 32-bit size is left
    exactly as it was, the type is rewritten to `free`, and the payload is zeroed.
    `free` is defined as skippable padding, every demuxer ignores it, and because
    not one byte moves, every offset in the file stays true.

    Returns `data` unchanged when there was nothing to blank, so a re-run over an
    already-stripped library copies nothing.
    """
    out: bytearray | None = None

    for box_type, body, end in _boxes(data, 0, len(data)):
        if box_type != b"moov":
            continue

        for inner_type, inner_body, inner_end in _boxes(data, body, end):
            if inner_type in _METADATA_BOXES:
                if out is None:
                    out = bytearray(data)
                _blank_box(out, data, inner_body, inner_end, inner_type)
            elif inner_type == b"trak":
                # A track can carry its own copy of both.
                for trak_type, trak_body, trak_end in _boxes(data, inner_body, inner_end):
                    if trak_type in _METADATA_BOXES:
                        if out is None:
                            out = bytearray(data)
                        _blank_box(out, data, trak_body, trak_end, trak_type)

    return bytes(out) if out is not None else data


def strip_metadata(data: bytes, content_type: str) -> bytes:
    """Remove the metadata from an upload, whatever kind it is.

    The one entry point the upload paths call. Anything unrecognised is returned
    untouched rather than refused: this runs after validation, so a type that got
    this far is one we accept, and a format we cannot clean is not a reason to
    drop a file the user is waiting on.
    """
    if content_type.startswith("video/"):
        return strip_video_metadata(data)
    if content_type.startswith("image/"):
        return strip_image_metadata(data, content_type)
    return data


# --- Processing -------------------------------------------------------------


async def _process_image(media: ReviewMedia, key: str) -> None:
    data = await storage.get_object(key)
    # Decoding a 15 MB photo is real CPU work, so it does not run on the loop.
    thumbnail, width, height = await asyncio.to_thread(render_thumbnail, data)

    thumbnail_key = f"{key.rsplit('.', 1)[0]}_thumb.jpg"
    media.thumbnail_url = await storage.put_object(thumbnail_key, thumbnail, "image/jpeg")
    media.width = width
    media.height = height


async def _process_video(media: ReviewMedia, key: str) -> None:
    """Record the clip's length; leave transcoding and a poster frame for later.

    Extracting a frame or re-encoding needs ffmpeg, which this slice deliberately
    does without so the pipeline runs offline with nothing but the dev bucket. The
    clip is already validated (format, size, duration) at upload, so what is
    missing is quality-of-life rather than correctness: `thumbnail_url` stays null
    and the clients fall back to the game's cover art in grid surfaces.
    """
    media.duration_seconds = video_duration(await storage.get_object(key))


async def process_media(db: AsyncSession, media_id: uuid.UUID) -> ReviewMedia | None:
    """Advance one media item from PENDING to READY (or FAILED).

    Idempotent and safe to call twice: anything not still PENDING is returned
    untouched, so a background task racing the catch-up worker cannot double-write
    a thumbnail or resurrect a deleted row.
    """
    media = await db.get(ReviewMedia, media_id)
    if media is None:
        return None
    if media.processing_status != ProcessingStatus.PENDING:
        return media

    key = storage.key_for_url(media.url)
    if key is None:
        # The row points at something we did not store, so there is nothing to
        # fetch and nothing to thumbnail. Marking it FAILED beats retrying forever.
        logger.error("Media %s has a URL outside our bucket: %s", media.id, media.url)
        media.processing_status = ProcessingStatus.FAILED
        await db.commit()
        return media

    media.processing_status = ProcessingStatus.PROCESSING
    await db.commit()

    try:
        if media.type is MediaType.VIDEO:
            await _process_video(media, key)
        else:
            await _process_image(media, key)
    except Exception:
        # Broad on purpose: a worker that dies on one bad file leaves every later
        # item stuck in PROCESSING. The row records the failure and the loop moves on.
        logger.exception("Failed to process media %s", media.id)
        media.processing_status = ProcessingStatus.FAILED
    else:
        media.processing_status = ProcessingStatus.READY

    await db.commit()
    await db.refresh(media)
    return media


async def process_pending(db: AsyncSession, *, limit: int = 50) -> int:
    """Process the oldest waiting items. Returns how many were attempted."""
    media_ids = (
        (
            await db.execute(
                sa.select(ReviewMedia.id)
                .where(ReviewMedia.processing_status == ProcessingStatus.PENDING)
                .order_by(ReviewMedia.created_at)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    for media_id in media_ids:
        await process_media(db, media_id)
    return len(media_ids)


async def process_in_background(media_id: uuid.UUID) -> None:
    """What the upload endpoint schedules on FastAPI's BackgroundTasks.

    Opens its own session: background tasks run after the response, by which time
    the request's session is closed. Failures are swallowed and logged — the
    client has already been told the upload succeeded, which it did, and the row
    is left for `app.cli.process_media` to retry.
    """
    try:
        async with SessionLocal() as session:
            await process_media(session, media_id)
    except Exception:
        logger.exception("Background processing failed for media %s", media_id)
