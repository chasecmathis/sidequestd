"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import InvalidTokenError, decode_access_token
from app.db.session import get_db
from app.models.user import User
from app.services.auth import ClientInfo

DbSession = Annotated[AsyncSession, Depends(get_db)]

_bearer_scheme = HTTPBearer(auto_error=False, description="Access token from /auth/login")
BearerCredentials = Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer_scheme)]

_UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated.",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(db: DbSession, credentials: BearerCredentials) -> User:
    if credentials is None or not credentials.credentials:
        raise _UNAUTHENTICATED

    try:
        user_id = decode_access_token(credentials.credentials)
    except InvalidTokenError as exc:
        raise _UNAUTHENTICATED from exc

    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise _UNAUTHENTICATED
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_optional_current_user(db: DbSession, credentials: BearerCredentials) -> User | None:
    """Resolve the caller if they presented a token, without requiring one.

    Endpoints that are readable signed-out but return *more* to a signed-in
    viewer use this — user search, for instance, where the viewer's follow edges
    decide what a private account exposes (SPEC §6.7). A malformed or expired
    token is treated as anonymous rather than as an error, so a stale token can
    never turn a public page into a 401.
    """
    if credentials is None or not credentials.credentials:
        return None
    try:
        return await get_current_user(db, credentials)
    except HTTPException:
        return None


OptionalUser = Annotated[User | None, Depends(get_optional_current_user)]


def get_client_info(request: Request) -> ClientInfo:
    """Provenance recorded against issued refresh tokens.

    `request.client.host` is the socket peer; behind a proxy the app must be run
    with uvicorn's --proxy-headers so this reflects X-Forwarded-For.
    """
    return ClientInfo(
        user_agent=request.headers.get("user-agent"),
        ip_address=request.client.host if request.client else None,
    )


ClientContext = Annotated[ClientInfo, Depends(get_client_info)]
