"""Rate limiting for auth endpoints (SPEC §9).

Backed by slowapi's in-memory store, which is per-process and therefore only
correct for single-instance local development. Point `storage_uri` at Redis
before running more than one API replica.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request

from app.core.config import settings


def _client_key(request: Request) -> str:
    return get_remote_address(request) or "anonymous"


limiter = Limiter(
    key_func=_client_key,
    enabled=settings.rate_limit_enabled,
    headers_enabled=True,
)
