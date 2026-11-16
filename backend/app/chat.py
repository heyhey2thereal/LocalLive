"""In-memory chat overlay store.

Chat boxes are scene layers that display the most recent messages of a named
source (e.g. "twitch"). Messages arrive through the REST API (viewers, a relay
script, or the built-in test form) and are kept in a small per-source ring
buffer. The playback engine renders the latest lines when it builds a scene.

This is intentionally simple and dependency-free: no external chat service is
contacted. A companion script can forward Twitch/YouTube chat into
`POST /api/chat/{source}`.
"""
from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any

_MAX_LINES = 50
_lock = threading.Lock()
_buffers: dict[str, deque[dict[str, Any]]] = {}


def _buffer(source: str) -> deque[dict[str, Any]]:
    key = (source or "chat").strip().lower()
    if key not in _buffers:
        _buffers[key] = deque(maxlen=_MAX_LINES)
    return _buffers[key]


def add(source: str, user: str, text: str) -> dict[str, Any]:
    entry = {
        "user": (user or "Anonyme").strip()[:40],
        "text": (text or "").strip()[:300],
        "at": time.time(),
    }
    with _lock:
        _buffer(source).append(entry)
    return entry


def recent(source: str, limit: int = 8) -> list[dict[str, Any]]:
    with _lock:
        return list(_buffer(source))[-max(1, min(limit, _MAX_LINES)):]


def sources() -> list[str]:
    with _lock:
        return sorted(_buffers.keys())


def clear(source: str) -> None:
    with _lock:
        _buffer(source).clear()
