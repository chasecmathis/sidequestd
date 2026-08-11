"""Auth endpoints — SPEC §6.1, §8.

Token delivery is dual-mode by design (§2 has one API serving web and mobile):
every response carries the token pair in its JSON body, which is what the native
client stores, *and* sets the refresh token in an httpOnly cookie, which is what
the web client uses. The web client keeps only the access token, in memory.
"""

from __future__ import annotations

from fastapi import APIRouter, Request, Response, status

from app.api.cookies import clear_refresh_cookie, set_refresh_cookie
from app.api.deps import ClientContext, DbSession
from app.core.config import settings
from app.core.rate_limit import limiter
from app.schemas.auth import (
    AuthSession,
    LoginRequest,
    LogoutRequest,
    MessageResponse,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
)
from app.schemas.user import UserMe
from app.services import auth as auth_service
from app.services.auth import IssuedSession
from app.services.exceptions import InvalidRefreshTokenError

router = APIRouter(prefix="/auth", tags=["auth"])


def _session_response(session: IssuedSession, response: Response) -> AuthSession:
    set_refresh_cookie(response, session.refresh_token)
    return AuthSession(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        expires_in=session.expires_in,
        user=UserMe.model_validate(session.user),
    )


def _refresh_token_from(request: Request, supplied: str | None) -> str | None:
    """Body first (native clients), then the cookie (web)."""
    return supplied or request.cookies.get(settings.refresh_cookie_name)


@router.post(
    "/register",
    response_model=AuthSession,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account",
    responses={409: {"description": "Username or email already in use"}},
)
@limiter.limit(settings.rate_limit_auth)
async def register(
    request: Request,
    response: Response,
    payload: RegisterRequest,
    db: DbSession,
    client: ClientContext,
) -> AuthSession:
    """Register and sign in as the new user in one round trip."""
    session = await auth_service.register_user(db, payload, client)
    response.status_code = status.HTTP_201_CREATED
    return _session_response(session, response)


@router.post(
    "/login",
    response_model=AuthSession,
    summary="Sign in with email or username",
    responses={401: {"description": "Invalid credentials"}},
)
@limiter.limit(settings.rate_limit_auth)
async def login(
    request: Request,
    response: Response,
    payload: LoginRequest,
    db: DbSession,
    client: ClientContext,
) -> AuthSession:
    session = await auth_service.login(db, payload.identifier, payload.password, client)
    return _session_response(session, response)


@router.post(
    "/refresh",
    response_model=AuthSession,
    summary="Exchange a refresh token for a new token pair",
    responses={401: {"description": "Missing, expired, revoked, or replayed refresh token"}},
)
@limiter.limit(settings.rate_limit_auth)
async def refresh(
    request: Request,
    response: Response,
    payload: RefreshRequest,
    db: DbSession,
    client: ClientContext,
) -> AuthSession:
    """Rotates: the presented token is revoked and a fresh pair is issued.

    Presenting a token that was already rotated revokes every token descended
    from the same login, on the assumption that a copy has leaked.

    Any failure here clears the browser's refresh cookie — see the
    InvalidRefreshTokenError branch of the handler in main.py.
    """
    raw_token = _refresh_token_from(request, payload.refresh_token)
    if raw_token is None:
        raise InvalidRefreshTokenError
    session = await auth_service.refresh_session(db, raw_token, client)
    return _session_response(session, response)


@router.post("/logout", response_model=MessageResponse, summary="Sign out")
async def logout(
    request: Request,
    response: Response,
    payload: LogoutRequest,
    db: DbSession,
) -> MessageResponse:
    """Idempotent, and deliberately unauthenticated: a client whose access token
    has already expired must still be able to invalidate its refresh token."""
    raw_token = _refresh_token_from(request, payload.refresh_token)
    await auth_service.revoke_refresh_token(db, raw_token, all_sessions=payload.all_sessions)
    clear_refresh_cookie(response)
    return MessageResponse(detail="Signed out.")


@router.post(
    "/password-reset",
    response_model=MessageResponse,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Request a password reset email",
)
@limiter.limit(settings.rate_limit_password_reset)
async def request_password_reset(
    request: Request,
    # Unused by the handler, but slowapi writes its X-RateLimit-* headers onto
    # this object and raises if a limited endpoint does not declare one.
    response: Response,
    payload: PasswordResetRequest,
    db: DbSession,
) -> MessageResponse:
    """Always returns 202, whether or not the address is registered — the
    response must not reveal which emails have accounts."""
    await auth_service.request_password_reset(db, payload.email)
    return MessageResponse(
        detail="If an account exists for that email address, a reset link is on its way."
    )


@router.post(
    "/password-reset/confirm",
    response_model=MessageResponse,
    summary="Set a new password using an emailed token",
    responses={400: {"description": "Token is invalid, expired, or already used"}},
)
@limiter.limit(settings.rate_limit_password_reset)
async def confirm_password_reset(
    request: Request,
    response: Response,
    payload: PasswordResetConfirm,
    db: DbSession,
) -> MessageResponse:
    """Consumes the token and signs the user out everywhere."""
    await auth_service.confirm_password_reset(db, payload.token, payload.new_password)
    clear_refresh_cookie(response)
    return MessageResponse(detail="Your password has been changed. Please sign in again.")
