"""Editing your own profile and its avatar — SPEC §6.2."""

from __future__ import annotations

import io
from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient
from PIL import Image

from app.models.user import User
from app.services import storage
from tests.conftest import GIF_1PX, PNG_1PX, FakeObjectStore

ME = "/api/v1/users/me"
AVATAR = "/api/v1/users/me/avatar"

MakeUser = Callable[..., Awaitable[User]]
AuthHeaders = Callable[[User], dict[str, str]]


@pytest.fixture
def headers(registered_user: dict[str, object]) -> dict[str, str]:
    return {"Authorization": f"Bearer {registered_user['access_token']}"}


# --- PATCH /users/me -------------------------------------------------------


async def test_editing_the_profile_fields(client: AsyncClient, headers: dict[str, str]) -> None:
    response = await client.patch(
        ME,
        headers=headers,
        json={"display_name": "Ripley", "bio": "Last survivor.", "is_private": True},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["display_name"] == "Ripley"
    assert body["bio"] == "Last survivor."
    assert body["is_private"] is True


async def test_an_omitted_field_is_left_alone(client: AsyncClient, headers: dict[str, str]) -> None:
    """PATCH, not PUT — sending only a bio must not wipe the display name."""
    await client.patch(ME, headers=headers, json={"display_name": "Ripley"})

    body = (await client.patch(ME, headers=headers, json={"bio": "Nostromo."})).json()

    assert body["display_name"] == "Ripley"
    assert body["bio"] == "Nostromo."


async def test_an_explicit_null_clears_the_field(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    """The counterpart to the test above: there has to be a way to erase a bio."""
    await client.patch(ME, headers=headers, json={"bio": "Nostromo."})

    body = (await client.patch(ME, headers=headers, json={"bio": None})).json()

    assert body["bio"] is None


async def test_an_empty_patch_is_a_no_op(client: AsyncClient, headers: dict[str, str]) -> None:
    before = (await client.get(ME, headers=headers)).json()

    after = (await client.patch(ME, headers=headers, json={})).json()

    assert after == before


async def test_the_edit_persists(client: AsyncClient, headers: dict[str, str]) -> None:
    await client.patch(ME, headers=headers, json={"bio": "Nostromo."})

    assert (await client.get(ME, headers=headers)).json()["bio"] == "Nostromo."


async def test_an_over_long_bio_is_rejected(client: AsyncClient, headers: dict[str, str]) -> None:
    response = await client.patch(ME, headers=headers, json={"bio": "x" * 301})

    assert response.status_code == 422


async def test_an_empty_display_name_is_rejected(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    """Blank is not the same as cleared — null is how you clear it."""
    assert (await client.patch(ME, headers=headers, json={"display_name": ""})).status_code == 422


async def test_identity_fields_cannot_be_edited_here(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    """`extra="forbid"` — a typo'd or hostile key is rejected, not ignored."""
    rejected = ({"username": "someone_else"}, {"email": "new@example.com"}, {"is_active": True})
    for payload in rejected:
        response = await client.patch(ME, headers=headers, json=payload)
        assert response.status_code == 422, payload


async def test_editing_requires_authentication(client: AsyncClient) -> None:
    assert (await client.patch(ME, json={"bio": "hi"})).status_code == 401


async def test_going_private_is_reflected_on_the_public_profile(
    client: AsyncClient, headers: dict[str, str]
) -> None:
    await client.patch(ME, headers=headers, json={"is_private": True})

    body = (await client.get("/api/v1/users/ripley")).json()

    assert body["is_private"] is True
    assert body["can_view_content"] is False


# --- Avatar upload ---------------------------------------------------------


async def test_uploading_an_avatar_stores_it_and_sets_the_url(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    response = await client.put(
        AVATAR, headers=headers, files={"file": ("me.png", PNG_1PX, "image/png")}
    )

    assert response.status_code == 200, response.text
    url = response.json()["avatar_url"]
    assert url is not None
    assert len(object_store.keys) == 1
    assert url.endswith(object_store.keys[0])


async def test_an_avatars_camera_metadata_is_stripped_before_it_is_stored(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    """SPEC §9, on the path most likely to carry a home address.

    A profile picture is very often a photo straight off a phone, so this path
    needs stripping as much as review media does — and it is the easier one to
    forget, since it does not go through the media pipeline at all.
    """
    exif = Image.Exif()
    exif[0x8825] = {1: "N", 2: (51.0, 30.0, 0.0), 3: "W", 4: (0.0, 7.0, 0.0)}  # GPSInfo
    buffer = io.BytesIO()
    Image.new("RGB", (24, 24), "navy").save(buffer, format="JPEG", exif=exif)

    response = await client.put(
        AVATAR, headers=headers, files={"file": ("me.jpg", buffer.getvalue(), "image/jpeg")}
    )

    assert response.status_code == 200, response.text
    stored, _ = object_store.objects[object_store.keys[0]]
    with Image.open(io.BytesIO(stored)) as image:
        assert dict(image.getexif()) == {}


async def test_the_stored_key_is_server_generated_not_the_filename(
    client: AsyncClient,
    headers: dict[str, str],
    object_store: FakeObjectStore,
    registered_user: dict[str, object],
) -> None:
    """A crafted filename must not escape the prefix or name someone else's object."""
    await client.put(
        AVATAR,
        headers=headers,
        files={"file": ("../../etc/passwd", PNG_1PX, "image/png")},
    )

    key = object_store.keys[0]
    user_id = registered_user["user"]["id"]  # type: ignore[index]
    assert key.startswith(f"avatars/{user_id}/")
    assert ".." not in key
    assert key.endswith(".png")


async def test_the_stored_content_type_is_sniffed_not_taken_from_the_client(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    """A browser will send whatever it likes; the bucket serves what we store."""
    response = await client.put(
        AVATAR, headers=headers, files={"file": ("me.png", GIF_1PX, "image/png")}
    )

    # The bytes are a GIF, so image/png is a lie — and GIF is not in the avatar
    # policy, so the whole upload is refused rather than stored as a "PNG".
    assert response.status_code == 415
    assert object_store.objects == {}


async def test_a_file_that_is_not_an_image_is_refused(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    """Storing HTML under an image content type is a stored-XSS on the bucket origin."""
    payload = b"<html><script>alert(1)</script></html>"

    response = await client.put(
        AVATAR, headers=headers, files={"file": ("me.png", payload, "image/png")}
    )

    assert response.status_code == 415
    assert object_store.objects == {}


async def test_an_empty_file_is_refused(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    response = await client.put(
        AVATAR, headers=headers, files={"file": ("me.png", b"", "image/png")}
    )

    assert response.status_code == 415


async def test_an_oversized_file_is_refused(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    too_big = PNG_1PX + b"\x00" * storage.AVATAR_POLICY.max_bytes

    response = await client.put(
        AVATAR, headers=headers, files={"file": ("me.png", too_big, "image/png")}
    )

    assert response.status_code == 413
    assert object_store.objects == {}


async def test_replacing_an_avatar_deletes_the_previous_object(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    """Otherwise every edit leaks a file into the bucket forever."""
    first = (
        await client.put(AVATAR, headers=headers, files={"file": ("a.png", PNG_1PX, "image/png")})
    ).json()["avatar_url"]

    second = (
        await client.put(AVATAR, headers=headers, files={"file": ("b.png", PNG_1PX, "image/png")})
    ).json()["avatar_url"]

    assert first != second, "a replacement must change the URL so caches cannot serve the old image"
    assert object_store.deleted == [storage.key_for_url(first)]
    assert len(object_store.objects) == 1


async def test_removing_an_avatar_clears_the_url_and_the_object(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    url = (
        await client.put(AVATAR, headers=headers, files={"file": ("a.png", PNG_1PX, "image/png")})
    ).json()["avatar_url"]

    response = await client.delete(AVATAR, headers=headers)

    assert response.status_code == 200
    assert response.json()["avatar_url"] is None
    assert object_store.deleted == [storage.key_for_url(url)]


async def test_removing_an_avatar_that_was_never_set_is_a_no_op(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    response = await client.delete(AVATAR, headers=headers)

    assert response.status_code == 200
    assert object_store.deleted == []


async def test_uploading_requires_authentication(client: AsyncClient) -> None:
    response = await client.put(AVATAR, files={"file": ("me.png", PNG_1PX, "image/png")})

    assert response.status_code == 401


async def test_the_avatar_shows_up_on_the_public_profile(
    client: AsyncClient, headers: dict[str, str], object_store: FakeObjectStore
) -> None:
    await client.put(AVATAR, headers=headers, files={"file": ("me.png", PNG_1PX, "image/png")})

    assert (await client.get("/api/v1/users/ripley")).json()["avatar_url"] is not None


# --- The storage helper itself ---------------------------------------------


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (PNG_1PX, "image/png"),
        (GIF_1PX, "image/gif"),
        (b"\xff\xd8\xff\xe0" + b"\x00" * 16, "image/jpeg"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "image/webp"),
        (b"not an image at all", None),
        (b"", None),
    ],
)
def test_content_type_is_sniffed_from_the_leading_bytes(data: bytes, expected: str | None) -> None:
    assert storage.detect_content_type(data) == expected


def test_a_foreign_url_yields_no_key_to_delete() -> None:
    """`discard` must never act on a URL this app did not store."""
    assert storage.key_for_url("https://example.com/somebody-elses.png") is None
    assert storage.key_for_url(None) is None
    assert storage.key_for_url(storage.public_url("avatars/x/y.png")) == "avatars/x/y.png"
