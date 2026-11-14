"""Media folders."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from .. import db
from ..deps import admin_user, current_user

router = APIRouter(prefix="/api/media/folders", tags=["folders"])


@router.get("/list")
def list_folders(user: dict = Depends(current_user)) -> dict[str, Any]:
    rows = db.query("SELECT * FROM folders ORDER BY name")
    counts = {
        r["folder_id"]: r["c"]
        for r in db.query("SELECT folder_id, COUNT(*) c FROM media GROUP BY folder_id")
    }
    return {"folders": [{**dict(r), "count": counts.get(r["id"], 0)} for r in rows]}


class FolderPayload(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.post("", status_code=201)
def create_folder(payload: FolderPayload, user: dict = Depends(admin_user)) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Nom requis")
    fid = db.execute("INSERT INTO folders(name) VALUES(?)", (name,))
    return {"id": fid, "name": name, "count": 0}


@router.delete("/{folder_id}")
def delete_folder(folder_id: int, user: dict = Depends(admin_user)) -> dict[str, Any]:
    db.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    return {"ok": True}
