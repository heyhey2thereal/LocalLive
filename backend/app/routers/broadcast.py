"""Broadcast control: start/stop, live status, settings, fallback, RTMP test."""
from __future__ import annotations

import json
import subprocess
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import config, db, monitor, probe
from ..deps import current_user, require
from .. import permissions
from ..engine import get_engine
from ..routers.schedules import active_playlist_id
from ..security import mask_secret

router = APIRouter(prefix="/api/broadcast", tags=["broadcast"])

SECRET_SETTINGS = {"stream_key"}
NUMERIC_SETTINGS = {
    "stream_width", "stream_height", "stream_fps", "stream_bitrate", "stream_audio_bitrate",
}
ALLOWED_SETTINGS = {
    "stream_rtmp_url", "stream_key", "stream_width", "stream_height", "stream_fps",
    "stream_bitrate", "stream_audio_bitrate", "stream_preset", "output_kind", "output_file",
    "fallback_playlist_id", "image_duration", "channel_name", "timezone", "language",
    "update_repo", "update_command", "update_branch",
}


class StartPayload(BaseModel):
    playlist_id: int | None = None
    # Which output(s) to feed: "primary" (main output only), "all" (fan-out to
    # every enabled stream), or a stream id. None keeps the default fan-out.
    output_id: int | str | None = None


class SettingsPayload(BaseModel):
    stream_rtmp_url: str | None = None
    stream_key: str | None = None
    stream_width: int | None = Field(default=None, ge=16, le=7680)
    stream_height: int | None = Field(default=None, ge=16, le=4320)
    stream_fps: int | None = Field(default=None, ge=1, le=120)
    stream_bitrate: int | None = Field(default=None, ge=100, le=50000)
    stream_audio_bitrate: int | None = Field(default=None, ge=32, le=512)
    stream_preset: str | None = None
    output_kind: str | None = None
    output_file: str | None = None
    fallback_playlist_id: int | None = None
    image_duration: float | None = Field(default=None, ge=0.5, le=3600)
    channel_name: str | None = None
    timezone: str | None = None
    language: str | None = None
    update_repo: str | None = None
    update_command: str | None = None
    update_branch: str | None = None


def _preset_allowed() -> set[str]:
    return {"ultrafast", "superfast", "veryfast", "faster", "fast", "medium"}


@router.get("/status")
def status(user: dict = Depends(current_user)) -> dict[str, Any]:
    engine = get_engine()
    state = engine.status()
    fallback = db.get_setting("fallback_playlist_id")
    fallback_name = None
    if fallback:
        row = db.query_one("SELECT name FROM playlists WHERE id = ?", (int(fallback),))
        fallback_name = row["name"] if row else None
    return {
        "engine": state,
        "fallback_playlist_id": int(fallback) if fallback else None,
        "fallback_playlist_name": fallback_name,
        "active_scheduled_playlist_id": active_playlist_id(),
        "system": monitor.snapshot(),
        "storage": monitor.media_usage(),
    }


@router.post("/start")
def start(payload: StartPayload, user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    engine = get_engine()
    playlist_id = payload.playlist_id or active_playlist_id()
    if not playlist_id:
        fallback = db.get_setting("fallback_playlist_id")
        playlist_id = int(fallback) if fallback else None
    if not playlist_id:
        raise HTTPException(status_code=422, detail="Aucune playlist active ou de secours configurée")
    result = engine.start(int(playlist_id), output_id=payload.output_id)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error", "Échec du démarrage"))
    return result


@router.post("/stop")
def stop(user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    return get_engine().stop()


@router.post("/pause")
def pause(user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Freeze the broadcast (used by the operator's sound console)."""
    result = get_engine().pause()
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error", "Pause impossible"))
    return result


@router.post("/resume")
def resume(user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Resume a broadcast frozen by /pause."""
    result = get_engine().resume()
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error", "Reprise impossible"))
    return result


class SeekPayload(BaseModel):
    position: float = Field(ge=0)


@router.post("/seek")
def seek(payload: SeekPayload, user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Jump the broadcast to a position in the current cycle (sound console)."""
    result = get_engine().seek(payload.position)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error", "Déplacement impossible"))
    return result


@router.post("/switch/{playlist_id}")
def switch(playlist_id: int, user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM playlists WHERE id = ?", (playlist_id,)):
        raise HTTPException(status_code=404, detail="Playlist introuvable")
    result = get_engine().switch_playlist(playlist_id)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error", "Échec du changement"))
    return result


@router.post("/next")
def next_item(user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Skip to the next playlist item immediately."""
    result = get_engine().skip(1)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error", "Échec du passage"))
    return result


@router.post("/previous")
def previous_item(user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Go back to the previous playlist item immediately."""
    result = get_engine().skip(-1)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error", "Échec du passage"))
    return result


@router.get("/settings")
def get_settings(user: dict = Depends(current_user)) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for key in ALLOWED_SETTINGS:
        value = db.get_setting(key)
        if key in SECRET_SETTINGS:
            data["stream_key_masked"] = mask_secret(value)
            data["has_stream_key"] = bool(value)
        else:
            data[key] = value
    return data


@router.put("/settings")
def update_settings(payload: SettingsPayload, user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    updates = payload.model_dump(exclude_none=True)
    if "stream_preset" in updates and updates["stream_preset"] not in _preset_allowed():
        raise HTTPException(status_code=422, detail="Préréglage FFmpeg invalide")
    if "output_kind" in updates and updates["output_kind"] not in ("rtmp", "file"):
        raise HTTPException(status_code=422, detail="Type de sortie invalide")
    if "stream_key" in updates:
        # Empty string clears the key; never store the masked placeholder.
        key = updates["stream_key"].strip()
        if key and "•" in key:
            updates.pop("stream_key")
        else:
            updates["stream_key"] = key
    if "stream_rtmp_url" in updates and updates["stream_rtmp_url"]:
        url = updates["stream_rtmp_url"].strip()
        if not (url.startswith("rtmp://") or url.startswith("rtmps://")):
            raise HTTPException(status_code=422, detail="L'URL RTMP doit commencer par rtmp:// ou rtmps://")
        updates["stream_rtmp_url"] = url.rstrip("/")
    for key, value in updates.items():
        if key not in ALLOWED_SETTINGS:
            continue
        # A zero fallback playlist means "none": clear the setting instead of
        # storing 0, which would look like a (missing) playlist id 0.
        if key == "fallback_playlist_id" and int(value or 0) == 0:
            db.execute("DELETE FROM settings WHERE key = ?", (key,))
            continue
        db.set_setting(key, str(value))
    return get_settings(user)


class RtmpTestPayload(BaseModel):
    url: str | None = None
    key: str | None = None


def probe_rtmp(url: str, key: str) -> dict[str, Any]:
    """Attempt a 2-second handshake with an RTMP endpoint. Shared by the
    broadcast test and the per-stream test endpoints."""
    url = (url or "").rstrip("/")
    if not url:
        return {"ok": False, "error": "URL RTMP manquante"}
    destination = f"{url}/{key}" if key else url
    cmd = [
        config.FFMPEG_BIN, "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-shortest", "-f", "flv", destination,
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=45, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Délai dépassé lors de la connexion RTMP"}
    if proc.returncode == 0:
        return {"ok": True, "message": "Connexion RTMP réussie"}
    return {"ok": False, "error": (proc.stderr or "Échec de connexion RTMP")[-400:]}


@router.post("/test-rtmp")
def test_rtmp(payload: RtmpTestPayload, user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Attempt a 2-second handshake with the configured RTMP endpoint."""
    url = payload.url if payload.url is not None else (db.get_setting("stream_rtmp_url", "") or "")
    key = payload.key if payload.key is not None else (db.get_setting("stream_key", "") or "")
    return probe_rtmp(url, key)


@router.get("/live")
def live(user: dict = Depends(current_user)) -> dict[str, Any]:
    """Lightweight payload for frequent polling: engine state + system metrics.

    Deliberately omits storage usage and the fallback playlist name (which cost
    extra queries) so the dashboard can refresh every couple of seconds without
    loading the server. Use /status when the full picture is needed.
    """
    return {"engine": get_engine().status(), "system": monitor.snapshot()}


@router.get("/outputs")
def outputs(user: dict = Depends(current_user)) -> dict[str, Any]:
    """List the fan-out destinations: the primary output plus every enabled
    stream. The primary is read from the live engine when running, otherwise
    from the broadcast settings, so the list is meaningful before start."""
    engine = get_engine()
    state = engine.status()
    output = state.get("output") or {}
    kind = output.get("kind") or db.get_setting("output_kind", "rtmp") or "rtmp"
    if output:
        destination = output.get("url") or output.get("file_path")
        width, height = output.get("width"), output.get("height")
    elif kind == "rtmp":
        url = (db.get_setting("stream_rtmp_url", "") or "").rstrip("/")
        key = db.get_setting("stream_key", "") or ""
        destination = f"{url}/{key}" if key else url
        width, height = db.get_setting("stream_width"), db.get_setting("stream_height")
    else:
        destination = db.get_setting("output_file", "")
        width, height = db.get_setting("stream_width"), db.get_setting("stream_height")
    items: list[dict[str, Any]] = [{
        "id": "primary",
        "name": db.get_setting("channel_name", "LocalLive") or "LocalLive",
        "kind": kind,
        "destination": destination,
        "width": width,
        "height": height,
        "primary": True,
    }]
    for row in db.query("SELECT * FROM streams WHERE enabled = 1 ORDER BY name"):
        items.append({
            "id": row["id"],
            "name": row["name"],
            "kind": row["kind"],
            "destination": row["rtmp_url"] if row["kind"] == "rtmp" else row["output_file"],
            "width": row["width"],
            "height": row["height"],
            "primary": False,
        })
    return {"items": items, "count": len(items)}


@router.get("/preview")
def preview(playlist_id: int | None = None, user: dict = Depends(current_user)) -> dict[str, Any]:
    """Preview/Program data for the switcher page.

    `program` is what is on air right now; `preview` is the playlist selected
    for the next take (its resolved items, without touching the broadcast).
    """
    engine = get_engine()
    program = engine.status()
    preview_items: list[dict[str, Any]] = []
    preview_name = ""
    preview_loop = True
    if playlist_id is None:
        playlist_id = program.get("playlist_id")
    if playlist_id:
        row = db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
        if row:
            preview_name = row["name"]
            preview_loop = bool(row["loop"])
            preview_items = engine.resolve_preview(int(playlist_id))
    return {
        "program": program,
        "preview": {
            "playlist_id": playlist_id,
            "playlist_name": preview_name,
            "loop": preview_loop,
            "items": preview_items,
            "duration": round(sum(i.get("duration") or 0 for i in preview_items), 2),
        },
        "outputs": outputs(user)["items"],
    }


class TakePayload(BaseModel):
    playlist_id: int


class CountdownPayload(BaseModel):
    # Playlist item that holds the countdown (preview or program).
    item_id: int
    # How the control acts: "add" adds seconds to the countdown's starting value
    # (persisted on the scene, so the on-air countdown is longer too), "restart"
    # starts the countdown over by restarting the current item, "start" records a
    # wall-clock start (so a background countdown keeps running), "background"
    # toggles the "continue in background" flag, "pause"/"resume" freeze and
    # restart the timer.
    action: str = "add"
    seconds: int = Field(default=0, ge=0, le=86400)
    enabled: bool = False


def _countdown_elapsed(layer: dict[str, Any]) -> int:
    """Seconds the countdown has already run (accumulated + current run)."""
    base = int(layer.get("countdown_elapsed") or 0)
    if layer.get("countdown_paused"):
        return base
    start = layer.get("countdown_start")
    if start:
        try:
            return base + max(0, int(time.time() - float(start)))
        except (TypeError, ValueError):
            return base
    return base


def _find_countdown(item_id: int) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Resolve a playlist item and its scene's countdown layer, if any."""
    item = db.query_one("SELECT scene_id FROM playlist_items WHERE id = ?", (item_id,))
    if not item or not item["scene_id"]:
        return None, None
    scene = db.query_one("SELECT id, layers FROM scenes WHERE id = ?", (item["scene_id"],))
    if not scene:
        return None, None
    try:
        layers = json.loads(scene["layers"] or "[]")
    except (json.JSONDecodeError, TypeError):
        layers = []
    for idx, layer in enumerate(layers):
        if isinstance(layer, dict) and layer.get("type") == "countdown":
            return {"id": scene["id"], "layers": layers}, {"index": idx, "layer": layer}
    return {"id": scene["id"], "layers": layers}, None


@router.post("/countdown")
def countdown(payload: CountdownPayload, user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Control the countdown of the item in the preview or on air.

    `add` grows the countdown's starting value on the scene (so the engine draws
    a longer timer next time the scene is built) and `restart` restarts the item
    currently on air, so the countdown begins again.
    """
    scene, found = _find_countdown(payload.item_id)
    if scene is None:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    if found is None:
        raise HTTPException(status_code=404, detail="Aucun compte à rebours sur cet élément")

    if payload.action == "start":
        # (Re)start the countdown: clear any accumulated time and record the
        # wall-clock start on the scene so a "continue in background" countdown
        # keeps running even off air; restart the item when it is on air so the
        # timer visibly resets.
        layers = scene["layers"]
        layer = layers[found["index"]]
        layer["countdown_elapsed"] = 0
        layer["countdown_paused"] = False
        layer["countdown_start"] = time.time()
        db.execute(
            "UPDATE scenes SET layers=?, updated_at=datetime('now') WHERE id=?",
            (json.dumps(layers), scene["id"]),
        )
        engine = get_engine()
        st = engine.status()
        restarted = False
        if st.get("running") and (st.get("current") or {}).get("id") == payload.item_id:
            engine.restart_current()
            restarted = True
        return {
            "ok": True,
            "started": True,
            "restarted": restarted,
            "seconds": int(layer.get("countdown_seconds") or 60),
        }

    if payload.action == "pause":
        # Freeze the countdown: accumulate the elapsed time so it resumes from
        # where it stopped (and stops advancing on air and in the background).
        layers = scene["layers"]
        layer = layers[found["index"]]
        layer["countdown_elapsed"] = _countdown_elapsed(layer)
        layer["countdown_paused"] = True
        db.execute(
            "UPDATE scenes SET layers=?, updated_at=datetime('now') WHERE id=?",
            (json.dumps(layers), scene["id"]),
        )
        engine = get_engine()
        st = engine.status()
        if st.get("running") and (st.get("current") or {}).get("id") == payload.item_id:
            engine.restart_current()
        return {"ok": True, "paused": True, "elapsed": int(layer["countdown_elapsed"])}

    if payload.action == "resume":
        # Resume a frozen countdown from where it stopped.
        layers = scene["layers"]
        layer = layers[found["index"]]
        layer["countdown_paused"] = False
        layer["countdown_start"] = time.time()
        db.execute(
            "UPDATE scenes SET layers=?, updated_at=datetime('now') WHERE id=?",
            (json.dumps(layers), scene["id"]),
        )
        engine = get_engine()
        st = engine.status()
        if st.get("running") and (st.get("current") or {}).get("id") == payload.item_id:
            engine.restart_current()
        return {"ok": True, "paused": False}

    if payload.action == "restart":
        engine = get_engine()
        if not engine.status().get("running"):
            # Not on air: nothing to restart, but the preview timer is already
            # showing the starting value.
            return {"ok": True, "restarted": False, "seconds": int(found["layer"].get("countdown_seconds") or 60)}
        result = engine.restart_current()
        if not result.get("ok"):
            raise HTTPException(status_code=409, detail=result.get("error", "Redémarrage impossible"))
        return {
            "ok": True,
            "restarted": True,
            "seconds": int(found["layer"].get("countdown_seconds") or 60),
        }

    if payload.action == "background":
        # Toggle "continue in background". Turning it on records the start time
        # now (so it begins counting immediately); turning it off clears it.
        layers = scene["layers"]
        layer = layers[found["index"]]
        layer["countdown_background"] = bool(payload.enabled)
        if payload.enabled and not layer.get("countdown_start"):
            layer["countdown_start"] = time.time()
        if not payload.enabled:
            layer["countdown_start"] = None
        db.execute(
            "UPDATE scenes SET layers=?, updated_at=datetime('now') WHERE id=?",
            (json.dumps(layers), scene["id"]),
        )
        engine = get_engine()
        st = engine.status()
        if st.get("running") and (st.get("current") or {}).get("id") == payload.item_id:
            engine.restart_current()
        return {"ok": True, "background": bool(payload.enabled)}

    if payload.action != "add":
        raise HTTPException(status_code=422, detail="Action inconnue")

    layers = scene["layers"]
    layer = layers[found["index"]]
    new_seconds = int(layer.get("countdown_seconds") or 60) + payload.seconds
    new_seconds = max(0, min(new_seconds, 86400))
    layer["countdown_seconds"] = new_seconds
    db.execute("UPDATE scenes SET layers=?, updated_at=datetime('now') WHERE id=?", (json.dumps(layers), scene["id"]))
    # When the item is the one on air, restart it so the longer countdown takes
    # effect immediately instead of at the next cycle.
    engine = get_engine()
    st = engine.status()
    applied = False
    if st.get("running") and (st.get("current") or {}).get("id") == payload.item_id:
        engine.restart_current()
        applied = True
    return {"ok": True, "seconds": new_seconds, "applied": applied}


@router.post("/take")
def take(payload: TakePayload, user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Take a playlist to air (preview -> program).

    This is a switch only: it **never starts the broadcast**. When the live is
    already running the playlist is swapped on air; when it is stopped the
    programme is still switched (the program monitor shows the chosen playlist)
    but nothing is streamed, so the operator can line up the programme before
    pressing "Démarrer le direct".
    """
    if not db.query_one("SELECT id FROM playlists WHERE id = ?", (payload.playlist_id,)):
        raise HTTPException(status_code=404, detail="Playlist introuvable")
    engine = get_engine()
    if engine.status().get("running"):
        result = engine.switch_playlist(payload.playlist_id)
        if not result.get("ok"):
            raise HTTPException(status_code=409, detail=result.get("error", "Échec de la prise d'antenne"))
        return {"ok": True, "switched": True, "live": True, **result}
    result = engine.set_program(payload.playlist_id)
    if not result.get("ok"):
        raise HTTPException(status_code=409, detail=result.get("error", "Échec de la prise d'antenne"))
    return {"ok": True, "switched": True, "live": False}


@router.post("/recover")
def recover(user: dict = Depends(require(permissions.CAP_BROADCAST))) -> dict[str, Any]:
    """Force a clean restart of the broadcast."""
    engine = get_engine()
    state = engine.status()
    if not state["running"]:
        raise HTTPException(status_code=409, detail="La diffusion n'est pas active")
    playlist_id = state["playlist_id"]
    engine.stop()
    result = engine.start(int(playlist_id))
    return result


@router.get("/ffmpeg")
def ffmpeg_info(user: dict = Depends(current_user)) -> dict[str, Any]:
    version = probe.ffmpeg_version()
    return {"available": bool(version), "version": version}
