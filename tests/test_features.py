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


# --- playlist duration fixes (2.9.0) --------------------------------------
def test_scene_item_effective_duration_uses_default(authed):
    # A scene has no intrinsic duration: the API must report the default, not 0,
    # so the playlist shows the real length the engine will play.
    sid = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid})
    item = authed.get(f"/api/playlists/{pid}").json()["items"][0]
    assert item["effective_duration"] == 5.0


def test_patch_transition_keeps_duration(authed):
    # PATCHing only the transition must not reset the duration override to zero.
    sid = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid, "duration": 12})
    item = authed.get(f"/api/playlists/{pid}").json()["items"][0]
    authed.patch(f"/api/playlists/{pid}/items/{item['id']}", json={"transition": "fade"})
    after = authed.get(f"/api/playlists/{pid}").json()["items"][0]
    assert after["duration"] == 12.0
    assert after["transition"] == "fade"


# --- bulk delete -----------------------------------------------------------
def test_bulk_delete_removes_selected(authed, tmp_path):
    v1 = tmp_path / "a.mp4"
    v2 = tmp_path / "b.mp4"
    _make_video(v1)
    _make_video(v2)
    ids = []
    for v in (v1, v2):
        with v.open("rb") as fh:
            ids.append(authed.post("/api/media/upload", files={"files": (v.name, fh, "video/mp4")}).json()["items"][0]["id"])
    r = authed.post("/api/media/bulk-delete", json={"ids": ids})
    assert r.status_code == 200, r.text
    assert r.json()["deleted"] == 2
    assert authed.get("/api/media").json()["items"] == []


def test_bulk_delete_requires_capability(installed):
    assert installed.post("/api/media/bulk-delete", json={"ids": [1]}).status_code == 401


# --- search ----------------------------------------------------------------
def test_search_scenes_and_playlists(authed):
    authed.post("/api/scenes", json={"name": "Météo matin", "layers": []})
    authed.post("/api/scenes", json={"name": "Journal", "layers": []})
    authed.post("/api/playlists", json={"name": "Nuit"})
    authed.post("/api/playlists", json={"name": "Journée"})
    scenes = authed.get("/api/scenes?q=météo").json()["items"]
    assert [s["name"] for s in scenes] == ["Météo matin"]
    playlists = authed.get("/api/playlists?q=jour").json()["items"]
    assert [p["name"] for p in playlists] == ["Journée"]


# --- stats -----------------------------------------------------------------
def test_stats_endpoint(authed):
    authed.post("/api/scenes", json={"name": "S", "layers": []})
    data = authed.get("/api/system/stats").json()
    assert data["scenes"] == 1
    assert data["media"]["count"] == 0
    assert data["users"] >= 1


# --- config export / import ------------------------------------------------
def test_config_export_import_round_trip(authed):
    authed.post("/api/scenes", json={"name": "Décor", "layers": [{"type": "text", "text": "Hi"}]})
    pid = authed.post("/api/playlists", json={"name": "Boucle"}).json()["id"]
    sid = authed.get("/api/scenes").json()["items"][0]["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid, "duration": 8})
    snapshot = authed.get("/api/system/config/export").json()
    assert snapshot["format"] == 1
    assert len(snapshot["scenes"]) == 1

    # Import into the same install (additive) and check the content grows.
    res = authed.post("/api/system/config/import", json={"data": snapshot}).json()
    assert res["ok"] is True
    assert res["counts"]["scenes"] == 1
    assert len(authed.get("/api/scenes").json()["items"]) == 2
    assert len(authed.get("/api/playlists").json()["items"]) == 2


def test_config_import_rejects_bad_file(authed):
    assert authed.post("/api/system/config/import", json={"data": {"nope": 1}}).status_code == 422


def test_config_requires_settings_capability(installed):
    assert installed.get("/api/system/config/export").status_code == 401


# --- duplicate / reorder a playlist item -----------------------------------
def test_duplicate_item_inserts_copy_after(authed):
    sid = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid, "duration": 4})
    item = authed.get(f"/api/playlists/{pid}").json()["items"][0]
    res = authed.post(f"/api/playlists/{pid}/items/{item['id']}/duplicate", json={})
    assert res.status_code == 201, res.text
    items = res.json()["items"]
    assert len(items) == 2
    # The copy sits right after the original with the same settings.
    assert items[1]["duration"] == 4.0
    assert items[0]["scene_id"] == items[1]["scene_id"]


def test_duplicate_item_requires_capability(installed):
    assert installed.post("/api/playlists/1/items/1/duplicate", json={}).status_code == 401


def test_reorder_moves_item(authed):
    a = authed.post("/api/scenes", json={"name": "A", "layers": []}).json()["id"]
    b = authed.post("/api/scenes", json={"name": "B", "layers": []}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": a})
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": b})
    items = authed.get(f"/api/playlists/{pid}").json()["items"]
    swapped = [items[1]["id"], items[0]["id"]]
    res = authed.post(f"/api/playlists/{pid}/reorder", json={"item_ids": swapped}).json()
    assert [i["id"] for i in res["items"]] == swapped
