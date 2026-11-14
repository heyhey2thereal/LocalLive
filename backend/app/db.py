"""SQLite persistence layer.

Deliberately dependency-free (stdlib sqlite3) to keep the footprint small on the
target 2-core Celeron host. One short-lived connection per operation, WAL mode
for concurrent reads while the playback engine writes.
"""
from __future__ import annotations

import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator

from . import config

_init_lock = threading.Lock()
_initialised = False

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_login    TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    filename      TEXT NOT NULL,
    path          TEXT NOT NULL,
    kind          TEXT NOT NULL,            -- video | audio | image
    mime          TEXT,
    size          INTEGER NOT NULL DEFAULT 0,
    duration      REAL NOT NULL DEFAULT 0,  -- seconds (0 for images)
    width         INTEGER,
    height        INTEGER,
    fps           REAL,
    video_codec   TEXT,
    audio_codec   TEXT,
    bitrate       INTEGER,
    has_audio     INTEGER NOT NULL DEFAULT 0,
    thumbnail     TEXT,
    folder_id     INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    category      TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    loop        INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scenes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    width      INTEGER NOT NULL DEFAULT 1920,
    height     INTEGER NOT NULL DEFAULT 1080,
    background TEXT NOT NULL DEFAULT '#000000',
    layers     TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playlist_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    playlist_id     INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    media_id        INTEGER REFERENCES media(id) ON DELETE CASCADE,
    scene_id        INTEGER REFERENCES scenes(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL DEFAULT 0,
    duration        REAL NOT NULL DEFAULT 0,  -- override / image duration
    UNIQUE(playlist_id, position)
);

CREATE TABLE IF NOT EXISTS schedules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE SET NULL,
    days        TEXT NOT NULL DEFAULT '[]',   -- list of ints 0..6 (Mon=0)
    start_time  TEXT NOT NULL,                -- HH:MM
    end_time    TEXT NOT NULL,                -- HH:MM
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


def _connect() -> sqlite3.Connection:
    config.ensure_dirs()
    conn = sqlite3.connect(config.DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    global _initialised
    with _init_lock:
        if _initialised:
            return
        with connection() as conn:
            conn.executescript(SCHEMA)
        _initialised = True


def query(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    with connection() as conn:
        return conn.execute(sql, tuple(params)).fetchall()


def query_one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    with connection() as conn:
        return conn.execute(sql, tuple(params)).fetchone()


def execute(sql: str, params: Iterable[Any] = ()) -> int:
    """Run a statement, returning lastrowid (or rowcount for UPDATE/DELETE)."""
    with connection() as conn:
        cur = conn.execute(sql, tuple(params))
        return cur.lastrowid if cur.lastrowid else cur.rowcount


# ---------------------------------------------------------------------------
# Settings helpers
# ---------------------------------------------------------------------------
def get_setting(key: str, default: str | None = None) -> str | None:
    row = query_one("SELECT value FROM settings WHERE key = ?", (key,))
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with connection() as conn:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def get_all_settings() -> dict[str, str]:
    return {r["key"]: r["value"] for r in query("SELECT key, value FROM settings")}


def is_installed() -> bool:
    return get_setting("installed") == "1"


def db_size() -> int:
    p = Path(config.DB_PATH)
    total = p.stat().st_size if p.exists() else 0
    for suffix in ("-wal", "-shm"):
        sp = Path(str(p) + suffix)
        if sp.exists():
            total += sp.stat().st_size
    return total
