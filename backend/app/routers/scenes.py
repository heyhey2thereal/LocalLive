"""Scene editor: layered compositions rendered by the playback engine."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..deps import admin_user, current_user, require_installed

router = APIRouter(prefix="/api/scenes", tags=["scenes"])

LAYER_TYPES = {"video", "image", "text", "logo", "overlay"}


class Layer(BaseModel):
    type: str
    x: float = 0
    y: float = 0
    width: float | None = None
    height: float | None = None
    opacity: float = Field(default=1.0, ge=0, le=1)
    visible: bool = True
    z: int = 0
    media_id: int | None = None
    text: str | None = None
    font_size: int = 48
    color: str = "#ffffff"
    background: str | None = None
    align: str = "left"

    @field_validator("type")
    @classmethod
    def valid_type(cls, v: str) -> str:
        if v not in LAYER_TYPES:
            raise ValueError(f"Type de calque invalide : {v}")
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
def list_scenes(user: dict = Depends(current_user)) -> dict[str, Any]:
    require_installed()
    rows = db.query("SELECT * FROM scenes ORDER BY name")
    return {"items": [_scene_dict(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_scene(payload: ScenePayload, user: dict = Depends(admin_user)) -> dict[str, Any]:
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        (
            payload.name.strip(),
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


@router.put("/{scene_id}")
def update_scene(
    scene_id: int, payload: ScenePayload, user: dict = Depends(admin_user)
) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM scenes WHERE id = ?", (scene_id,)):
        raise HTTPException(status_code=404, detail="Scène introuvable")
    db.execute(
        "UPDATE scenes SET name=?, width=?, height=?, background=?, layers=?, updated_at=datetime('now') WHERE id=?",
        (
            payload.name.strip(),
            payload.width,
            payload.height,
            payload.background,
            json.dumps([l.model_dump() for l in payload.layers]),
            scene_id,
        ),
    )
    return _scene_dict(db.query_one("SELECT * FROM scenes WHERE id = ?", (scene_id,)))


@router.delete("/{scene_id}")
def delete_scene(scene_id: int, user: dict = Depends(admin_user)) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM scenes WHERE id = ?", (scene_id,)):
        raise HTTPException(status_code=404, detail="Scène introuvable")
    db.execute("DELETE FROM scenes WHERE id = ?", (scene_id,))
    return {"ok": True}
