"""FastAPI application factory.

Serves the REST API under /api and the compiled React frontend for everything
else. The playback engine lives in its own module and keeps running regardless
of whether a browser is connected.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config, db, security
from .logging_setup import setup_logging
from .routers import (
    auth,
    broadcast,
    folders,
    media,
    meta,
    playlists,
    scenes,
    schedules,
    setup,
    streams,
    system,
    users,
)

log = logging.getLogger("locallive")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    db.init_db()
    security.purge_expired_sessions()
    log.info("LocalLive %s démarré — données : %s", __version__, config.DATA_DIR)
    yield
    log.info("LocalLive arrêté")


def create_app() -> FastAPI:
    app = FastAPI(title="LocalLive", version=__version__, lifespan=lifespan)

    app.include_router(setup.router)
    app.include_router(auth.router)
    app.include_router(folders.router)
    app.include_router(media.router)
    app.include_router(playlists.router)
    app.include_router(scenes.router)
    app.include_router(streams.router)
    app.include_router(schedules.router)
    app.include_router(broadcast.router)
    app.include_router(users.router)
    app.include_router(meta.router)
    app.include_router(system.router)

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "version": __version__, "installed": db.is_installed()}

    @app.get("/api/config")
    def public_config() -> dict:
        return {
            "installed": db.is_installed(),
            "channel_name": db.get_setting("channel_name", "LocalLive"),
            "language": db.get_setting("language", "fr"),
            "version": __version__,
        }

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("Erreur non gérée sur %s", request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Erreur interne du serveur"})

    _mount_frontend(app)
    return app


def _mount_frontend(app: FastAPI) -> None:
    dist = config.FRONTEND_DIST
    index = dist / "index.html"

    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Route inconnue"})
        candidate = (dist / full_path).resolve()
        if full_path and dist.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        if index.exists():
            return FileResponse(index)
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Frontend non compilé. Exécutez `npm run build` dans frontend/.",
            },
        )


app = create_app()
