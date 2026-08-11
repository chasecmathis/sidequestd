"""The production guardrails in `app.core.config`.

Every one of these settings has a default that makes a fresh checkout work with
no configuration at all, which is exactly why they have to be checked: a deploy
that forgets one gets a working-looking API with a signing key from version
control, a refresh cookie sent in the clear, or reset emails posted into a
container that nobody reads.

The suite runs with ENVIRONMENT=test, so these build `Settings` directly rather
than touching the cached module-level instance.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings

# A deploy with nothing left at its development default. Individual tests put
# one setting back to prove that setting alone is what stops the boot.
VALID_PRODUCTION = {
    "ENVIRONMENT": "production",
    "DEBUG": "false",
    "SECRET_KEY": "kBqf3n2Xk0aVn7Q1s9dTt6wYpLzR4hJmE8cU5gN0bWx",
    "REFRESH_COOKIE_SECURE": "true",
    "REFRESH_COOKIE_SAMESITE": "none",
    "CORS_ORIGINS": "https://sidequestd.app,https://www.sidequestd.app",
    "WEB_APP_URL": "https://sidequestd.app",
    "SMTP_HOST": "smtp.example-provider.com",
    "S3_ENDPOINT_URL": "https://s3.us-east-1.amazonaws.com",
    "S3_ACCESS_KEY": "AKIAEXAMPLEACCESSKEY",
    "S3_SECRET_KEY": "an-access-secret-issued-by-the-bucket-provider",
}


def build(monkeypatch: pytest.MonkeyPatch, **overrides: str | None) -> Settings:
    """Settings built from `VALID_PRODUCTION` plus `overrides`.

    A None override removes the variable entirely, which is how a forgotten
    setting is spelled — the field falls back to its development default.
    `_env_file=None` keeps a developer's own .env out of the result.
    """
    for key, value in {**VALID_PRODUCTION, **overrides}.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)
    return Settings(_env_file=None)


def test_a_fully_configured_production_deploy_starts(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = build(monkeypatch)

    assert settings.is_production
    assert settings.refresh_cookie_secure


def test_the_defaults_alone_are_fine_for_local_development(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Local and test behaviour is unchanged: no variable is required."""
    for key in VALID_PRODUCTION:
        monkeypatch.delenv(key, raising=False)

    settings = Settings(_env_file=None)

    assert settings.environment == "local"
    assert not settings.is_production


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        pytest.param({"SECRET_KEY": None}, "SECRET_KEY", id="signing key left at the default"),
        pytest.param({"DEBUG": "true"}, "DEBUG", id="debug logging on"),
        pytest.param(
            {"REFRESH_COOKIE_SECURE": "false", "REFRESH_COOKIE_SAMESITE": "lax"},
            "REFRESH_COOKIE_SECURE",
            id="refresh cookie sent in the clear",
        ),
        pytest.param({"CORS_ORIGINS": ""}, "CORS_ORIGINS", id="no allowed origins"),
        pytest.param(
            {"CORS_ORIGINS": "https://sidequestd.app,http://localhost:3000"},
            "CORS_ORIGINS",
            id="a developer origin left in the allow list",
        ),
        pytest.param(
            {"CORS_ORIGINS": "http://sidequestd.app"}, "CORS_ORIGINS", id="plaintext origin"
        ),
        pytest.param({"WEB_APP_URL": None}, "WEB_APP_URL", id="reset links point at localhost"),
        pytest.param(
            {"WEB_APP_URL": "http://sidequestd.app"}, "WEB_APP_URL", id="plaintext reset links"
        ),
        pytest.param({"SMTP_HOST": None}, "SMTP_HOST", id="email still going to Mailpit"),
        pytest.param({"S3_ENDPOINT_URL": None}, "S3_ENDPOINT_URL", id="bucket still MinIO"),
        pytest.param({"S3_ACCESS_KEY": None}, "S3_ACCESS_KEY", id="MinIO access key"),
        pytest.param({"S3_SECRET_KEY": None}, "S3_SECRET_KEY", id="MinIO secret key"),
    ],
)
def test_production_refuses_a_development_default(
    monkeypatch: pytest.MonkeyPatch, overrides: dict[str, str | None], expected: str
) -> None:
    with pytest.raises(ValidationError) as caught:
        build(monkeypatch, **overrides)

    assert expected in str(caught.value)


def test_every_problem_is_reported_on_the_first_boot(monkeypatch: pytest.MonkeyPatch) -> None:
    """Otherwise a bad deploy costs one redeploy per missing variable."""
    with pytest.raises(ValidationError) as caught:
        build(
            monkeypatch,
            SECRET_KEY=None,
            WEB_APP_URL=None,
            SMTP_HOST=None,
            REFRESH_COOKIE_SECURE="false",
            REFRESH_COOKIE_SAMESITE="lax",
        )

    message = str(caught.value)
    for expected in ("SECRET_KEY", "WEB_APP_URL", "SMTP_HOST", "REFRESH_COOKIE_SECURE"):
        assert expected in message


@pytest.mark.parametrize(
    "raw",
    [
        "https://sidequestd.app,https://www.sidequestd.app",
        " https://sidequestd.app , https://www.sidequestd.app ",
        '["https://sidequestd.app", "https://www.sidequestd.app"]',
    ],
)
def test_cors_origins_accepts_the_documented_env_formats(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    """The comma-separated form is what .env.example documents.

    List-typed settings are JSON-decoded by pydantic-settings at the source,
    ahead of any validator, so this only works while `cors_origins` is annotated
    `NoDecode` — and it fails at import time, taking the whole app down, when it
    is not.
    """
    settings = build(monkeypatch, CORS_ORIGINS=raw)

    assert settings.cors_origins == ["https://sidequestd.app", "https://www.sidequestd.app"]


def test_samesite_none_without_secure_is_rejected_in_every_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Browsers drop such a cookie, so the refresh token would never be stored."""
    for key in VALID_PRODUCTION:
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("REFRESH_COOKIE_SAMESITE", "none")

    with pytest.raises(ValidationError, match="REFRESH_COOKIE_SECURE"):
        Settings(_env_file=None)
