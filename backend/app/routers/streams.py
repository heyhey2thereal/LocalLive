"""Output streams: CRUD for RTMP/file destinations with metadata.

A stream is an additional broadcast target (its own URL/key, dimensions and
encoding) that the engine fans out to alongside the primary output. The stream
key is never returned raw: it is masked like the broadcast settings key.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..deps import admin_user, current_user, require_installed
from ..security import mask_secret

router = APIRouter(prefix="/api/streams", tags=["streams"])

PRIVACY = {"public", "unlisted", "private"}
KINDS = {"rtmp", "file"}
PRESETS = {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium"}


class StreamPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    tags: list[str] = Field(default_factory=list)
    privacy: str = "public"
    category: str | None = Field(default=None, max_length=80)
    encoding: str = "veryfast"
    kind: str = "rtmp"
    rtmp_url: str | None = None
    stream_key: str | None = None
    output_file: str | None = None
    width: int = Field(default=1280, ge=16, le=7680)
    height: int = Field(default=720, ge=16, le=4320)
    fps: int = Field(default=25, ge=1, le=120)
    bitrate: int = Field(default=2500, ge=100, le=50000)
    audio_bitrate: int = Field(default=128, ge=32, le=512)
    enabled: bool = True

    @field_validator("privacy")
    @classmethod
    def valid_privacy(cls, v: str) -> str:
        if v not in PRIVACY:
            raise ValueError(f"Confidentialité invalide : {v}")
        return v

    @field_validator("kind")
    @classmethod
    def valid_kind(cls, v: str) -> str:
        if v not in KINDS:
            raise ValueError(f"Type de flux invalide : {v}")
        return v

    @field_validator("encoding")
    @classmethod
    def valid_preset(cls, v: str) -> str:
        if v not in PRESETS:
            raise ValueError(f"Encodage invalide : {v}")
        return v

    @field_validator("rtmp_url")
    @classmethod
    def valid_url(cls, v: str | None) -> str | None:
        if v:
            url = v.strip()
            if not (url.startswith("rtmp://") or url.startswith("rtmps://")):
                raise ValueError("L'URL RTMP doit commencer par rtmp:// ou rtmps://")
            return url.rstrip("/")
        return v


def _stream_dict(row) -> dict[str, Any]:
    d = dict(row)
    try:
        d["tags"] = json.loads(d["tags"])
    except (json.JSONDecodeError, TypeError):
        d["tags"] = []
    d["enabled"] = bool(d["enabled"])
    # Never expose the raw key.
    d["has_stream_key"] = bool(d["stream_key"])
    d["stream_key_masked"] = mask_secret(d["stream_key"])
    d.pop("stream_key", None)
    return d


@router.get("")
def list_streams(user: dict = Depends(current_user)) -> dict[str, Any]:
    require_installed()
    rows = db.query("SELECT * FROM streams ORDER BY name")
    return {"items": [_stream_dict(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_stream(payload: StreamPayload, user: dict = Depends(admin_user)) -> dict[str, Any]:
    sid = db.execute(
        """INSERT INTO streams(name, description, tags, privacy, category, encoding, kind,
                               rtmp_url, stream_key, output_file, width, height, fps,
                               bitrate, audio_bitrate, enabled)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            payload.name.strip(),
            (payload.description or "").strip() or None,
            json.dumps(payload.tags),
            payload.privacy,
            (payload.category or "").strip() or None,
            payload.encoding,
            payload.kind,
            payload.rtmp_url,
            payload.stream_key or "",
            payload.output_file,
            payload.width,
            payload.height,
            payload.fps,
            payload.bitrate,
            payload.audio_bitrate,
            1 if payload.enabled else 0,
        ),
    )
    return _stream_dict(db.query_one("SELECT * FROM streams WHERE id = ?", (sid,)))


@router.get("/{stream_id}")
def get_stream(stream_id: int, user: dict = Depends(current_user)) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM streams WHERE id = ?", (stream_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Flux introuvable")
    return _stream_dict(row)


@router.put("/{stream_id}")
def update_stream(
    stream_id: int, payload: StreamPayload, user: dict = Depends(admin_user)
) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM streams WHERE id = ?", (stream_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Flux introuvable")
    # An empty key clears it; the masked placeholder leaves it unchanged.
    key = row["stream_key"] or ""
    if payload.stream_key is not None:
        candidate = payload.stream_key.strip()
        if candidate and "•" not in candidate:
            key = candidate
        elif not candidate:
            key = ""
    db.execute(
        """UPDATE streams SET name=?, description=?, tags=?, privacy=?, category=?, encoding=?,
                  kind=?, rtmp_url=?, stream_key=?, output_file=?, width=?, height=?, fps=?,
                  bitrate=?, audio_bitrate=?, enabled=?, updated_at=datetime('now')
           WHERE id=?""",
        (
            payload.name.strip(),
            (payload.description or "").strip() or None,
            json.dumps(payload.tags),
            payload.privacy,
            (payload.category or "").strip() or None,
            payload.encoding,
            payload.kind,
            payload.rtmp_url,
            key,
            payload.output_file,
            payload.width,
            payload.height,
            payload.fps,
            payload.bitrate,
            payload.audio_bitrate,
            1 if payload.enabled else 0,
            stream_id,
        ),
    )
    return _stream_dict(db.query_one("SELECT * FROM streams WHERE id = ?", (stream_id,)))


@router.delete("/{stream_id}")
def delete_stream(stream_id: int, user: dict = Depends(admin_user)) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM streams WHERE id = ?", (stream_id,)):
        raise HTTPException(status_code=404, detail="Flux introuvable")
    db.execute("DELETE FROM streams WHERE id = ?", (stream_id,))
    return {"ok": True}


@router.post("/{stream_id}/test")
def test_stream(stream_id: int, user: dict = Depends(admin_user)) -> dict[str, Any]:
    """Attempt a short RTMP handshake with this stream's destination."""
    from ..routers.broadcast import probe_rtmp

    row = db.query_one("SELECT * FROM streams WHERE id = ?", (stream_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Flux introuvable")
    if row["kind"] != "rtmp":
        return {"ok": True, "message": "Sortie fichier — rien à tester"}
    return probe_rtmp(row["rtmp_url"] or "", row["stream_key"] or "")
