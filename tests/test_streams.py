"""Output streams, shared catalogue, and preview/take tests."""
from __future__ import annotations

import subprocess
from pathlib import Path

from app import config


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
        return client.post(
            "/api/media/upload", files={"files": (path.name, fh, "video/mp4")}
        ).json()["items"][0]


STREAM = {
    "name": "YouTube",
    "description": "Chaîne principale",
    "tags": ["live", "news"],
    "privacy": "unlisted",
    "category": "News",
    "encoding": "veryfast",
    "kind": "rtmp",
    "rtmp_url": "rtmp://a.rtmp.youtube.com/live2",
    "stream_key": "abcd-1234-efgh-5678",
    "width": 1280,
    "height": 720,
    "fps": 25,
    "bitrate": 3000,
    "audio_bitrate": 128,
    "enabled": True,
}


# --- CRUD ------------------------------------------------------------------
def test_create_stream_and_metadata(authed):
    r = authed.post("/api/streams", json=STREAM)
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["name"] == "YouTube"
    assert data["tags"] == ["live", "news"]
    assert data["privacy"] == "unlisted"
    assert data["category"] == "News"
    assert data["enabled"] is True


def test_stream_key_is_masked_and_never_exposed(authed):
    sid = authed.post("/api/streams", json=STREAM).json()["id"]
    body = authed.get(f"/api/streams/{sid}").text
    assert "abcd-1234-efgh-5678" not in body
    data = authed.get(f"/api/streams/{sid}").json()
    assert data["has_stream_key"] is True
    assert data["stream_key_masked"].endswith("5678")
    assert "stream_key" not in data
    assert "abcd-1234" not in authed.get("/api/streams").text


def test_list_streams(authed):
    authed.post("/api/streams", json={**STREAM, "name": "B"})
    authed.post("/api/streams", json={**STREAM, "name": "A"})
    items = authed.get("/api/streams").json()["items"]
    assert [i["name"] for i in items] == ["A", "B"]


def test_update_stream_keeps_key_when_masked(authed):
    sid = authed.post("/api/streams", json=STREAM).json()["id"]
    masked = authed.get(f"/api/streams/{sid}").json()["stream_key_masked"]
    r = authed.put(f"/api/streams/{sid}", json={**STREAM, "name": "Renommé", "stream_key": masked})
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Renommé"
    # Key preserved (still ends with the same tail).
    assert r.json()["stream_key_masked"].endswith("5678")


def test_update_stream_replaces_key(authed):
    sid = authed.post("/api/streams", json=STREAM).json()["id"]
    r = authed.put(f"/api/streams/{sid}", json={**STREAM, "stream_key": "new-key-9999"})
    assert r.json()["stream_key_masked"].endswith("9999")


def test_delete_stream(authed):
    sid = authed.post("/api/streams", json=STREAM).json()["id"]
    assert authed.delete(f"/api/streams/{sid}").status_code == 200
    assert authed.get(f"/api/streams/{sid}").status_code == 404


def test_toggle_stream_enabled(authed):
    sid = authed.post("/api/streams", json=STREAM).json()["id"]
    r = authed.put(f"/api/streams/{sid}", json={**STREAM, "enabled": False})
    assert r.json()["enabled"] is False


# --- validation ------------------------------------------------------------
def test_stream_rejects_invalid_fields(authed):
    assert authed.post("/api/streams", json={**STREAM, "rtmp_url": "http://nope"}).status_code == 422
    assert authed.post("/api/streams", json={**STREAM, "privacy": "secret"}).status_code == 422
    assert authed.post("/api/streams", json={**STREAM, "encoding": "ludicrous"}).status_code == 422
    assert authed.post("/api/streams", json={**STREAM, "kind": "carrier-pigeon"}).status_code == 422


def test_stream_rejects_out_of_range_dimensions(authed):
    assert authed.post("/api/streams", json={**STREAM, "width": 99999}).status_code == 422
    assert authed.post("/api/streams", json={**STREAM, "fps": 999}).status_code == 422


# --- auth ------------------------------------------------------------------
def test_streams_require_auth(installed):
    assert installed.get("/api/streams").status_code == 401
    assert installed.post("/api/streams", json=STREAM).status_code == 401


# --- catalogue -------------------------------------------------------------
def test_meta_catalog(authed):
    data = authed.get("/api/meta/catalog").json()
    assert {t["id"] for t in data["transitions"]} >= {"cut", "fade", "wipeleft"}
    assert {a["id"] for a in data["animations"]} >= {"none", "marquee", "blink"}
    assert {v["id"] for v in data["visualizers"]} == {"spectrum", "wave", "bars", "vectorscope"}
    assert data["code_examples"]
    assert any(t["id"] == "reactive" for t in data["layer_types"])


def test_meta_catalog_requires_auth(installed):
    assert installed.get("/api/meta/catalog").status_code == 401


# --- preview / take / live / outputs ---------------------------------------
def _playlist_with_video(authed, tmp_path, name="Live"):
    v = tmp_path / f"{name}.mp4"
    _make_video(v)
    item = _upload(authed, v)
    pid = authed.post("/api/playlists", json={"name": name}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"media_id": item["id"]})
    return pid


def test_live_endpoint_is_lightweight(authed):
    data = authed.get("/api/broadcast/live").json()
    assert "engine" in data and "system" in data
    # The heavy fields are only in /status.
    assert "storage" not in data and "fallback_playlist_name" not in data


def test_outputs_lists_primary_and_streams(authed):
    authed.put("/api/broadcast/settings", json={"output_kind": "rtmp",
                                                "stream_rtmp_url": "rtmp://primary/live"})
    authed.post("/api/streams", json=STREAM)
    data = authed.get("/api/broadcast/outputs").json()
    assert data["count"] == 2
    assert any(o["primary"] for o in data["items"])
    assert any(o["name"] == "YouTube" for o in data["items"])


def test_preview_returns_items_without_touching_program(authed, tmp_path):
    pid = _playlist_with_video(authed, tmp_path)
    data = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()
    assert data["preview"]["playlist_name"] == "Live"
    assert len(data["preview"]["items"]) == 1
    assert data["program"]["running"] is False  # preview must not start anything


def test_take_requires_admin(installed):
    # Unauthenticated request is rejected by the admin dependency.
    assert installed.post("/api/broadcast/take", json={"playlist_id": 1}).status_code == 401


def _output_destinations(engine, output):
    return [dest for _, dest in engine._resolve_outputs(output)]


def test_output_selection_primary_only(authed):
    from app.engine import OutputConfig, PlaybackEngine

    authed.put("/api/broadcast/settings", json={"output_kind": "rtmp",
                                                "stream_rtmp_url": "rtmp://primary/live"})
    authed.post("/api/streams", json=STREAM)
    engine = PlaybackEngine()
    output = OutputConfig(kind="rtmp", rtmp_url="rtmp://primary/live", stream_key="k")
    engine._output_id = "primary"
    assert _output_destinations(engine, output) == ["rtmp://primary/live/k"]


def test_output_selection_specific_stream(authed):
    from app.engine import OutputConfig, PlaybackEngine

    authed.put("/api/broadcast/settings", json={"output_kind": "rtmp",
                                                "stream_rtmp_url": "rtmp://primary/live"})
    sid = authed.post("/api/streams", json=STREAM).json()["id"]
    engine = PlaybackEngine()
    output = OutputConfig(kind="rtmp", rtmp_url="rtmp://primary/live", stream_key="k")
    engine._output_id = sid
    dests = _output_destinations(engine, output)
    assert dests == ["rtmp://a.rtmp.youtube.com/live2/abcd-1234-efgh-5678"]


def test_output_selection_all_fans_out(authed):
    from app.engine import OutputConfig, PlaybackEngine

    authed.put("/api/broadcast/settings", json={"output_kind": "rtmp",
                                                "stream_rtmp_url": "rtmp://primary/live"})
    authed.post("/api/streams", json=STREAM)
    engine = PlaybackEngine()
    output = OutputConfig(kind="rtmp", rtmp_url="rtmp://primary/live", stream_key="k")
    engine._output_id = "all"
    dests = _output_destinations(engine, output)
    assert len(dests) == 2
    assert "rtmp://primary/live/k" in dests
    assert "rtmp://a.rtmp.youtube.com/live2/abcd-1234-efgh-5678" in dests


def test_start_with_output_id_persists_target(authed, tmp_path):
    pid = _playlist_with_video(authed, tmp_path)
    authed.put("/api/broadcast/settings", json={
        "output_kind": "file",
        "output_file": str(tmp_path / "out.ts"),
        "stream_width": 160, "stream_height": 120,
    })
    r = authed.post("/api/broadcast/start", json={"playlist_id": pid, "output_id": "primary"})
    assert r.status_code == 200, r.text
    assert r.json()["state"]["output"]["target_id"] == "primary"
    authed.post("/api/broadcast/stop")


def test_preview_requires_auth(installed):
    assert installed.get("/api/broadcast/preview").status_code == 401
