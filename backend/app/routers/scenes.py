"""Scene editor: layered compositions rendered by the playback engine."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .. import db, fx
from ..deps import current_user, require, require_installed
from .. import permissions

router = APIRouter(prefix="/api/scenes", tags=["scenes"])

FRAMES = {f["id"] for f in fx.FRAMES}

LAYER_TYPES = {
    "video", "image", "text", "logo", "overlay", "reactive", "code", "chat",
    "countdown", "web", "clock", "ticker",
}
ANIMATIONS = set(fx.ANIMATIONS)
IN_ANIMATIONS = set(fx.IN_ANIMATIONS)
LOOP_ANIMATIONS = set(fx.LOOP_ANIMATIONS)
OUT_ANIMATIONS = set(fx.OUT_ANIMATIONS)
VISUALIZERS = set(fx.VISUALIZERS)


class Layer(BaseModel):
    type: str
    x: float = 0
    y: float = 0
    width: float | None = None
    height: float | None = None
    opacity: float = Field(default=1.0, ge=0, le=1)
    visible: bool = True
    z: int = 0
    rotation: float = 0
    media_id: int | None = None
    text: str | None = None
    font_size: int = 48
    font: str = "default"
    color: str = "#ffffff"
    background: str | None = None
    align: str = "left"
    # Legacy single animation + the new in/loop/out trio.
    animation: str = "none"
    anim_in: str = "none"
    anim_loop: str = "none"
    anim_out: str = "none"
    animation_speed: float | None = None
    visualizer: str | None = None
    code: str | None = None
    # Chat overlay: a source label (e.g. "Twitch") and a max number of lines.
    chat_source: str | None = None
    chat_lines: int = 8
    # Countdown layer.
    countdown_seconds: int = 60
    countdown_mode: str = "down"
    # "Continue in background": the countdown keeps running on wall-clock time
    # even while its scene is not on the program or in the preview. `start` is
    # the epoch (seconds) the countdown was started; `elapsed` accumulates the
    # seconds already run (used when paused / restarted).
    countdown_background: bool = False
    countdown_start: float | None = None
    countdown_elapsed: int = 0
    countdown_paused: bool = False
    # Clock layer.
    clock_format: str = "%H:%M"
    clock_utc: bool = False
    # Ticker layer (RSS/Atom).
    feed_url: str | None = None
    feed_limit: int = 8
    # Web/URL layer (image fetched over HTTP).
    url: str | None = None
    # Gaussian blur radius (0 = none).
    blur: float = 0
    # Image frame: shape crop + optional coloured border.
    frame: str = "none"
    frame_radius: int = Field(default=40, ge=0, le=400)
    frame_border: int = Field(default=0, ge=0, le=80)
    frame_color: str = "#ffffff"
    # Loop animation "reactive to music": sensitivity (0.1 = calm, 3 = lively).
    audio_sensitivity: float = Field(default=1.0, ge=0.1, le=5)

    @field_validator("anim_in")
    @classmethod
    def valid_anim_in(cls, v: str) -> str:
        if v not in IN_ANIMATIONS:
            raise ValueError(f"Animation d'entrée invalide : {v}")
        return v

    @field_validator("anim_loop")
    @classmethod
    def valid_anim_loop(cls, v: str) -> str:
        if v not in LOOP_ANIMATIONS:
            raise ValueError(f"Animation de boucle invalide : {v}")
        return v

    @field_validator("anim_out")
    @classmethod
    def valid_anim_out(cls, v: str) -> str:
        if v not in OUT_ANIMATIONS:
            raise ValueError(f"Animation de sortie invalide : {v}")
        return v

    @field_validator("countdown_mode")
    @classmethod
    def valid_countdown_mode(cls, v: str) -> str:
        if v not in ("up", "down"):
            raise ValueError("Mode de compte à rebours invalide")
        return v

    @field_validator("type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in LAYER_TYPES:
            raise ValueError(f"Type de calque invalide : {v}")
        return v

    @field_validator("animation")
    @classmethod
    def valid_animation(cls, v: str) -> str:
        if v not in ANIMATIONS:
            raise ValueError(f"Animation invalide : {v}")
        return v

    @field_validator("visualizer")
    @classmethod
    def valid_visualizer(cls, v: str | None) -> str | None:
        if v is not None and v not in VISUALIZERS:
            raise ValueError(f"Visualiseur invalide : {v}")
        return v

    @field_validator("frame")
    @classmethod
    def valid_frame(cls, v: str) -> str:
        if v not in FRAMES:
            raise ValueError(f"Cadre invalide : {v}")
        return v


class ScenePayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    width: int = Field(default=1920, ge=16, le=7680)
    height: int = Field(default=1080, ge=16, le=4320)
    background: str = "#000000"
    layers: list[Layer] = Field(default_factory=list)


def _scene_dict(row) -> dict[str, Any]:
    d = dict(row)
    try:
        d["layers"] = json.loads(d["layers"])
    except (json.JSONDecodeError, TypeError):
        d["layers"] = []
    return d


@router.get("")
def list_scenes(q: str | None = None, user: dict = Depends(current_user)) -> dict[str, Any]:
    require_installed()
    if q:
        rows = db.query("SELECT * FROM scenes WHERE name LIKE ? ORDER BY name", (f"%{q}%",))
    else:
        rows = db.query("SELECT * FROM scenes ORDER BY name")
    return {"items": [_scene_dict(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_scene(payload: ScenePayload, user: dict = Depends(require(permissions.CAP_SCENES))) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Le nom est requis")
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        (
            name,
            payload.width,
            payload.height,
            payload.background,
            json.dumps([l.model_dump() for l in payload.layers]),
        ),
    )
    return _scene_dict(db.query_one("SELECT * FROM scenes WHERE id = ?", (sid,)))


@router.get("/{scene_id}")
def get_scene(scene_id: int, user: dict = Depends(current_user)) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM scenes WHERE id = ?", (scene_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Scène introuvable")
    return _scene_dict(row)


@router.post("/{scene_id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_scene(scene_id: int, user: dict = Depends(require(permissions.CAP_SCENES))) -> dict[str, Any]:
    """Copy a scene (layers included) under a new name."""
    row = db.query_one("SELECT * FROM scenes WHERE id = ?", (scene_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Scène introuvable")
    name = f"{row['name']} (copie)"
    # Avoid clashing names by appending a counter.
    existing = {r["name"] for r in db.query("SELECT name FROM scenes")}
    counter = 2
    while name in existing:
        name = f"{row['name']} (copie {counter})"
        counter += 1
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        (name, row["width"], row["height"], row["background"], row["layers"]),
    )
    return _scene_dict(db.query_one("SELECT * FROM scenes WHERE id = ?", (sid,)))


@router.put("/{scene_id}")
def update_scene(
    scene_id: int, payload: ScenePayload, user: dict = Depends(require(permissions.CAP_SCENES))
) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM scenes WHERE id = ?", (scene_id,)):
        raise HTTPException(status_code=404, detail="Scène introuvable")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Le nom est requis")
    db.execute(
        "UPDATE scenes SET name=?, width=?, height=?, background=?, layers=?, updated_at=datetime('now') WHERE id=?",
        (
            name,
            payload.width,
            payload.height,
            payload.background,
            json.dumps([l.model_dump() for l in payload.layers]),
            scene_id,
        ),
    )
    return _scene_dict(db.query_one("SELECT * FROM scenes WHERE id = ?", (scene_id,)))


@router.delete("/{scene_id}")
def delete_scene(scene_id: int, user: dict = Depends(require(permissions.CAP_SCENES))) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM scenes WHERE id = ?", (scene_id,)):
        raise HTTPException(status_code=404, detail="Scène introuvable")
    db.execute("DELETE FROM scenes WHERE id = ?", (scene_id,))
    return {"ok": True}
