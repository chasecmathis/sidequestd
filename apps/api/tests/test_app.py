"""App-level behaviour: health, CORS, rate limiting, schema shape."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.core.rate_limit import limiter
from app.main import create_app


async def test_health(client: AsyncClient) -> None:
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


async def test_cors_allows_the_web_client_with_credentials(client: AsyncClient) -> None:
    """The httpOnly refresh cookie only reaches the API if credentials are allowed."""
    response = await client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
    assert response.headers["access-control-allow-credentials"] == "true"


async def test_cors_rejects_an_unknown_origin(client: AsyncClient) -> None:
    response = await client.options(
        "/api/v1/auth/login",
        headers={
            "Origin": "http://evil.example.com",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert "access-control-allow-origin" not in response.headers


def test_openapi_never_exposes_the_password_hash() -> None:
    schemas = create_app().openapi()["components"]["schemas"]

    for name, schema in schemas.items():
        assert "hashed_password" not in schema.get("properties", {}), name


async def test_interactive_docs_are_served_outside_production(client: AsyncClient) -> None:
    assert (await client.get("/docs")).status_code == 200
    assert (await client.get(f"{settings.api_v1_prefix}/openapi.json")).status_code == 200


def test_interactive_docs_are_off_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    """They advertise every endpoint and post to it from the caller's session."""
    monkeypatch.setattr(settings, "environment", "production")
    app = create_app()

    assert app.docs_url is None
    assert app.redoc_url is None
    assert app.openapi_url is None
    # The schema itself is still built in-process, which is what gen:types uses.
    assert app.openapi()["paths"]


@pytest.fixture
def rate_limiting_enabled() -> Iterator[None]:
    """Limits are off for the rest of the suite so tests can register freely."""
    limiter.enabled = True
    limiter.reset()
    yield
    limiter.enabled = False
    limiter.reset()


@pytest.mark.usefixtures("rate_limiting_enabled")
@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("POST", "/api/v1/auth/register", {}),
        ("POST", "/api/v1/auth/login", {"identifier": "nobody", "password": "not-the-password"}),
        ("POST", "/api/v1/auth/refresh", {}),
        ("POST", "/api/v1/auth/password-reset", {"email": "nobody@example.com"}),
        ("POST", "/api/v1/auth/password-reset/confirm", {"token": "x" * 20, "new_password": "x"}),
        ("GET", "/api/v1/search/games?q=a", None),
        ("GET", "/api/v1/search/users?q=a", None),
    ],
)
async def test_rate_limited_endpoints_do_not_500_when_limits_are_on(
    client: AsyncClient, method: str, path: str, payload: dict[str, object] | None
) -> None:
    """slowapi writes its headers onto a `response: Response` parameter and raises
    if a limited endpoint declares none.

    That only surfaces with limits enabled, and the rest of the suite runs with
    them off — so a limited endpoint missing the parameter would otherwise ship
    green and 500 on the first real request.
    """
    response = await client.get(path) if method == "GET" else await client.post(path, json=payload)

    assert response.status_code != 500, response.text


@pytest.mark.usefixtures("rate_limiting_enabled")
async def test_a_successful_limited_request_reports_the_remaining_quota(
    client: AsyncClient,
) -> None:
    response = await client.get("/api/v1/search/games?q=a")

    assert response.status_code == 200
    assert "x-ratelimit-limit" in response.headers


@pytest.mark.usefixtures("rate_limiting_enabled")
async def test_login_is_rate_limited(client: AsyncClient) -> None:
    limit = int(settings.rate_limit_auth.split("/")[0])
    payload = {"identifier": "ripley", "password": "wrong-password-entirely"}

    statuses = [
        (await client.post("/api/v1/auth/login", json=payload)).status_code
        for _ in range(limit + 1)
    ]

    assert statuses[-1] == 429
    assert statuses[:limit] == [401] * limit
