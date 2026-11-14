"""Media library: uploads, metadata, thumbnails, folders, storage."""
from __future__ import annotations

import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any, Iterator

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from .. import config, db, monitor, probe
from ..deps import current_user, require, require_installed
from .. import permissions

router = APIRouter(prefix="/api/media", tags=["media"])

_SAFE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_name(name: str) -> str:
    name = os.path.basename(name)
    stem, ext = os.path.splitext(name)
    stem = _SAFE.sub("_", stem)[:80] or "media"
    ext = _SAFE.sub("", ext)[:10]
    return f"{stem}{ext}"


def _row_to_media(row) -> dict[str, Any]:
    d = dict(row)
    d["has_audio"] = bool(d.get("has_audio"))
    if d.get("thumbnail"):
        d["thumbnail_url"] = f"/api/media/{d['id']}/thumbnail"
    else:
        d["thumbnail_url"] = None
    d["stream_url"] = f"/api/media/{d['id']}/stream"
    # Medium-resolution cached image: fast to load and sharp enough to enlarge.
    d["preview_url"] = f"/api/media/{d['id']}/preview"
    return d


def _chunked_upload(src: UploadFile, dest: Path, limit: int) -> int:
    dest.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with dest.open("wb") as out:
        while True:
            chunk = src.file.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail="Fichier trop volumineux",
                )
            out.write(chunk)
    return total


@router.get("")
def list_media(
    q: str | None = None,
    kind: str | None = None,
    folder_id: int | None = None,
    category: str | None = None,
    sort: str = "created_at",
    order: str = "desc",
    user: dict = Depends(current_user),
) -> dict[str, Any]:
    require_installed()
    where = []
    params: list[Any] = []
    if q:
        where.append("(title LIKE ? OR filename LIKE ?)")
        params += [f"%{q}%", f"%{q}%"]
    if kind and kind != "all":
        where.append("kind = ?")
        params.append(kind)
    if folder_id is not None:
        if folder_id == 0:
            where.append("folder_id IS NULL")
        else:
            where.append("folder_id = ?")
            params.append(folder_id)
    if category:
        where.append("category = ?")
        params.append(category)
    sql = "SELECT * FROM media"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sort_col = sort if sort in {"created_at", "title", "size", "duration", "kind"} else "created_at"
    sort_dir = "ASC" if order.lower() == "asc" else "DESC"
    sql += f" ORDER BY {sort_col} {sort_dir}"
    rows = db.query(sql, params)
    categories = [r["category"] for r in db.query("SELECT DISTINCT category FROM media WHERE category IS NOT NULL")]
    return {
        "items": [_row_to_media(r) for r in rows],
        "total": len(rows),
        "categories": sorted(set(categories)),
    }


@router.get("/storage")
def storage(user: dict = Depends(current_user)) -> dict[str, Any]:
    usage = monitor.media_usage()
    rows = db.query("SELECT kind, COUNT(*) c, SUM(size) s FROM media GROUP BY kind")
    by_kind = {r["kind"]: {"count": r["c"], "size": r["s"] or 0} for r in rows}
    return {
        "media_bytes": usage["media"],
        "thumbnail_bytes": usage["thumbnails"],
        "db_bytes": db.db_size(),
        "disk": monitor.disk(),
        "by_kind": by_kind,
        "count": sum(v["count"] for v in by_kind.values()),
    }


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload(
    request: Request,
    files: list[UploadFile] = File(...),
    folder_id: int | None = Form(None),
    category: str | None = Form(None),
    user: dict = Depends(require(permissions.CAP_MEDIA)),
) -> dict[str, Any]:
    require_installed()
    created: list[dict[str, Any]] = []
    for upload in files:
        original = upload.filename or "media"
        kind = probe.kind_for_ext(os.path.splitext(original)[1])
        if not kind:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail=f"Type de fichier non pris en charge : {original}",
            )
        unique = uuid.uuid4().hex[:12]
        safe = _safe_name(original)
        filename = f"{unique}_{safe}"
        dest = config.MEDIA_DIR / filename
        size = _chunked_upload(upload, dest, config.MAX_UPLOAD_BYTES)

        info = probe.probe(dest)
        duration = 0.0 if kind == "image" else info["duration"]
        thumb_name = f"{unique}.jpg"
        thumb_ok = probe.make_thumbnail(dest, config.THUMBS_DIR / thumb_name, kind, duration)
        title = os.path.splitext(original)[0][:120]
        media_id = db.execute(
            """INSERT INTO media(title, filename, path, kind, mime, size, duration, width, height,
               fps, video_codec, audio_codec, bitrate, has_audio, thumbnail, folder_id, category)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                title, filename, str(dest), kind, upload.content_type, size, duration,
                info["width"], info["height"], info["fps"], info["video_codec"],
                info["audio_codec"], info["bitrate"], info["has_audio"],
                thumb_name if thumb_ok else None, folder_id, (category or None),
            ),
        )
        # Pre-generate the medium-resolution preview (named after the media id)
        # so the editor and switcher display it instantly, without a first-request
        # conversion lag.
        if kind in ("image", "video"):
            probe.make_preview(dest, config.PREVIEWS_DIR / f"{media_id}-960.jpg", kind, duration)
        row = db.query_one("SELECT * FROM media WHERE id = ?", (media_id,))
        created.append(_row_to_media(row))
    return {"items": created, "count": len(created)}


@router.get("/{media_id}")
def get_media(media_id: int, user: dict = Depends(current_user)) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM media WHERE id = ?", (media_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Média introuvable")
    data = _row_to_media(row)
    used_in = db.query(
        "SELECT p.id, p.name FROM playlist_items pi JOIN playlists p ON p.id = pi.playlist_id "
        "WHERE pi.media_id = ?",
        (media_id,),
    )
    data["used_in"] = [{"id": r["id"], "name": r["name"]} for r in used_in]
    return data


class MediaUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    folder_id: int | None = None
    category: str | None = Field(default=None, max_length=60)
    duration: float | None = Field(default=None, ge=0)


class BulkDeletePayload(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


@router.post("/bulk-delete")
def bulk_delete(payload: BulkDeletePayload, user: dict = Depends(require(permissions.CAP_MEDIA))) -> dict[str, Any]:
    """Delete several media at once (files, thumbnails, cached previews, rows)."""
    deleted = 0
    for media_id in dict.fromkeys(payload.ids):  # de-duplicate, keep order
        row = db.query_one("SELECT * FROM media WHERE id = ?", (media_id,))
        if not row:
            continue
        db.execute("DELETE FROM media WHERE id = ?", (media_id,))
        try:
            Path(row["path"]).unlink(missing_ok=True)
        except OSError:
            pass
        if row["thumbnail"]:
            (config.THUMBS_DIR / row["thumbnail"]).unlink(missing_ok=True)
        _remove_previews(media_id)
        deleted += 1
    return {"ok": True, "deleted": deleted}


@router.patch("/{media_id}")
def update_media(
    media_id: int, payload: MediaUpdate, user: dict = Depends(require(permissions.CAP_MEDIA))
) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM media WHERE id = ?", (media_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Média introuvable")
    fields: list[str] = []
    params: list[Any] = []
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=422, detail="Le titre ne peut pas être vide")
        fields.append("title = ?")
        params.append(title)
    if payload.folder_id is not None:
        fields.append("folder_id = ?")
        params.append(payload.folder_id or None)
    if payload.category is not None:
        fields.append("category = ?")
        params.append(payload.category.strip() or None)
    if payload.duration is not None and row["kind"] == "image":
        fields.append("duration = ?")
        params.append(payload.duration)
    if fields:
        params.append(media_id)
        db.execute(f"UPDATE media SET {', '.join(fields)} WHERE id = ?", params)
    return _row_to_media(db.query_one("SELECT * FROM media WHERE id = ?", (media_id,)))


@router.delete("/{media_id}")
def delete_media(media_id: int, user: dict = Depends(require(permissions.CAP_MEDIA))) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM media WHERE id = ?", (media_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Média introuvable")
    db.execute("DELETE FROM media WHERE id = ?", (media_id,))
    try:
        Path(row["path"]).unlink(missing_ok=True)
    except OSError:
        pass
    if row["thumbnail"]:
        (config.THUMBS_DIR / row["thumbnail"]).unlink(missing_ok=True)
    _remove_previews(media_id)
    return {"ok": True}


def _remove_previews(media_id: int) -> None:
    """Delete every cached preview of a media ({id}-<width>.jpg).

    Previews are written lazily per requested width, so a media can leave several
    behind; without this cleanup they accumulate forever after a delete.
    """
    try:
        for cached in config.PREVIEWS_DIR.glob(f"{media_id}-*.jpg"):
            cached.unlink(missing_ok=True)
    except OSError:
        pass


@router.get("/{media_id}/thumbnail")
def thumbnail(media_id: int) -> FileResponse:
    row = db.query_one("SELECT thumbnail FROM media WHERE id = ?", (media_id,))
    if not row or not row["thumbnail"]:
        raise HTTPException(status_code=404, detail="Vignette introuvable")
    path = config.THUMBS_DIR / row["thumbnail"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="Vignette introuvable")
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/{media_id}/preview")
def preview(media_id: int, w: int = 960):
    """Medium-resolution JPEG (cached) used by the editor and the switcher.

    Generated on first request and kept under `previews/`; subsequent requests
    are served straight from disk. This keeps the displayed image sharp while
    loading far faster than the original file.
    """
    row = db.query_one("SELECT path, kind, duration FROM media WHERE id = ?", (media_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Média introuvable")
    width = max(160, min(int(w), 1920))
    name = f"{media_id}-{width}.jpg"
    dest = config.PREVIEWS_DIR / name
    if not dest.exists():
        src = Path(row["path"])
        if not src.exists():
            raise HTTPException(status_code=404, detail="Fichier introuvable")
        ok = probe.make_preview(src, dest, row["kind"], row["duration"] or 0, width)
        if not ok:
            raise HTTPException(status_code=404, detail="Aperçu indisponible")
    return FileResponse(dest, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


def _range_stream(path: Path, request: Request, content_type: str) -> StreamingResponse:
    size = path.stat().st_size
    range_header = request.headers.get("range")
    start, end = 0, size - 1
    status_code = 200
    headers = {"Accept-Ranges": "bytes", "Content-Length": str(size)}
    if range_header:
        match = re.match(r"bytes=(\d*)-(\d*)", range_header)
        if match:
            g1, g2 = match.group(1), match.group(2)
            if g1:
                start = int(g1)
            if g2:
                end = int(g2)
            end = min(end, size - 1)
            if start > end or start >= size:
                raise HTTPException(status_code=416, detail="Plage invalide")
            status_code = 206
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
            headers["Content-Length"] = str(end - start + 1)

    def iterator() -> Iterator[bytes]:
        with path.open("rb") as fh:
            fh.seek(start)
            remaining = end - start + 1
            while remaining > 0:
                chunk = fh.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(iterator(), status_code=status_code, headers=headers, media_type=content_type)


@router.get("/{media_id}/stream")
def stream(media_id: int, request: Request, user: dict = Depends(current_user)):
    row = db.query_one("SELECT path, mime, kind FROM media WHERE id = ?", (media_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Média introuvable")
    path = Path(row["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    mime = row["mime"] or {
        "video": "video/mp4",
        "audio": "audio/mpeg",
        "image": "image/jpeg",
    }.get(row["kind"], "application/octet-stream")
    return _range_stream(path, request, mime)
