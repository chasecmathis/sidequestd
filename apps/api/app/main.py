"""FastAPI application factory and wiring."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app import __version__
from app.api.cookies import clear_refresh_cookie
from app.api.v1.router import api_router
from app.core.config import settings
from app.core.rate_limit import limiter
from app.db.session import engine
from app.services.exceptions import ConflictError, InvalidRefreshTokenError, ServiceError

logging.basicConfig(
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s %(levelname)-8s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logger.info("%s %s starting (%s)", settings.project_name, __version__, settings.environment)
    yield
    await engine.dispose()


def create_app() -> FastAPI:
    # The interactive docs advertise every endpoint and will send authenticated
    # requests from whatever browser session is open, so they are a local
    # affordance only. `create_app().openapi()` still builds the schema
    # in-process, which is what `npm run gen:types` uses — turning the route off
    # does not stop the TypeScript clients from being generated.
    docs_enabled = not settings.is_production

    app = FastAPI(
        title=settings.project_name,
        version=__version__,
        description="Shared API for the Sidequestd web and mobile clients.",
        openapi_url=f"{settings.api_v1_prefix}/openapi.json" if docs_enabled else None,
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        lifespan=lifespan,
    )

    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        # Required for the httpOnly refresh cookie to be sent cross-origin.
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    _register_exception_handlers(app)

    app.include_router(api_router, prefix=settings.api_v1_prefix)

    @app.get("/health", tags=["meta"], summary="Liveness probe")
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    return app


def _register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ConflictError)
    async def conflict_handler(_: Request, exc: ConflictError) -> JSONResponse:
        # `field` lets the client attach the message to the offending input
        # (SPEC §6.1: "uniqueness validated with clear error messages").
        return JSONResponse(
            status_code=exc.status_code, content={"detail": exc.detail, "field": exc.field}
        )

    @app.exception_handler(ServiceError)
    async def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
        response = JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        if isinstance(exc, InvalidRefreshTokenError):
            # Whatever the browser is holding is dead; drop it so the client
            # stops retrying with it and falls through to the sign-in screen.
            clear_refresh_cookie(response)
        return response

    @app.exception_handler(RateLimitExceeded)
    async def rate_limit_handler(_: Request, exc: RateLimitExceeded) -> JSONResponse:
        headers = {}
        if exc.limit is not None:
            headers["Retry-After"] = str(exc.limit.limit.get_expiry())
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many attempts. Please wait a moment and try again."},
            headers=headers,
        )


app = create_app()
