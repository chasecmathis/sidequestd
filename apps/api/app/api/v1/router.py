"""Aggregates the v1 routers. Later slices register their routers here."""

from fastapi import APIRouter

from app.api.v1 import (
    auth,
    backlog,
    feed,
    games,
    interactions,
    notifications,
    reviews,
    search,
    social,
    users,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(games.router)
api_router.include_router(search.router)
api_router.include_router(reviews.router)
api_router.include_router(social.router)
api_router.include_router(interactions.router)
api_router.include_router(backlog.router)
api_router.include_router(feed.router)
api_router.include_router(notifications.router)
