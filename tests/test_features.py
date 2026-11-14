"""Tests for the 2.8.0 features: clock/ticker layers, duplicate, skip, sort."""
from __future__ import annotations

import subprocess
from pathlib import Path

from app import config, db, fx
from app.engine import OutputConfig, PlaybackEngine


def _make_video(path: Path, seconds: int = 1):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"testsrc=size=160x120:rate=25:duration={seconds}",
         "-f", "lavfi", "-i", f"sine=duration={seconds}",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-shortest", str(path)],
        check=True, timeout=120,
    )


# --- clock helpers ---------------------------------------------------------
def test_clock_formats_catalog_non_empty():
    formats = fx.clock_formats_catalog()
    assert any(f["id"] == "%H:%M" for f in formats)


def test_clock_text_expr_escapes_colons():
    expr = fx.clock_text_expr("%H:%M")
    assert "localtime" in expr
    # Each directive is its own expansion, joined by an escaped literal colon.
    assert expr == "%{localtime\\:%H}\\:%{localtime\\:%M}"
    assert fx.clock_text_expr("%H:%M", utc=True).startswith("%{gmtime")


def test_clock_text_expr_handles_literals_and_utc():
    # A literal prefix is escaped, and %A/%d/%B each get their own expansion.
    expr = fx.clock_text_expr("Le %A %d %B")
    assert expr.startswith("Le ")
    assert expr.count("%{localtime") == 3


# --- clock / ticker layers are accepted and rendered -----------------------
def test_clock_layer_accepted_and_rendered(installed, tmp_path):
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('Clock', 1)")
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        ("Horloge", 320, 240, "#101020",
         '[{"type":"clock","clock_format":"%H:%M","x":20,"y":20,"font_size":40,"z":1}]'),
    )
    db.execute(
        "INSERT INTO playlist_items(playlist_id, scene_id, position, duration) VALUES(?,?,?,?)",
        (pid, sid, 0, 2.0),
    )
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(tmp_path / "o.ts"), width=320, height=240))
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "localtime" in fc


def test_ticker_layer_renders_text(installed, tmp_path):
    # Without a reachable feed the layer falls back to its static text, so the
    # graph must still contain a drawtext with the placeholder.
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('Ticker', 1)")
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        ("Bandeau", 320, 240, "#101020",
         '[{"type":"ticker","feed_url":"","text":"A LA UNE","x":0,"y":200,"font_size":24,"z":1}]'),
    )
    db.execute(
        "INSERT INTO playlist_items(playlist_id, scene_id, position, duration) VALUES(?,?,?,?)",
        (pid, sid, 0, 2.0),
    )
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(tmp_path / "o.ts"), width=320, height=240))
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "drawtext" in fc and "A LA UNE" in fc


def test_clock_and_ticker_types_accepted_by_api(authed):
    r = authed.post("/api/scenes", json={
        "name": "Nouveaux",
        "layers": [
            {"type": "clock", "clock_format": "%H:%M:%S"},
            {"type": "ticker", "feed_url": "https://example.com/rss.xml", "feed_limit": 5},
        ],
    })
    assert r.status_code == 201, r.text
    layers = r.json()["layers"]
    assert layers[0]["clock_format"] == "%H:%M:%S"
    assert layers[1]["feed_limit"] == 5


def test_catalog_exposes_clock_formats(authed):
    cat = authed.get("/api/meta/catalog").json()
    assert cat["clock_formats"]
    assert any(t["id"] == "clock" for t in cat["layer_types"])
    assert any(t["id"] == "ticker" for t in cat["layer_types"])


# --- duplicate -------------------------------------------------------------
def test_duplicate_scene_copies_layers(authed):
    original = authed.post("/api/scenes", json={
        "name": "Source", "layers": [{"type": "text", "text": "Bonjour"}],
    }).json()
    copy = authed.post(f"/api/scenes/{original['id']}/duplicate", json={}).json()
    assert copy["id"] != original["id"]
    assert copy["name"].startswith("Source")
    assert copy["layers"][0]["text"] == "Bonjour"


def test_duplicate_playlist_copies_items(authed, tmp_path):
    v = tmp_path / "v.mp4"
    _make_video(v)
    with v.open("rb") as fh:
        item = authed.post("/api/media/upload", files={"files": (v.name, fh, "video/mp4")}).json()["items"][0]
    pid = authed.post("/api/playlists", json={"name": "Pl"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"media_id": item["id"]})
    copy = authed.post(f"/api/playlists/{pid}/duplicate", json={}).json()
    assert copy["id"] != pid
    assert copy["item_count"] == 1
    assert copy["name"].startswith("Pl")


def test_duplicate_scene_requires_capability(installed):
    assert installed.post("/api/scenes/1/duplicate", json={}).status_code == 401


# --- skip (next / previous) ------------------------------------------------
def test_skip_requires_running_broadcast(authed):
    assert authed.post("/api/broadcast/next").status_code == 409
    assert authed.post("/api/broadcast/previous").status_code == 409


def test_skip_rotates_playlist(authed, tmp_path):
    v = tmp_path / "v.mp4"
    _make_video(v)
    with v.open("rb") as fh:
        item = authed.post("/api/media/upload", files={"files": (v.name, fh, "video/mp4")}).json()["items"][0]
    pid = authed.post("/api/playlists", json={"name": "Skip"}).json()["id"]
    for _ in range(3):
        authed.post(f"/api/playlists/{pid}/items", json={"media_id": item["id"]})
    authed.put("/api/broadcast/settings", json={
        "output_kind": "file", "output_file": str(tmp_path / "s.ts"),
        "stream_width": 160, "stream_height": 120,
    })
    assert authed.post("/api/broadcast/start", json={"playlist_id": pid}).status_code == 200
    r = authed.post("/api/broadcast/next")
    assert r.status_code == 200, r.text
    assert r.json()["index"] == 1
    authed.post("/api/broadcast/stop")


def test_skip_requires_admin(installed):
    assert installed.post("/api/broadcast/next").status_code == 401
