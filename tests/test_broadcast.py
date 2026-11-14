"""Broadcast control and system monitoring tests."""
from __future__ import annotations

import subprocess
import time
from pathlib import Path

from app import config
from app.engine import get_engine


def _make_video(path: Path, seconds=1):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"testsrc=size=160x120:rate=25:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=duration={seconds}",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-shortest", str(path)],
        check=True, timeout=120,
    )


def _setup_playlist(authed, tmp_path):
    v = tmp_path / "v.mp4"
    _make_video(v)
    with v.open("rb") as fh:
        item = authed.post("/api/media/upload", files={"files": (v.name, fh, "video/mp4")}).json()["items"][0]
    pid = authed.post("/api/playlists", json={"name": "Live"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"media_id": item["id"]})
    return pid


def test_broadcast_settings_masking(authed):
    r = authed.put("/api/broadcast/settings", json={
        "stream_rtmp_url": "rtmp://a.rtmp.youtube.com/live2",
        "stream_key": "abcd-1234-efgh-5678",
        "stream_bitrate": 3000,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["has_stream_key"] is True
    assert "stream_key" not in data  # never returned raw
    assert data["stream_key_masked"].endswith("5678")
    assert data["stream_bitrate"] == "3000"


def test_broadcast_settings_validation(authed):
    assert authed.put("/api/broadcast/settings", json={"stream_rtmp_url": "http://nope"}).status_code == 422
    assert authed.put("/api/broadcast/settings", json={"stream_preset": "ludicrous"}).status_code == 422
    assert authed.put("/api/broadcast/settings", json={"stream_fps": 999}).status_code == 422


def test_stream_key_never_exposed_in_status(authed):
    authed.put("/api/broadcast/settings", json={"stream_key": "super-secret-key-xyz"})
    body = authed.get("/api/broadcast/status").text
    assert "super-secret-key-xyz" not in body
    assert authed.get("/api/broadcast/settings").text.count("super-secret") == 0


def test_broadcast_start_stop_cycle(authed, tmp_path):
    pid = _setup_playlist(authed, tmp_path)
    authed.put("/api/broadcast/settings", json={
        "output_kind": "file",
        "output_file": str(tmp_path / "live.ts"),
        "stream_width": 160, "stream_height": 120,
    })
    r = authed.post("/api/broadcast/start", json={"playlist_id": pid})
    assert r.status_code == 200, r.text
    time.sleep(1.5)
    status = authed.get("/api/broadcast/status").json()
    assert status["engine"]["running"] is True
    assert status["engine"]["playlist_name"] == "Live"
    assert status["system"]["cpu"] >= 0

    assert authed.post("/api/broadcast/stop").status_code == 200
    assert authed.get("/api/broadcast/status").json()["engine"]["running"] is False


def test_broadcast_start_without_playlist_fails(authed):
    r = authed.post("/api/broadcast/start", json={})
    assert r.status_code == 422


def test_broadcast_requires_admin(installed):
    assert installed.post("/api/broadcast/start", json={}).status_code == 401
    assert installed.post("/api/broadcast/stop").status_code == 401


def test_system_metrics(authed):
    r = authed.get("/api/system/metrics")
    assert r.status_code == 200
    data = r.json()
    assert data["cpu"] >= 0
    assert data["memory"]["total"] > 0
    assert data["disk"]["total"] > 0
    assert data["cpu_count"] >= 1


def test_ffmpeg_detection(authed):
    r = authed.get("/api/broadcast/ffmpeg")
    assert r.json()["available"] is True


def test_recover_requires_running_broadcast(authed):
    assert authed.post("/api/broadcast/recover").status_code == 409


def test_engine_is_independent_singleton():
    # The engine is a process-wide singleton, independent of the web layer.
    assert get_engine() is get_engine()
