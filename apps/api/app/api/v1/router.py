"""Aggregates the v1 routers. Later slices register their routers here."""

from fastapi import APIRouter

from app.api.v1 import (
    auth,
    backlog,
    connections,
    devices,
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
# Ahead of `users`, whose `/users/{username}` would otherwise be a candidate for
# `/users/me/devices`. See the note in `app.api.v1.devices`.
api_router.include_router(devices.router)
api_router.include_router(users.router)
api_router.include_router(games.router)
api_router.include_router(search.router)
api_router.include_router(reviews.router)
api_router.include_router(social.router)
api_router.include_router(interactions.router)
api_router.include_router(backlog.router)
api_router.include_router(feed.router)
api_router.include_router(notifications.router)
api_router.include_router(connections.router)
