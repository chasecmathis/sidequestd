"""Attaching photos and clips to a review — SPEC §6.3 limits."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from app.models.game import Game
from app.models.review import MAX_MEDIA_PER_REVIEW
from app.models.user import User
from app.services import storage
from app.services.media import MAX_VIDEO_SECONDS
from tests.conftest import GIF_1PX, PNG_1PX, FakeObjectStore, make_mp4

REVIEWS = "/api/v1/reviews"

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]

MP4_5S = make_mp4(5.0)
MOV_5S = make_mp4(5.0, brand=b"qt  ")


@pytest.fixture
def headers(registered_user: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {registered_user['access_token']}"}


@pytest.fixture
async def review(
    client: AsyncClient, headers: dict[str, str], catalog: list[Game]
) -> dict[str, object]:
    response = await client.post(
        REVIEWS, headers=headers, json={"game_id": str(catalog[0].id), "rating": 8}
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


async def upload(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    payload: bytes = PNG_1PX,
    *,
    filename: str = "shot.png",
    content_type: str = "image/png",
    alt_text: str | None = None,
) -> tuple[int, dict[str, object]]:
    response = await client.post(
        f"{REVIEWS}/{review['id']}/media",
        headers=headers,
        files={"file": (filename, payload, content_type)},
        data={"alt_text": alt_text} if alt_text is not None else None,
    )
    body = response.json() if response.content else {}
    return response.status_code, dict(body) if isinstance(body, dict) else {}


# --- Uploading --------------------------------------------------------------


async def test_attaching_a_photo(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    status, item = await upload(client, headers, review)

    assert status == 201
    assert item["type"] == "IMAGE"
    assert item["position"] == 0
    assert len(object_store.keys) == 1


async def test_a_new_item_starts_pending(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # SPEC §6.3 processes asynchronously, so the upload response cannot claim the
    # thumbnail exists yet.
    _, item = await upload(client, headers, review)

    assert item["processing_status"] == "PENDING"
    assert item["thumbnail_url"] is None


async def test_the_upload_is_queued_for_processing(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
    media_queue: list[uuid.UUID],
) -> None:
    _, item = await upload(client, headers, review)

    assert media_queue == [uuid.UUID(str(item["id"]))]


async def test_items_are_appended_in_upload_order(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    await upload(client, headers, review)
    await upload(client, headers, review)
    _, third = await upload(client, headers, review)

    assert third["position"] == 2


async def test_alt_text_is_kept(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # SPEC §9 wants alt text on media for screen readers.
    _, item = await upload(client, headers, review, alt_text="The final boss arena.")

    assert item["alt_text"] == "The final boss arena."


async def test_the_carousel_is_returned_in_order(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    await upload(client, headers, review)
    await upload(client, headers, review)

    body = (await client.get(f"{REVIEWS}/{review['id']}")).json()

    assert [item["position"] for item in body["media"]] == [0, 1]
    assert body["media_count"] == 2


async def test_the_client_never_names_the_stored_file(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # A crafted filename must not be able to climb out of the review's prefix.
    await upload(client, headers, review, filename="../../../etc/passwd")

    key = object_store.keys[0]
    assert key.startswith(f"reviews/{review['id']}/")
    assert "passwd" not in key
    assert ".." not in key


async def test_the_declared_content_type_is_ignored(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # A GIF announced as a PNG is stored as what it actually is, so the bucket
    # never serves a file under a type it does not match.
    await upload(client, headers, review, GIF_1PX, filename="clip.png", content_type="image/png")

    _, stored_type = next(iter(object_store.objects.values()))
    assert stored_type == "image/gif"


async def test_html_wearing_a_png_content_type_is_refused(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # The stored-XSS case: the bucket serves what it is given, so a script must
    # never get in by lying about its type.
    status, _ = await upload(
        client, headers, review, b"<html><script>alert(1)</script></html>", content_type="image/png"
    )

    assert status == 415
    assert object_store.objects == {}


async def test_an_empty_file_is_refused(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    status, _ = await upload(client, headers, review, b"")

    assert status == 415


async def test_a_gif_is_allowed_on_a_review(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # Unlike an avatar, where the same file is refused.
    status, item = await upload(client, headers, review, GIF_1PX, filename="clip.gif")

    assert status == 201
    assert item["type"] == "IMAGE"


async def test_an_oversized_photo_is_refused(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # SPEC §6.3: images ≤ 15 MB. Padding a real PNG keeps the check on the size
    # rather than on the sniffing.
    oversized = PNG_1PX + bytes(storage.REVIEW_IMAGE_POLICY.max_bytes)

    status, _ = await upload(client, headers, review, oversized)

    assert status == 413
    assert object_store.objects == {}


# --- Video (SPEC §6.3) ------------------------------------------------------


async def test_attaching_a_clip(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    status, item = await upload(client, headers, review, MP4_5S, filename="clip.mp4")

    assert status == 201
    assert item["type"] == "VIDEO"
    assert object_store.keys[0].endswith(".mp4")


async def test_a_quicktime_clip_is_recognised(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # What an iPhone hands over from the photo picker.
    status, item = await upload(client, headers, review, MOV_5S, filename="clip.mov")

    assert status == 201
    assert item["type"] == "VIDEO"
    assert object_store.keys[0].endswith(".mov")


async def test_a_clip_over_the_limit_is_refused(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    status, body = await upload(
        client, headers, review, make_mp4(MAX_VIDEO_SECONDS + 1), filename="long.mp4"
    )

    assert status == 400
    assert str(MAX_VIDEO_SECONDS) in str(body["detail"])
    assert object_store.objects == {}


async def test_a_clip_at_exactly_the_limit_is_allowed(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    status, _ = await upload(
        client, headers, review, make_mp4(MAX_VIDEO_SECONDS), filename="exact.mp4"
    )

    assert status == 201


async def test_a_clip_whose_length_cannot_be_read_is_refused(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # An MP4 header with no movie box: without a duration the 60-second cap cannot
    # be enforced, so letting it through would make the limit meaningless.
    headerless = b"\x00\x00\x00\x14ftypisom\x00\x00\x02\x00isom"

    status, _ = await upload(client, headers, review, headerless, filename="broken.mp4")

    assert status == 400
    assert object_store.objects == {}


async def test_only_one_clip_per_review(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # SPEC §6.3 caps MVP at one video; multiple videos is named as a fast-follow.
    await upload(client, headers, review, MP4_5S, filename="one.mp4")

    status, _ = await upload(client, headers, review, MP4_5S, filename="two.mp4")

    assert status == 409
    assert len(object_store.keys) == 1


async def test_a_clip_alongside_photos_is_fine(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    await upload(client, headers, review)
    status, _ = await upload(client, headers, review, MP4_5S, filename="clip.mp4")
    assert status == 201

    status, _ = await upload(client, headers, review)
    assert status == 201


async def test_a_clip_may_replace_a_removed_one(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    _, first = await upload(client, headers, review, MP4_5S, filename="one.mp4")
    await client.delete(f"{REVIEWS}/{review['id']}/media/{first['id']}", headers=headers)

    status, _ = await upload(client, headers, review, MP4_5S, filename="two.mp4")

    assert status == 201


# --- The ten-item cap -------------------------------------------------------


async def test_a_review_holds_at_most_ten_items(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    for _ in range(MAX_MEDIA_PER_REVIEW):
        status, _ = await upload(client, headers, review)
        assert status == 201

    status, _ = await upload(client, headers, review)

    assert status == 409
    assert len(object_store.keys) == MAX_MEDIA_PER_REVIEW


# --- Ownership --------------------------------------------------------------


async def test_you_cannot_attach_to_someone_elses_review(
    client: AsyncClient,
    review: dict[str, object],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    object_store: FakeObjectStore,
) -> None:
    intruder = await make_user("dietrich")

    status, _ = await upload(client, auth_headers(intruder), review)

    assert status == 403
    assert object_store.objects == {}


async def test_attaching_requires_signing_in(
    client: AsyncClient, review: dict[str, object], object_store: FakeObjectStore
) -> None:
    response = await client.post(
        f"{REVIEWS}/{review['id']}/media", files={"file": ("shot.png", PNG_1PX, "image/png")}
    )

    assert response.status_code == 401


async def test_attaching_to_an_unknown_review_is_a_404(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    response = await client.post(
        f"{REVIEWS}/{uuid.uuid4()}/media",
        headers=headers,
        files={"file": ("shot.png", PNG_1PX, "image/png")},
    )

    assert response.status_code == 404


# --- Removing ---------------------------------------------------------------


async def test_removing_an_item(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    _, item = await upload(client, headers, review)

    response = await client.delete(f"{REVIEWS}/{review['id']}/media/{item['id']}", headers=headers)

    assert response.status_code == 200
    assert response.json() == []
    assert object_store.objects == {}


async def test_removing_closes_the_gap_it_leaves(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    # Positions stay dense so the next upload can append at the item count without
    # colliding with `uq_review_media_review_id_position`.
    _, first = await upload(client, headers, review)
    _, second = await upload(client, headers, review)
    _, third = await upload(client, headers, review)

    remaining = (
        await client.delete(f"{REVIEWS}/{review['id']}/media/{first['id']}", headers=headers)
    ).json()

    assert [item["position"] for item in remaining] == [0, 1]
    assert [item["id"] for item in remaining] == [second["id"], third["id"]]


async def test_uploading_after_a_gap_close_still_appends(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    object_store: FakeObjectStore,
) -> None:
    _, first = await upload(client, headers, review)
    await upload(client, headers, review)
    await client.delete(f"{REVIEWS}/{review['id']}/media/{first['id']}", headers=headers)

    _, added = await upload(client, headers, review)

    assert added["position"] == 1


async def test_removing_something_that_is_not_there_is_a_404(
    client: AsyncClient, headers: dict[str, str], review: dict[str, object]
) -> None:
    response = await client.delete(
        f"{REVIEWS}/{review['id']}/media/{uuid.uuid4()}", headers=headers
    )

    assert response.status_code == 404


async def test_you_cannot_remove_an_item_from_someone_elses_review(
    client: AsyncClient,
    headers: dict[str, str],
    review: dict[str, object],
    make_user: MakeUser,
    auth_headers: AuthHeaders,
    object_store: FakeObjectStore,
) -> None:
    _, item = await upload(client, headers, review)
    intruder = await make_user("apone")

    response = await client.delete(
        f"{REVIEWS}/{review['id']}/media/{item['id']}", headers=auth_headers(intruder)
    )

    assert response.status_code == 403
    assert object_store.objects
