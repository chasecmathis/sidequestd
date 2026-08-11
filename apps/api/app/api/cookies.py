"""The refresh-token cookie used by the web client.

Lives outside the router because the exception handler in main.py also has to
clear it: when a refresh fails, the browser is holding a cookie that will never
work again, and the error response is where that gets cleaned up.
"""

from __future__ import annotations

from starlette.responses import Response

from app.core.config import settings

# Scoping to the auth routes keeps the cookie off every other request.
REFRESH_COOKIE_PATH = f"{settings.api_v1_prefix}/auth"


def set_refresh_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=token,
        max_age=settings.refresh_token_ttl_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        domain=settings.refresh_cookie_domain,
        path=REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.refresh_cookie_name,
        httponly=True,
        secure=settings.refresh_cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        domain=settings.refresh_cookie_domain,
        path=REFRESH_COOKIE_PATH,
    )
