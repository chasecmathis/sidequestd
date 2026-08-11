"""Application settings, loaded from the environment (see .env.example)."""

import json
from collections.abc import Iterator
from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

# Hostnames that only ever mean "the machine this is running on". A staging or
# production deploy still pointing at one of them is a misconfiguration rather
# than a deliberate choice, so `model_post_init` refuses to boot on them.
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "0.0.0.0", "::1"})  # noqa: S104


def _is_local_host(value: str) -> bool:
    """True for a URL or bare hostname that resolves to this machine."""
    return (urlparse(value).hostname or value).lower() in _LOCAL_HOSTS


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- General -----------------------------------------------------------
    environment: Literal["local", "test", "staging", "production"] = "local"
    debug: bool = True
    project_name: str = "Sidequestd API"
    api_v1_prefix: str = "/api/v1"

    # --- Database ----------------------------------------------------------
    database_url: PostgresDsn = Field(
        default=PostgresDsn("postgresql+asyncpg://sidequestd:sidequestd@localhost:5432/sidequestd")
    )
    db_echo: bool = False

    # --- Security ----------------------------------------------------------
    # Must be overridden outside local/test. Enforced in model_post_init below.
    secret_key: str = "dev-only-insecure-secret-change-me"  # noqa: S105 - placeholder, rejected in prod
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 30
    password_reset_ttl_minutes: int = 60
    min_password_length: int = 10

    # --- Cookies (web client refresh token) --------------------------------
    refresh_cookie_name: str = "sq_refresh"
    refresh_cookie_secure: bool = False
    refresh_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    refresh_cookie_domain: str | None = None

    # --- CORS --------------------------------------------------------------
    # `NoDecode` hands the raw environment string to `_split_origins` below.
    # Without it pydantic-settings JSON-decodes every list-typed field straight
    # out of the source, and the comma-separated form that .env.example
    # documents raises before any validator can see it.
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # --- Clients -----------------------------------------------------------
    web_app_url: str = "http://localhost:3000"

    # --- Email (Mailpit in local dev) --------------------------------------
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_user: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool = False
    email_from: str = "no-reply@sidequestd.app"
    email_from_name: str = "Sidequestd"

    # --- Object storage (avatars now, review media from the reviews slice) ---
    s3_endpoint_url: str = "http://localhost:9000"
    s3_bucket: str = "sidequestd-media"
    s3_access_key: str = "sidequestd"
    s3_secret_key: str = "sidequestd-secret"  # noqa: S105 - local MinIO container
    s3_region: str = "us-east-1"
    # Where stored objects are *read* from. Defaults to the bucket itself, which
    # is what the local MinIO container serves; set this to the CDN in front of
    # the bucket in production so the origin is never handed to clients.
    s3_public_url_base: str | None = None

    # --- Games catalog source (SPEC §2) ------------------------------------
    # Absent by default: the import CLI falls back to the bundled seed fixture so
    # the catalog is usable with no third-party account.
    igdb_client_id: str | None = None
    igdb_client_secret: str | None = None
    igdb_api_url: str = "https://api.igdb.com/v4"
    igdb_token_url: str = "https://id.twitch.tv/oauth2/token"  # noqa: S105 - an endpoint, not a secret

    # --- Rate limits (SPEC §9: auth and search endpoints are rate limited) --
    rate_limit_enabled: bool = True
    rate_limit_auth: str = "10/minute"
    rate_limit_password_reset: str = "5/hour"  # noqa: S105 - a rate, not a secret
    rate_limit_search: str = "60/minute"

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        """Allow CORS_ORIGINS to be a comma-separated string or a JSON array."""
        if isinstance(value, str):
            text = value.strip()
            if text.startswith("["):
                return json.loads(text)
            return [origin.strip() for origin in text.split(",") if origin.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.environment in ("staging", "production")

    def model_post_init(self, __context: object) -> None:
        """Refuse to start on a configuration that cannot work or is not safe.

        Every problem is collected before raising, so a misconfigured deploy
        reports all of them on its first boot instead of costing one redeploy
        per mistake.
        """
        problems = list(self._impossible_anywhere())
        if self.is_production:
            problems.extend(self._unsafe_in_production())
        if problems:
            listed = "\n  - ".join(problems)
            raise ValueError(
                f"Refusing to start with ENVIRONMENT={self.environment}:\n  - {listed}"
            )

    def _impossible_anywhere(self) -> Iterator[str]:
        if self.refresh_cookie_samesite == "none" and not self.refresh_cookie_secure:
            # Browsers drop a SameSite=None cookie that is not also Secure, so
            # the refresh token would silently never be stored.
            yield "REFRESH_COOKIE_SAMESITE=none requires REFRESH_COOKIE_SECURE=true"

    def _unsafe_in_production(self) -> Iterator[str]:
        """Settings whose shipped default is a local-development convenience."""
        if self._keeps_default("secret_key"):
            yield "SECRET_KEY must be set to a unique value outside local development"
        if self.debug:
            yield "DEBUG must be false: debug logs record request detail that should not be kept"
        if not self.refresh_cookie_secure:
            yield "REFRESH_COOKIE_SECURE must be true so the refresh cookie is only sent over HTTPS"

        if not self.cors_origins:
            yield "CORS_ORIGINS must list the real web origins; empty blocks every browser client"
        for origin in self.cors_origins:
            if not origin.startswith("https://") or _is_local_host(origin):
                yield f"CORS_ORIGINS must hold public HTTPS origins only; got {origin!r}"

        if not self.web_app_url.startswith("https://") or _is_local_host(self.web_app_url):
            # It is the base of every password-reset link that gets emailed out.
            yield f"WEB_APP_URL must be the public HTTPS address of the web client; got {self.web_app_url!r}"  # noqa: E501

        if _is_local_host(self.smtp_host):
            yield "SMTP_HOST still points at the local Mailpit container, so no email would arrive"

        if _is_local_host(self.s3_endpoint_url):
            yield "S3_ENDPOINT_URL still points at the local MinIO container"
        if self._keeps_default("s3_access_key") or self._keeps_default("s3_secret_key"):
            yield "S3_ACCESS_KEY and S3_SECRET_KEY must be real credentials, not the MinIO defaults"

    def _keeps_default(self, field: str) -> bool:
        return bool(getattr(self, field) == Settings.model_fields[field].default)

    @property
    def sync_database_url(self) -> str:
        """psycopg URL — Alembic and test-database bootstrapping run synchronously."""
        return str(self.database_url).replace("+asyncpg", "+psycopg")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
