"""Object storage for user-uploaded files (SPEC §2: S3-compatible media store).

Deliberately small: "validate bytes against a policy, put them somewhere, hand
back a URL". Avatars (SPEC §6.2) and review photos and clips (SPEC §6.3) are the
callers; a new kind of file is a new `UploadPolicy` and nothing else. Probing,
thumbnailing and transcoding live in `app.services.media`, not here — this module
does not care what is inside the bytes beyond enough to identify them.

Two properties worth keeping when this grows:

* **The declared content type is ignored.** A browser will happily send
  `Content-Type: image/png` for a file of HTML, and the dev bucket serves what it
  is given, so the stored type is sniffed from the leading bytes instead. That is
  what stops an "avatar" from being served back as a script on the bucket origin.
* **Keys are server-generated.** The client never names a file, so a crafted
  filename cannot traverse out of its prefix or overwrite someone else's object.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import settings
from app.services.exceptions import (
    FileTooLargeError,
    StorageUnavailableError,
    UnsupportedMediaTypeError,
)

logger = logging.getLogger(__name__)

MEGABYTE = 1024 * 1024

# Magic bytes -> (content type, extension). Sniffed rather than trusted; see the
# module docstring. Enough for the image formats a browser will actually produce
# from a file picker.
_SIGNATURES: tuple[tuple[bytes, str, str], ...] = (
    (b"\xff\xd8\xff", "image/jpeg", "jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", "png"),
    (b"GIF87a", "image/gif", "gif"),
    (b"GIF89a", "image/gif", "gif"),
)

# MP4 and QuickTime are both ISO base media files: the first box is `ftyp` at
# offset 4, and the four bytes after it name the brand. Listing the brands rather
# than accepting any `ftyp` keeps audio-only containers (`M4A `) out, since those
# would otherwise pass as video and then fail to play.
_MP4_BRANDS = frozenset(
    {
        b"isom",
        b"iso2",
        b"iso4",
        b"iso5",
        b"iso6",
        b"mp41",
        b"mp42",
        b"avc1",
        b"mp4v",
        b"M4V ",
        b"MSNV",
        b"dash",
        b"3gp4",
        b"3gp5",
    }
)
_QUICKTIME_BRANDS = frozenset({b"qt  "})

_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
}


@dataclass(frozen=True, slots=True)
class UploadPolicy:
    """What a given kind of upload is allowed to be."""

    prefix: str
    max_bytes: int
    allowed_types: frozenset[str]

    @property
    def allowed_label(self) -> str:
        return ", ".join(sorted(self.allowed_types))


AVATAR_POLICY = UploadPolicy(
    prefix="avatars",
    # A profile picture is displayed at ~160px. 5 MB is generous for that and
    # small enough to read into memory without a streaming upload.
    max_bytes=5 * MEGABYTE,
    allowed_types=frozenset({"image/jpeg", "image/png", "image/webp"}),
)

# SPEC §6.3 sets both caps. GIF is allowed here but not on avatars: an animated
# clip is a reasonable thing to attach to a review and a silly thing to wear as a
# profile picture.
REVIEW_IMAGE_POLICY = UploadPolicy(
    prefix="reviews",
    max_bytes=15 * MEGABYTE,
    allowed_types=frozenset({"image/jpeg", "image/png", "image/webp", "image/gif"}),
)

REVIEW_VIDEO_POLICY = UploadPolicy(
    prefix="reviews",
    max_bytes=100 * MEGABYTE,
    # MP4 and QuickTime only. WebM would need an EBML parser to read a clip's
    # duration, and without the duration the 60-second cap in SPEC §6.3 cannot be
    # enforced at upload time — so it is left out rather than let through unchecked.
    allowed_types=frozenset({"video/mp4", "video/quicktime"}),
)


def detect_content_type(data: bytes) -> str | None:
    """The real type of `data`, or None if it is not a format we accept."""
    for signature, content_type, _ in _SIGNATURES:
        if data.startswith(signature):
            return content_type
    # WebP is a RIFF container: "RIFF" ....size.... "WEBP".
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp":
        brand = data[8:12]
        if brand in _QUICKTIME_BRANDS:
            return "video/quicktime"
        if brand in _MP4_BRANDS:
            return "video/mp4"
    return None


def validate_upload(data: bytes, policy: UploadPolicy) -> str:
    """Check `data` against `policy` and return its sniffed content type."""
    if len(data) > policy.max_bytes:
        raise FileTooLargeError(policy.max_bytes)
    if not data:
        raise UnsupportedMediaTypeError(policy.allowed_label)

    content_type = detect_content_type(data)
    if content_type is None or content_type not in policy.allowed_types:
        raise UnsupportedMediaTypeError(policy.allowed_label)
    return content_type


def match_policy(data: bytes, policies: Sequence[UploadPolicy]) -> tuple[UploadPolicy, str]:
    """The first policy that accepts `data`, plus its sniffed content type.

    For endpoints that take more than one kind of file — a review attachment is
    either a photo or a clip, with a different size cap each (SPEC §6.3). The
    type decides the policy, so the caps cannot be swapped by mislabelling the
    upload.
    """
    content_type = detect_content_type(data)
    for policy in policies:
        if content_type is not None and content_type in policy.allowed_types:
            return policy, validate_upload(data, policy)

    allowed = sorted({allowed for policy in policies for allowed in policy.allowed_types})
    raise UnsupportedMediaTypeError(", ".join(allowed))


def build_key(policy: UploadPolicy, owner_id: uuid.UUID, content_type: str) -> str:
    """A fresh, server-chosen key.

    Random rather than derived from the owner alone, so replacing a file changes
    the URL and no CDN or browser can serve the previous one from cache.
    """
    return f"{policy.prefix}/{owner_id}/{uuid.uuid4().hex}.{_EXTENSIONS[content_type]}"


# --- The bucket ------------------------------------------------------------


def _public_base() -> str:
    """Where objects are readable from.

    In dev this is MinIO itself, whose bucket `infra/docker-compose.yml` sets to
    anonymous-download. In production point S3_PUBLIC_URL_BASE at the CDN in
    front of the bucket instead of handing out the origin.
    """
    base = settings.s3_public_url_base or f"{settings.s3_endpoint_url}/{settings.s3_bucket}"
    return base.rstrip("/")


def public_url(key: str) -> str:
    return f"{_public_base()}/{key}"


def key_for_url(url: str | None) -> str | None:
    """The storage key behind one of our URLs, or None if we did not store it.

    Returning None for anything else is what keeps a delete from acting on a URL
    the app does not own — an avatar seeded from an external source, say.
    """
    if not url:
        return None
    prefix = f"{_public_base()}/"
    return url[len(prefix) :] if url.startswith(prefix) else None


@lru_cache
def _client() -> Any:
    """boto3 clients are thread-safe and expensive to build, so cache one."""
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
    )


async def put_object(key: str, data: bytes, content_type: str) -> str:
    """Store `data` and return its public URL.

    boto3 is synchronous, so the call is handed to a worker thread rather than
    blocking the event loop for the duration of the upload.
    """
    try:
        await asyncio.to_thread(
            _client().put_object,
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    except (BotoCoreError, ClientError) as exc:
        logger.exception("Failed to store object %s", key)
        raise StorageUnavailableError from exc
    return public_url(key)


async def get_object(key: str) -> bytes:
    """Read an object back.

    The media worker needs the original bytes to thumbnail them, and it may be
    running long after the request that stored them (see `app.cli.process_media`),
    so it fetches rather than being handed them.
    """
    try:
        response = await asyncio.to_thread(_client().get_object, Bucket=settings.s3_bucket, Key=key)
        body: bytes = await asyncio.to_thread(response["Body"].read)
    except (BotoCoreError, ClientError) as exc:
        logger.exception("Failed to read object %s", key)
        raise StorageUnavailableError from exc
    return body


async def delete_object(key: str) -> None:
    try:
        await asyncio.to_thread(_client().delete_object, Bucket=settings.s3_bucket, Key=key)
    except (BotoCoreError, ClientError) as exc:
        logger.exception("Failed to delete object %s", key)
        raise StorageUnavailableError from exc


async def discard(url: str | None) -> None:
    """Best-effort cleanup of a replaced file.

    Called *after* the database has been updated, so the row already points at
    the new object. A failure here leaves an orphan in the bucket, which is worth
    a log line and nothing more — failing the request would undo a change the
    user has already been told succeeded.
    """
    key = key_for_url(url)
    if key is None:
        return
    try:
        await delete_object(key)
    except StorageUnavailableError:
        logger.warning("Orphaned object left in the bucket: %s", key)
