"""Playlist, scene and schedule tests."""
from __future__ import annotations

import subprocess
from datetime import datetime
from pathlib import Path

import pytest

from app import config, db
from app.routers.schedules import active_playlist_id


def _make_image(path: Path):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", "color=c=green:size=160x120:duration=1", "-frames:v", "1", str(path)],
        check=True, timeout=60,
    )


def _make_video(path: Path, seconds=1):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"testsrc=size=160x120:rate=25:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=duration={seconds}",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-shortest", str(path)],
        check=True, timeout=120,
    )


def _upload(client, path: Path):
    with path.open("rb") as fh:
        return client.post("/api/media/upload", files={"files": (path.name, fh, "application/octet-stream")}).json()["items"][0]


def test_playlist_crud_and_ordering(authed, tmp_path):
    v1, v2 = tmp_path / "a.mp4", tmp_path / "b.mp4"
    _make_video(v1)
    _make_video(v2)
    m1 = _upload(authed, v1)
    m2 = _upload(authed, v2)

    pl = authed.post("/api/playlists", json={"name": "Boucle", "loop": True}).json()
    pid = pl["id"]
    r = authed.post(f"/api/playlists/{pid}/items", json={"media_id": m1["id"]}).json()
    r = authed.post(f"/api/playlists/{pid}/items", json={"media_id": m2["id"]}).json()
    assert r["item_count"] == 2
    ids = [i["id"] for i in r["items"]]
    assert ids == sorted(ids)

    # Reorder -> reversed
    r = authed.post(f"/api/playlists/{pid}/reorder", json={"item_ids": list(reversed(ids))}).json()
    assert [i["id"] for i in r["items"]] == list(reversed(ids))
    assert [i["position"] for i in r["items"]] == [0, 1]

    # Remove one item
    r = authed.delete(f"/api/playlists/{pid}/items/{ids[0]}").json()
    assert r["item_count"] == 1


def test_image_duration_override(authed, tmp_path):
    img = tmp_path / "i.png"
    _make_image(img)
    mi = _upload(authed, img)
    pid = authed.post("/api/playlists", json={"name": "Images"}).json()["id"]
    r = authed.post(f"/api/playlists/{pid}/items", json={"media_id": mi["id"], "duration": 12}).json()
    assert r["items"][0]["effective_duration"] == 12
    assert r["total_duration"] == 12


def test_reorder_rejects_foreign_ids(authed, tmp_path):
    img = tmp_path / "i.png"
    _make_image(img)
    mi = _upload(authed, img)
    pid = authed.post("/api/playlists", json={"name": "X"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"media_id": mi["id"]})
    r = authed.post(f"/api/playlists/{pid}/reorder", json={"item_ids": [99999]})
    assert r.status_code == 422


def test_scene_crud_with_layers(authed):
    scene = {
        "name": "Habillage",
        "width": 1280,
        "height": 720,
        "background": "#101020",
        "layers": [
            {"type": "text", "text": "Bienvenue", "x": 100, "y": 80, "z": 1, "font_size": 60},
            {"type": "logo", "media_id": 1, "x": 10, "y": 10, "z": 2, "opacity": 0.8},
        ],
    }
    r = authed.post("/api/scenes", json=scene)
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert len(r.json()["layers"]) == 2

    scene["name"] = "Habillage 2"
    r = authed.put(f"/api/scenes/{sid}", json=scene)
    assert r.json()["name"] == "Habillage 2"

    assert authed.get("/api/scenes").json()["items"]
    assert authed.delete(f"/api/scenes/{sid}").status_code == 200


def test_scene_rejects_bad_layer_type(authed):
    r = authed.post("/api/scenes", json={"name": "S", "layers": [{"type": "hologram"}]})
    assert r.status_code == 422


def test_schedule_creation_and_active_resolution(authed):
    pid = authed.post("/api/playlists", json={"name": "Nuit"}).json()["id"]
    r = authed.post("/api/schedules", json={
        "name": "Nuit", "playlist_id": pid, "days": [0, 1, 2, 3, 4, 5, 6],
        "start_time": "00:00", "end_time": "23:59",
    })
    assert r.status_code == 201, r.text
    assert active_playlist_id() == pid


def test_schedule_overnight_window(authed):
    pid = authed.post("/api/playlists", json={"name": "Overnight"}).json()["id"]
    authed.post("/api/schedules", json={
        "name": "Nuit", "playlist_id": pid, "days": [0, 1, 2, 3, 4, 5, 6],
        "start_time": "23:00", "end_time": "06:00",
    })
    # 02:00 local -> inside the overnight window
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Europe/Paris")
    now = datetime(2026, 1, 5, 2, 0, tzinfo=tz)  # Monday 02:00
    assert active_playlist_id(now) == pid


def test_schedule_validation_rejects_bad_time(authed):
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    r = authed.post("/api/schedules", json={
        "name": "Bad", "playlist_id": pid, "days": [0], "start_time": "25:00", "end_time": "26:00",
    })
    assert r.status_code == 422


def test_fallback_playlist_used_when_no_schedule(authed):
    pid = authed.post("/api/playlists", json={"name": "Fallback"}).json()["id"]
    authed.put("/api/broadcast/settings", json={"fallback_playlist_id": pid})
    assert active_playlist_id() == pid
