"""Dangerous maintenance operations: full reset.

A "reset everything" wipes all content (media files, thumbnails, playlists,
scenes, streams, schedules, folders) and clears the corresponding database rows.
User accounts are kept so the operator stays logged in, and the installation
stays "installed" (no need to re-run the setup wizard). Requires the users
capability (admin) and an explicit confirmation token.
"""
from __future__ import annotations

import shutil
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import config, db, permissions
from ..deps import require
from ..engine import get_engine

router = APIRouter(prefix="/api/maintenance", tags=["maintenance"])

# A phrase the caller must echo back so a stray request cannot wipe the install.
CONFIRM_PHRASE = "RESET"

_CONTENT_TABLES = [
    "playlist_items",
    "playlists",
    "scenes",
    "media",
    "folders",
    "streams",
    "schedules",
]


class ResetPayload(BaseModel):
    confirm: str
    keep_media_files: bool = False


@router.get("/reset/preview")
def reset_preview(user: dict = Depends(require(permissions.CAP_USERS))) -> dict[str, Any]:
    """Report what a reset would remove, without touching anything."""
    counts = {}
    for table in _CONTENT_TABLES:
        row = db.query_one(f"SELECT COUNT(*) AS n FROM {table}")
        counts[table] = int(row["n"]) if row else 0
    return {
        "confirm_phrase": CONFIRM_PHRASE,
        "tables": counts,
        "media_dir": str(config.MEDIA_DIR),
        "thumbnails_dir": str(config.THUMBS_DIR),
    }


@router.post("/reset")
def reset(payload: ResetPayload, user: dict = Depends(require(permissions.CAP_USERS))) -> dict[str, Any]:
    if payload.confirm.strip().upper() != CONFIRM_PHRASE:
        raise HTTPException(status_code=422, detail="Confirmation invalide")

    # Stop the engine first so it is not writing to files we are about to remove.
    get_engine().stop()

    removed_files = 0
    if not payload.keep_media_files:
        for directory in (config.MEDIA_DIR, config.THUMBS_DIR, config.TMP_DIR):
            if directory.exists():
                for child in directory.iterdir():
                    try:
                        if child.is_dir():
                            shutil.rmtree(child, ignore_errors=True)
                        else:
                            child.unlink()
                        removed_files += 1
                    except OSError:
                        pass

    # Clear content tables. Sessions are kept (the admin stays logged in).
    with db.connection() as conn:
        for table in _CONTENT_TABLES:
            conn.execute(f"DELETE FROM {table}")
        # Reset the fallback playlist pointer now that playlists are gone.
        conn.execute("DELETE FROM settings WHERE key = 'fallback_playlist_id'")

    return {
        "ok": True,
        "removed_files": removed_files,
        "message": "Tout le contenu a été réinitialisé. Les comptes utilisateurs sont conservés.",
    }
