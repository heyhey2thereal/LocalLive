"""System monitoring: metrics, logs, health for the dashboard."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import shlex
import subprocess

from .. import __version__, config, db, monitor, permissions, versioning
from ..deps import current_user, require

router = APIRouter(prefix="/api/system", tags=["system"])


def _normalize_repo(value: str) -> str:
    """Turn a git remote URL into the "owner/repo" form the GitHub API expects.

    Accepts "owner/repo", "https://github.com/owner/repo(.git)" and
    "git@github.com:owner/repo.git". Anything unrecognised is returned as-is.
    """
    text = (value or "").strip()
    if not text:
        return ""
    if text.startswith("git@"):
        # git@host:owner/repo.git
        text = text.split(":", 1)[-1]
    elif "://" in text:
        # Strip the scheme and host: keep the path only.
        text = text.split("://", 1)[1]
        text = text.split("/", 1)[1] if "/" in text else ""
    text = text.strip("/")
    if text.endswith(".git"):
        text = text[:-4]
    parts = [p for p in text.split("/") if p]
    if len(parts) >= 2:
        return f"{parts[-2]}/{parts[-1]}"
    return text


@router.get("/update/check")
def update_check(user: dict = Depends(current_user)) -> dict[str, Any]:
    """Compare the running version with the latest published tag.

    The update source (git repo + branch) is configured by install.sh from the
    clone it was run from; it is never asked of the operator. `update_repo`
    (setting) may override it; otherwise we fall back to the host configuration
    (LOCALLIVE_UPDATE_REPO / LOCALLIVE_UPDATE_BRANCH, set by install.sh).
    """
    import os

    repo = _normalize_repo(db.get_setting("update_repo", "") or os.environ.get("LOCALLIVE_UPDATE_REPO", ""))
    branch = (db.get_setting("update_branch", "") or "").strip()
    if not branch:
        branch = os.environ.get("LOCALLIVE_UPDATE_BRANCH", "").strip() or "main"
    latest = None
    if repo:
        import json
        import urllib.request

        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{repo}/releases/latest",
                headers={"User-Agent": "LocalLive", "Accept": "application/vnd.github+json"},
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                latest = (json.load(resp).get("tag_name") or "").lstrip("v") or None
        except Exception:
            latest = None
    # Only offer an update when the published version is genuinely newer, so the
    # UI never nags when everything is already up to date.
    available = versioning.is_newer(latest, __version__)
    return {
        "current": __version__,
        "latest": latest,
        "update_available": available,
        "repo": repo,
        "branch": branch,
    }


@router.post("/update")
def update(user: dict = Depends(require(permissions.CAP_SETTINGS))) -> dict[str, Any]:
    """Trigger the host update, with no manual configuration.

    The self-updater (`/usr/local/sbin/locallive-update`) is installed by
    install.sh, and the service user may run it through a restricted sudoers
    rule. We therefore fall back to that default command when none is stored, so
    the operator only ever has to click the button.
    """
    command = (db.get_setting("update_command", "") or "").strip()
    if not command:
        # Prefer the standard helper if it is present on this host.
        from pathlib import Path

        if Path("/usr/local/sbin/locallive-update").exists():
            command = "sudo /usr/local/sbin/locallive-update"
    if not command:
        return {
            "ok": False,
            "manual": True,
            "hint": "Programme de mise à jour introuvable. Relancez install.sh sur le serveur.",
        }
    try:
        proc = subprocess.run(
            shlex.split(command),
            capture_output=True,
            text=True,
            timeout=600,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Délai dépassé pendant la mise à jour"}
    if proc.returncode == 0:
        # Remember the version that was just applied so the UI can show a short
        # "updated" notice exactly once, the next time someone opens the app.
        db.set_setting("pending_update_notice", __version__)
        return {"ok": True, "output": (proc.stdout or "")[-2000:]}
    return {"ok": False, "error": (proc.stderr or proc.stdout or "Échec de la mise à jour")[-2000:]}


@router.get("/update-notice")
def update_notice(user: dict = Depends(current_user)) -> dict[str, Any]:
    """Return (and clear) a one-shot 'updated to X' notice for the UI."""
    pending = (db.get_setting("pending_update_notice", "") or "").strip()
    if not pending:
        return {"show": False}
    db.set_setting("pending_update_notice", "")
    return {"show": True, "version": pending}


@router.get("/version")
def version_info(user: dict = Depends(current_user)) -> dict[str, Any]:
    # The changelog sits next to the app (APP_DIR/CHANGELOG.md); FRONTEND_DIST is
    # APP_DIR/frontend/dist, so its grandparent is the app root.
    candidates = [
        config.FRONTEND_DIST.parent.parent / "CHANGELOG.md",
        config.DATA_DIR.parent / "CHANGELOG.md",
    ]
    changelog = ""
    for candidate in candidates:
        if candidate.exists():
            changelog = candidate.read_text(encoding="utf-8", errors="replace")
            break
    return {"version": __version__, "changelog": changelog}


@router.get("/metrics")
def metrics(user: dict = Depends(current_user)) -> dict[str, Any]:
    snap = monitor.snapshot()
    snap["storage"] = {
        "media": monitor.media_usage()["media"],
        "db": db.db_size(),
    }
    return snap


@router.get("/stats")
def stats(user: dict = Depends(current_user)) -> dict[str, Any]:
    """Content counters and library totals for the dashboard.

    Cheap aggregate queries only (COUNT/SUM), so this can be polled alongside
    the rest of the dashboard without stressing the host.
    """
    def _count(table: str) -> int:
        row = db.query_one(f"SELECT COUNT(*) AS n FROM {table}")
        return int(row["n"]) if row else 0

    media = db.query_one(
        "SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes, COALESCE(SUM(duration), 0) AS secs FROM media"
    )
    by_kind = {
        r["kind"]: r["n"]
        for r in db.query("SELECT kind, COUNT(*) AS n FROM media GROUP BY kind")
    }
    playlist_total = db.query_one("SELECT COALESCE(SUM(duration), 0) AS secs FROM playlist_items")
    return {
        "media": {
            "count": int(media["n"]) if media else 0,
            "bytes": int(media["bytes"]) if media else 0,
            "seconds": round(float(media["secs"] or 0), 1),
            "by_kind": by_kind,
        },
        "scenes": _count("scenes"),
        "playlists": _count("playlists"),
        "playlist_items": _count("playlist_items"),
        "streams": _count("streams"),
        "enabled_streams": int(
            (db.query_one("SELECT COUNT(*) AS n FROM streams WHERE enabled = 1") or {"n": 0})["n"]
        ),
        "schedules": _count("schedules"),
        "folders": _count("folders"),
        "users": _count("users"),
        "playlist_seconds": round(float(playlist_total["secs"] or 0), 1) if playlist_total else 0.0,
    }


@router.get("/logs")
def logs(lines: int = 100, user: dict = Depends(require(permissions.CAP_SETTINGS))) -> dict[str, Any]:
    lines = max(1, min(lines, 500))
    path = config.LOGS_DIR / "locallive.log"
    if not path.exists():
        return {"lines": []}
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            content = fh.readlines()
        return {"lines": [ln.rstrip("\n") for ln in content[-lines:]]}
    except OSError:
        return {"lines": []}


# ---------------------------------------------------------------------------
# Configuration export / import
# ---------------------------------------------------------------------------
# Content that is safe to move between installs: scenes, playlists (with their
# items), output streams, schedules, folders and the tunable settings. Media
# files are NOT included (they can be gigabytes); the import maps items by
# media *title* where possible and drops the rest, so a playlist still arrives
# even on a fresh install.
_CONFIG_TABLES = {
    "folders": ("id", "name"),
    "scenes": ("id", "name", "width", "height", "background", "layers"),
    "playlists": ("id", "name", "description", "loop"),
    "streams": (
        "id", "name", "description", "tags", "privacy", "category", "encoding",
        "kind", "rtmp_url", "stream_key", "output_file", "width", "height", "fps",
        "bitrate", "audio_bitrate", "enabled",
    ),
    "schedules": ("id", "name", "playlist_id", "days", "start_time", "end_time", "enabled"),
}
# Settings worth carrying over (never secrets, never the update source).
_CONFIG_SETTINGS = (
    "channel_name", "timezone", "language", "image_duration",
    "stream_width", "stream_height", "stream_fps", "stream_bitrate",
    "stream_audio_bitrate", "stream_preset", "output_kind", "fallback_playlist_id",
)
_CONFIG_FORMAT = 1


@router.get("/config/export")
def export_config(user: dict = Depends(require(permissions.CAP_SETTINGS))) -> dict[str, Any]:
    """Return a portable JSON snapshot of the configuration."""
    data: dict[str, Any] = {"format": _CONFIG_FORMAT, "version": __version__}
    for table, columns in _CONFIG_TABLES.items():
        rows = db.query(f"SELECT {', '.join(columns)} FROM {table} ORDER BY id")
        data[table] = [dict(r) for r in rows]
    # Playlist items reference playlists by id; export them too so playlists
    # survive a round-trip with their ordering, transitions and music.
    data["playlist_items"] = [
        dict(r)
        for r in db.query(
            "SELECT id, playlist_id, media_id, scene_id, position, duration, transition, "
            "transition_duration, background_audio_id, background_volume FROM playlist_items ORDER BY playlist_id, position"
        )
    ]
    data["settings"] = {k: db.get_setting(k) for k in _CONFIG_SETTINGS if db.get_setting(k) is not None}
    return data


class ImportPayload(BaseModel):
    data: dict[str, Any]
    replace: bool = False


@router.post("/config/import")
def import_config(payload: ImportPayload, user: dict = Depends(require(permissions.CAP_SETTINGS))) -> dict[str, Any]:
    """Import a snapshot produced by /config/export.

    `replace` clears the existing content tables first. Without it the import is
    additive: scenes/folders/playlists/streams/schedules are appended with fresh
    ids, so an existing install is never silently overwritten.
    """
    data = payload.data or {}
    if not isinstance(data, dict) or "format" not in data:
        raise HTTPException(status_code=422, detail="Fichier de configuration invalide")

    counts: dict[str, int] = {}
    with db.connection() as conn:
        if payload.replace:
            for table in ("playlist_items", "schedules", "streams", "playlists", "scenes", "folders"):
                conn.execute(f"DELETE FROM {table}")

        # --- folders ---
        folder_map: dict[int, int] = {}
        for row in data.get("folders", []) or []:
            new_id = conn.execute("INSERT INTO folders(name) VALUES(?)", (row.get("name") or "Dossier",)).lastrowid
            folder_map[int(row.get("id", 0))] = new_id
        counts["folders"] = len(folder_map)

        # --- scenes ---
        scene_map: dict[int, int] = {}
        for row in data.get("scenes", []) or []:
            new_id = conn.execute(
                "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
                (
                    row.get("name") or "Scène",
                    int(row.get("width") or 1920),
                    int(row.get("height") or 1080),
                    row.get("background") or "#000000",
                    row.get("layers") or "[]",
                ),
            ).lastrowid
            scene_map[int(row.get("id", 0))] = new_id
        counts["scenes"] = len(scene_map)

        # --- playlists (+ items) ---
        playlist_map: dict[int, int] = {}
        for row in data.get("playlists", []) or []:
            new_id = conn.execute(
                "INSERT INTO playlists(name, description, loop) VALUES(?,?,?)",
                (row.get("name") or "Playlist", row.get("description"), int(row.get("loop", 1))),
            ).lastrowid
            playlist_map[int(row.get("id", 0))] = new_id
        counts["playlists"] = len(playlist_map)
        items = 0
        for row in data.get("playlist_items", []) or []:
            pid = playlist_map.get(int(row.get("playlist_id", 0)))
            if not pid:
                continue
            sid = scene_map.get(int(row.get("scene_id") or 0))
            # Media are not exported; keep only the scene link and the overrides.
            conn.execute(
                """INSERT INTO playlist_items(playlist_id, media_id, scene_id, position, duration,
                                              transition, transition_duration, background_audio_id, background_volume)
                   VALUES(?,?,?,?,?,?,?,?,?)""",
                (
                    pid, None, sid, int(row.get("position") or 0), float(row.get("duration") or 0),
                    row.get("transition") or "cut", float(row.get("transition_duration") or 0),
                    None, float(row.get("background_volume") or 0.15),
                ),
            )
            items += 1
        counts["playlist_items"] = items

        # --- streams ---
        streams = 0
        for row in data.get("streams", []) or []:
            conn.execute(
                """INSERT INTO streams(name, description, tags, privacy, category, encoding, kind,
                                       rtmp_url, stream_key, output_file, width, height, fps, bitrate,
                                       audio_bitrate, enabled)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    row.get("name") or "Flux", row.get("description"), row.get("tags") or "[]",
                    row.get("privacy") or "public", row.get("category"), row.get("encoding") or "veryfast",
                    row.get("kind") or "rtmp", row.get("rtmp_url"), row.get("stream_key"),
                    row.get("output_file"), int(row.get("width") or 1280), int(row.get("height") or 720),
                    int(row.get("fps") or 25), int(row.get("bitrate") or 2500),
                    int(row.get("audio_bitrate") or 128), int(row.get("enabled", 1)),
                ),
            )
            streams += 1
        counts["streams"] = streams

        # --- schedules (remap the playlist pointer) ---
        schedules = 0
        for row in data.get("schedules", []) or []:
            pid = playlist_map.get(int(row.get("playlist_id") or 0))
            conn.execute(
                "INSERT INTO schedules(name, playlist_id, days, start_time, end_time, enabled) VALUES(?,?,?,?,?,?)",
                (
                    row.get("name") or "Programme", pid, row.get("days") or "[]",
                    row.get("start_time") or "00:00", row.get("end_time") or "00:00",
                    int(row.get("enabled", 1)),
                ),
            )
            schedules += 1
        counts["schedules"] = schedules

        # --- settings ---
        settings = 0
        for key, value in (data.get("settings") or {}).items():
            if key in _CONFIG_SETTINGS and value is not None:
                conn.execute(
                    "INSERT INTO settings(key, value) VALUES(?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, str(value)),
                )
                settings += 1
        counts["settings"] = settings

    return {"ok": True, "counts": counts, "replaced": payload.replace}
