"""Application configuration and filesystem paths.

All persistent state lives under a single data directory so that backup and
uninstall scripts only ever need to touch one location.
"""
from __future__ import annotations

import os
from pathlib import Path


def _resolve_data_dir() -> Path:
    env = os.environ.get("LOCALLIVE_DATA")
    if env:
        return Path(env).expanduser().resolve()
    # Production default (created by install.sh), fall back to local ./data for dev.
    prod = Path("/var/lib/locallive")
    if prod.parent.exists() and os.access(prod.parent, os.W_OK):
        return prod
    return (Path(__file__).resolve().parents[2] / "data").resolve()


DATA_DIR = _resolve_data_dir()
MEDIA_DIR = DATA_DIR / "media"
THUMBS_DIR = DATA_DIR / "thumbs"
PREVIEWS_DIR = DATA_DIR / "previews"
LOGS_DIR = DATA_DIR / "logs"
TMP_DIR = DATA_DIR / "tmp"
DB_PATH = DATA_DIR / "locallive.db"

# Where the compiled frontend lives (frontend/dist after `npm run build`).
FRONTEND_DIST = Path(
    os.environ.get(
        "LOCALLIVE_FRONTEND",
        str(Path(__file__).resolve().parents[2] / "frontend" / "dist"),
    )
)

FFMPEG_BIN = os.environ.get("LOCALLIVE_FFMPEG", "ffmpeg")
FFPROBE_BIN = os.environ.get("LOCALLIVE_FFPROBE", "ffprobe")

SESSION_COOKIE = "locallive_session"
SESSION_TTL_SECONDS = int(os.environ.get("LOCALLIVE_SESSION_TTL", str(60 * 60 * 24 * 14)))

HOST = os.environ.get("LOCALLIVE_HOST", "0.0.0.0")
PORT = int(os.environ.get("LOCALLIVE_PORT", "8000"))

# Upload limit (bytes) — 8 GiB by default; streams to disk, never buffered in RAM.
MAX_UPLOAD_BYTES = int(os.environ.get("LOCALLIVE_MAX_UPLOAD", str(8 * 1024**3)))

LOG_MAX_BYTES = int(os.environ.get("LOCALLIVE_LOG_MAX_BYTES", str(2 * 1024**2)))
LOG_BACKUPS = int(os.environ.get("LOCALLIVE_LOG_BACKUPS", "3"))


def ensure_dirs() -> None:
    for d in (DATA_DIR, MEDIA_DIR, THUMBS_DIR, PREVIEWS_DIR, LOGS_DIR, TMP_DIR):
        d.mkdir(parents=True, exist_ok=True)
