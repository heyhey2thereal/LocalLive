"""Playlists: CRUD, item ordering, image durations, loop flag."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .. import db, fx
from ..deps import current_user, require, require_installed
from .. import permissions

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


class PlaylistPayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    loop: bool = True


class ItemPayload(BaseModel):
    media_id: int | None = None
    scene_id: int | None = None
    # None means "not provided" (used by PATCH so a missing field is left
    # untouched); 0 is a valid explicit value meaning "use the default".
    duration: float | None = Field(default=None, ge=0)
    transition: str | None = None
    transition_duration: float | None = Field(default=None, ge=0, le=30)
    background_audio_id: int | None = None
    background_volume: float | None = Field(default=None, ge=0, le=2)

    @field_validator("transition")
    @classmethod
    def valid_transition(cls, v: str | None) -> str | None:
        if v is not None and v not in fx.TRANSITIONS:
            raise ValueError(f"Transition invalide : {v}")
        return v


class ReorderPayload(BaseModel):
    item_ids: list[int]


def _item_dict(row) -> dict[str, Any]:
    d = dict(row)
    d["kind"] = d.get("media_kind")
    d["title"] = d.get("media_title") or d.get("scene_name") or "Élément"
    d["media_kind"] = d.get("media_kind")
    return d


def _load_items(playlist_id: int) -> list[dict[str, Any]]:
    rows = db.query(
        """SELECT pi.id, pi.media_id, pi.scene_id, pi.position, pi.duration,
                  pi.transition, pi.transition_duration, pi.background_audio_id,
                  pi.background_volume,
                  m.title AS media_title, m.kind AS media_kind, m.duration AS media_duration,
                  m.thumbnail AS thumbnail, m.path AS media_path,
                  bg.title AS background_audio_title,
                  s.name AS scene_name
           FROM playlist_items pi
           LEFT JOIN media m ON m.id = pi.media_id
           LEFT JOIN media bg ON bg.id = pi.background_audio_id
           LEFT JOIN scenes s ON s.id = pi.scene_id
           WHERE pi.playlist_id = ?
           ORDER BY pi.position""",
        (playlist_id,),
    )
    default_image = float(db.get_setting("image_duration", "5") or 5)
    items = []
    for r in rows:
        d = dict(r)
        if d["scene_id"]:
            # A scene has no intrinsic duration: it uses the item override or the
            # global image duration, exactly like the engine does.
            d["kind"] = "scene"
            effective = d["duration"] or default_image
        else:
            effective = d["duration"] or d["media_duration"] or (default_image if d["media_kind"] == "image" else 0)
        d["effective_duration"] = round(effective, 3)
        d["transition"] = d.get("transition") or "cut"
        d["transition_duration"] = float(d.get("transition_duration") or 0)
        # 0 is a valid volume (silence); only an absent value falls back to
        # the default. Using `or` here wrongly turned 0 into 0.15.
        raw_volume = d.get("background_volume")
        d["background_volume"] = 0.15 if raw_volume is None else float(raw_volume)
        if d["thumbnail"]:
            d["thumbnail_url"] = f"/api/media/{d['media_id']}/thumbnail"
        else:
            d["thumbnail_url"] = None
        items.append(d)
    return items


def _playlist_dict(row) -> dict[str, Any]:
    items = _load_items(row["id"])
    total = sum(i["effective_duration"] for i in items)
    return {
        **dict(row),
        "loop": bool(row["loop"]),
        "items": items,
        "item_count": len(items),
        "total_duration": round(total, 3),
    }


@router.get("")
def list_playlists(q: str | None = None, user: dict = Depends(current_user)) -> dict[str, Any]:
    require_installed()
    if q:
        rows = db.query("SELECT * FROM playlists WHERE name LIKE ? ORDER BY name", (f"%{q}%",))
    else:
        rows = db.query("SELECT * FROM playlists ORDER BY name")
    return {"items": [_playlist_dict(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_playlist(payload: PlaylistPayload, user: dict = Depends(require(permissions.CAP_PLAYLISTS))) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Le nom est requis")
    pid = db.execute(
        "INSERT INTO playlists(name, description, loop) VALUES(?,?,?)",
        (name, (payload.description or "").strip() or None, 1 if payload.loop else 0),
    )
    return _playlist_dict(db.query_one("SELECT * FROM playlists WHERE id = ?", (pid,)))


@router.get("/{playlist_id}")
def get_playlist(playlist_id: int, user: dict = Depends(current_user)) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Playlist introuvable")
    return _playlist_dict(row)


@router.post("/{playlist_id}/duplicate", status_code=status.HTTP_201_CREATED)
def duplicate_playlist(
    playlist_id: int, user: dict = Depends(require(permissions.CAP_PLAYLISTS))
) -> dict[str, Any]:
    """Copy a playlist and all of its items under a new name."""
    row = db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Playlist introuvable")
    name = f"{row['name']} (copie)"
    existing = {r["name"] for r in db.query("SELECT name FROM playlists")}
    counter = 2
    while name in existing:
        name = f"{row['name']} (copie {counter})"
        counter += 1
    new_id = db.execute(
        "INSERT INTO playlists(name, description, loop) VALUES(?,?,?)",
        (name, row["description"], row["loop"]),
    )
    # Copy every item, preserving order, transitions and background music.
    items = db.query("SELECT * FROM playlist_items WHERE playlist_id = ? ORDER BY position", (playlist_id,))
    for item in items:
        db.execute(
            """INSERT INTO playlist_items(playlist_id, media_id, scene_id, position, duration,
                                          transition, transition_duration, background_audio_id, background_volume)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                new_id, item["media_id"], item["scene_id"], item["position"], item["duration"],
                item["transition"], item["transition_duration"],
                item["background_audio_id"], item["background_volume"],
            ),
        )
    return _playlist_dict(db.query_one("SELECT * FROM playlists WHERE id = ?", (new_id,)))


@router.patch("/{playlist_id}")
def update_playlist(
    playlist_id: int, payload: PlaylistPayload, user: dict = Depends(require(permissions.CAP_PLAYLISTS))
) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Playlist introuvable")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Le nom est requis")
    db.execute(
        "UPDATE playlists SET name = ?, description = ?, loop = ?, updated_at = datetime('now') WHERE id = ?",
        (
            name,
            (payload.description or "").strip() or None,
            1 if payload.loop else 0,
            playlist_id,
        ),
    )
    return _playlist_dict(db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,)))


@router.delete("/{playlist_id}")
def delete_playlist(playlist_id: int, user: dict = Depends(require(permissions.CAP_PLAYLISTS))) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM playlists WHERE id = ?", (playlist_id,)):
        raise HTTPException(status_code=404, detail="Playlist introuvable")
    db.execute("DELETE FROM playlists WHERE id = ?", (playlist_id,))
    return {"ok": True}


@router.post("/{playlist_id}/items", status_code=201)
def add_item(
    playlist_id: int, payload: ItemPayload, user: dict = Depends(require(permissions.CAP_PLAYLISTS))
) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM playlists WHERE id = ?", (playlist_id,)):
        raise HTTPException(status_code=404, detail="Playlist introuvable")
    if payload.media_id is None and payload.scene_id is None:
        raise HTTPException(status_code=422, detail="Un média ou une scène est requis")
    if payload.media_id is not None and not db.query_one(
        "SELECT id FROM media WHERE id = ?", (payload.media_id,)
    ):
        raise HTTPException(status_code=404, detail="Média introuvable")
    if payload.scene_id is not None and not db.query_one(
        "SELECT id FROM scenes WHERE id = ?", (payload.scene_id,)
    ):
        raise HTTPException(status_code=404, detail="Scène introuvable")
    if payload.background_audio_id is not None and not db.query_one(
        "SELECT id FROM media WHERE id = ?", (payload.background_audio_id,)
    ):
        raise HTTPException(status_code=404, detail="Musique de fond introuvable")
    row = db.query_one(
        "SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM playlist_items WHERE playlist_id = ?",
        (playlist_id,),
    )
    db.execute(
        """INSERT INTO playlist_items(playlist_id, media_id, scene_id, position, duration,
                                      transition, transition_duration, background_audio_id, background_volume)
           VALUES(?,?,?,?,?,?,?,?,?)""",
        (
            playlist_id, payload.media_id, payload.scene_id, row["pos"], payload.duration or 0,
            payload.transition or "cut", payload.transition_duration or 0,
            payload.background_audio_id, payload.background_volume if payload.background_volume is not None else 0.15,
        ),
    )
    return _playlist_dict(db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,)))


@router.patch("/{playlist_id}/items/{item_id}")
def update_item(
    playlist_id: int, item_id: int, payload: ItemPayload, user: dict = Depends(require(permissions.CAP_PLAYLISTS))
) -> dict[str, Any]:
    if not db.query_one(
        "SELECT id FROM playlist_items WHERE id = ? AND playlist_id = ?", (item_id, playlist_id)
    ):
        raise HTTPException(status_code=404, detail="Élément introuvable")
    if payload.background_audio_id is not None and not db.query_one(
        "SELECT id FROM media WHERE id = ?", (payload.background_audio_id,)
    ):
        raise HTTPException(status_code=404, detail="Musique de fond introuvable")
    # Only touch the fields the caller actually sent: a PATCH that changes the
    # transition must not reset the duration override to zero.
    fields: list[str] = []
    values: list[Any] = []
    if payload.duration is not None:
        fields.append("duration = ?")
        values.append(payload.duration)
    if payload.transition is not None:
        fields.append("transition = ?")
        values.append(payload.transition)
    if payload.transition_duration is not None:
        fields.append("transition_duration = ?")
        values.append(payload.transition_duration)
    # `background_audio_id: null` must be able to clear the music, so rely on
    # which fields the caller actually sent (not on the value being non-null).
    if "background_audio_id" in payload.model_fields_set:
        fields.append("background_audio_id = ?")
        values.append(payload.background_audio_id)
    if payload.background_volume is not None:
        fields.append("background_volume = ?")
        values.append(payload.background_volume)
    if fields:
        values.append(item_id)
        db.execute(f"UPDATE playlist_items SET {', '.join(fields)} WHERE id = ?", tuple(values))
    return _playlist_dict(db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,)))


@router.post("/{playlist_id}/items/{item_id}/duplicate", status_code=201)
def duplicate_item(
    playlist_id: int, item_id: int, user: dict = Depends(require(permissions.CAP_PLAYLISTS))
) -> dict[str, Any]:
    """Insert a copy of an item right after it, with all its settings."""
    row = db.query_one(
        "SELECT * FROM playlist_items WHERE id = ? AND playlist_id = ?", (item_id, playlist_id)
    )
    if not row:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    # Shift the following items down to make room, then insert the copy. Rows are
    # moved one at a time from the highest position downwards: shifting them all
    # in a single UPDATE would collide with the UNIQUE(playlist_id, position)
    # index (and SQLite does not honour ORDER BY in UPDATE).
    followers = db.query(
        "SELECT id, position FROM playlist_items WHERE playlist_id = ? AND position > ? ORDER BY position DESC",
        (playlist_id, row["position"]),
    )
    with db.connection() as conn:
        for follower in followers:
            conn.execute(
                "UPDATE playlist_items SET position = ? WHERE id = ?",
                (follower["position"] + 1, follower["id"]),
            )
        conn.execute(
            """INSERT INTO playlist_items(playlist_id, media_id, scene_id, position, duration,
                                          transition, transition_duration, background_audio_id, background_volume)
               VALUES(?,?,?,?,?,?,?,?,?)""",
            (
                playlist_id, row["media_id"], row["scene_id"], row["position"] + 1, row["duration"],
                row["transition"], row["transition_duration"],
                row["background_audio_id"], row["background_volume"],
            ),
        )
    return _playlist_dict(db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,)))


@router.delete("/{playlist_id}/items/{item_id}")
def delete_item(playlist_id: int, item_id: int, user: dict = Depends(require(permissions.CAP_PLAYLISTS))) -> dict[str, Any]:
    if not db.query_one(
        "SELECT id FROM playlist_items WHERE id = ? AND playlist_id = ?", (item_id, playlist_id)
    ):
        raise HTTPException(status_code=404, detail="Élément introuvable")
    db.execute("DELETE FROM playlist_items WHERE id = ?", (item_id,))
    _resequence(playlist_id)
    return _playlist_dict(db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,)))


@router.post("/{playlist_id}/reorder")
def reorder(
    playlist_id: int, payload: ReorderPayload, user: dict = Depends(require(permissions.CAP_PLAYLISTS))
) -> dict[str, Any]:
    existing = {
        r["id"]
        for r in db.query("SELECT id FROM playlist_items WHERE playlist_id = ?", (playlist_id,))
    }
    if set(payload.item_ids) != existing:
        raise HTTPException(
            status_code=422, detail="La liste doit contenir exactement les éléments de la playlist"
        )
    with db.connection() as conn:
        for index, item_id in enumerate(payload.item_ids):
            conn.execute(
                "UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?",
                (index + 100000, item_id, playlist_id),
            )
        for index, item_id in enumerate(payload.item_ids):
            conn.execute(
                "UPDATE playlist_items SET position = ? WHERE id = ? AND playlist_id = ?",
                (index, item_id, playlist_id),
            )
    return _playlist_dict(db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,)))


def _resequence(playlist_id: int) -> None:
    rows = db.query(
        "SELECT id FROM playlist_items WHERE playlist_id = ? ORDER BY position", (playlist_id,)
    )
    with db.connection() as conn:
        for index, r in enumerate(rows):
            conn.execute("UPDATE playlist_items SET position = ? WHERE id = ?", (index, r["id"]))
