"""Tests for the 2.8.0 features: clock/ticker layers, duplicate, skip, sort."""
from __future__ import annotations

import subprocess
from datetime import datetime
from pathlib import Path

from app import config, db, fx
from app.engine import OutputConfig, PlaybackEngine
from app.routers.schedules import active_playlist_id


def _make_image(path: Path):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", "color=c=red:size=320x240:duration=1", "-frames:v", "1", str(path)],
        check=True, timeout=60,
    )


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


# --- fonts -----------------------------------------------------------------
def test_font_catalog_and_resolution():
    catalog = fx.font_catalog()
    assert any(f["id"] == "default" for f in catalog)
    # The default resolves to a real file on this host.
    assert fx.resolve_font("default") and Path(fx.resolve_font("default")).exists()
    # An unknown id falls back to the default rather than failing.
    assert fx.resolve_font("does-not-exist") == fx.font_path()


def test_marquee_is_single_pass():
    # The marquee now crosses the frame once (no modulo) so it does not "spam".
    expr = fx.animation_exprs("marquee", 10, 20, speed=80)["x"]
    assert "mod(" not in expr
    assert expr.startswith("w-min(")


def test_rainbow_recolours_text_via_enable():
    # The rainbow loop recolours the text: one enable window per colour.
    windows = [fx.rainbow_enable(i, 0.5) for i in range(len(fx.RAINBOW_COLORS))]
    assert len(windows) == len(fx.RAINBOW_COLORS)
    assert all("between(" in w for w in windows)


def test_rainbow_loop_does_not_move_text():
    # The colour cycle is applied to the text; the position/alpha stay put.
    motion = fx.layer_motion(10, 20, anim_loop="rainbow")
    assert motion["x"] == "10" and motion["y"] == "20" and motion["alpha"] == "1"


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


# --- regression tests: bug fixes (2.13.0) ----------------------------------

def _audio(tmp_path, name="tone.mp3"):
    p = tmp_path / name
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=2", str(p)],
        check=True, timeout=60,
    )
    return p


def test_duplicate_middle_item_does_not_collide(authed):
    # Duplicating an item shifted the followers in one UPDATE, which tripped the
    # UNIQUE(playlist_id, position) index and returned a 500.
    sid = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    for _ in range(4):
        authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid, "duration": 5})
    items = authed.get(f"/api/playlists/{pid}").json()["items"]
    r = authed.post(f"/api/playlists/{pid}/items/{items[0]['id']}/duplicate", json={})
    assert r.status_code == 201, r.text
    positions = [i["position"] for i in r.json()["items"]]
    assert positions == [0, 1, 2, 3, 4]


def test_background_music_can_be_cleared(authed, tmp_path):
    # PATCH with background_audio_id=null was ignored, so the music could never
    # be removed once set.
    a = _audio(tmp_path)
    with a.open("rb") as fh:
        mid = authed.post("/api/media/upload", files={"files": (a.name, fh, "audio/mpeg")}).json()["items"][0]["id"]
    sid = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    item = authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid}).json()["items"][0]
    authed.patch(f"/api/playlists/{pid}/items/{item['id']}", json={"background_audio_id": mid})
    assert authed.get(f"/api/playlists/{pid}").json()["items"][0]["background_audio_id"] == mid
    authed.patch(f"/api/playlists/{pid}/items/{item['id']}", json={"background_audio_id": None})
    assert authed.get(f"/api/playlists/{pid}").json()["items"][0]["background_audio_id"] is None


def test_background_volume_zero_is_kept(authed):
    # A volume of 0 (silence) was reported as the 0.15 default.
    sid = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    item = authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid}).json()["items"][0]
    authed.patch(f"/api/playlists/{pid}/items/{item['id']}", json={"background_volume": 0})
    assert authed.get(f"/api/playlists/{pid}").json()["items"][0]["background_volume"] == 0.0


def test_stream_suffix_range_returns_tail(authed, tmp_path):
    # "bytes=-N" means the LAST N bytes, not the first N.
    v = tmp_path / "v.mp4"
    _make_video(v)
    with v.open("rb") as fh:
        mid = authed.post("/api/media/upload", files={"files": (v.name, fh, "video/mp4")}).json()["items"][0]["id"]
    size = int(authed.get(f"/api/media/{mid}/stream", headers={"Range": "bytes=0-0"}).headers["content-range"].split("/")[1])
    r = authed.get(f"/api/media/{mid}/stream", headers={"Range": "bytes=-50"})
    assert r.status_code == 206
    assert len(r.content) == 50
    assert r.headers["content-range"] == f"bytes {size - 50}-{size - 1}/{size}"


def test_media_thumbnail_and_preview_require_auth(installed):
    # Thumbnails and previews used to be served without any session, leaking the
    # media library to anyone who could guess a media id.
    assert installed.get("/api/media/1/thumbnail").status_code == 401
    assert installed.get("/api/media/1/preview").status_code == 401


def test_blank_names_are_rejected(authed):
    assert authed.post("/api/playlists", json={"name": "   "}).status_code == 422
    assert authed.post("/api/scenes", json={"name": "   ", "layers": []}).status_code == 422
    assert authed.post("/api/streams", json={"name": "   "}).status_code == 422
    assert authed.post("/api/schedules", json={"name": "   ", "start_time": "08:00", "end_time": "09:00"}).status_code == 422
    # Updates must reject a blank name too (it used to be stored as "").
    sc = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    assert authed.put(f"/api/scenes/{sc}", json={"name": "   ", "layers": []}).status_code == 422
    pl = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    assert authed.patch(f"/api/playlists/{pl}", json={"name": "   "}).status_code == 422


def test_unknown_folder_is_rejected(authed, tmp_path):
    # Moving a media to a missing folder raised a FK error (500).
    v = tmp_path / "v.mp4"
    _make_video(v)
    with v.open("rb") as fh:
        mid = authed.post("/api/media/upload", files={"files": (v.name, fh, "video/mp4")}).json()["items"][0]["id"]
    assert authed.patch(f"/api/media/{mid}", json={"folder_id": 999}).status_code == 404


def test_user_rename_collision_is_409(authed):
    authed.post("/api/users", json={"username": "bob", "password": "SuperSecret123", "role": "viewer"})
    u = authed.post("/api/users", json={"username": "carol", "password": "SuperSecret123", "role": "viewer"}).json()
    r = authed.patch(f"/api/users/{u['id']}", json={"username": "bob", "role": "viewer", "permissions": []})
    assert r.status_code == 409, r.text


def test_batch_upload_keeps_valid_files(authed, tmp_path):
    # One unsupported file used to abort the whole batch.
    img = tmp_path / "ok.png"
    _make_image(img)
    bad = tmp_path / "note.txt"
    bad.write_text("x")
    with img.open("rb") as fh, bad.open("rb") as fh2:
        r = authed.post(
            "/api/media/upload",
            files=[("files", (img.name, fh, "image/png")), ("files", (bad.name, fh2, "text/plain"))],
        )
    assert r.status_code == 201, r.text
    assert r.json()["count"] == 1
    assert r.json()["rejected"] == ["note.txt"]


def test_fallback_playlist_cleared_with_zero(authed):
    pid = authed.post("/api/playlists", json={"name": "F"}).json()["id"]
    authed.put("/api/broadcast/settings", json={"fallback_playlist_id": pid})
    assert active_playlist_id() == pid
    authed.put("/api/broadcast/settings", json={"fallback_playlist_id": 0})
    assert active_playlist_id() is None


def test_overnight_schedule_matches_next_day(authed):
    # A Monday 22:00 -> 02:00 window must also cover Tuesday 01:00.
    pid = authed.post("/api/playlists", json={"name": "Nuit"}).json()["id"]
    authed.post("/api/schedules", json={
        "name": "Nuit", "playlist_id": pid, "days": [0],
        "start_time": "22:00", "end_time": "02:00", "enabled": True,
    })
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Europe/Paris")
    assert active_playlist_id(datetime(2026, 11, 16, 23, 0, tzinfo=tz)) == pid  # Monday
    assert active_playlist_id(datetime(2026, 11, 17, 1, 0, tzinfo=tz)) == pid   # Tuesday
    assert active_playlist_id(datetime(2026, 11, 17, 12, 0, tzinfo=tz)) is None  # Tuesday midday


def test_audio_thumbnail_is_generated(authed, tmp_path):
    # Grabbing a frame from an audio file produced no output, so audio media had
    # no thumbnail at all. A waveform is rendered instead.
    a = _audio(tmp_path)
    with a.open("rb") as fh:
        item = authed.post("/api/media/upload", files={"files": (a.name, fh, "audio/mpeg")}).json()["items"][0]
    assert item["kind"] == "audio"
    assert item["thumbnail_url"], "an audio file should still get a thumbnail"
    assert authed.get(item["thumbnail_url"]).status_code == 200


def test_user_create_strips_username(authed):
    # The uniqueness check used the raw name while the insert stored a stripped
    # one, so " bob" and "bob" could both be created.
    assert authed.post("/api/users", json={"username": "  bob  ", "password": "SuperSecret123", "role": "viewer"}).json()["username"] == "bob"
    assert authed.post("/api/users", json={"username": "bob", "password": "SuperSecret123", "role": "viewer"}).status_code == 409


# --- 2.13.2: continue-music, preview loop ----------------------------------

def test_continue_previous_music(installed, tmp_path):
    # An item flagged "continue previous music" keeps the previous item's track
    # (same id) instead of starting its own.
    a = _audio(tmp_path)
    db.execute(
        "INSERT INTO media(title, filename, path, kind, mime, size, duration, has_audio) VALUES(?,?,?,?,?,?,?,?)",
        ("Music", a.name, str(a), "audio", "audio/mpeg", a.stat().st_size, 2.0, 1),
    )
    aid = db.query_one("SELECT id FROM media WHERE title='Music'")["id"]
    s1 = db.execute("INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)", ("S1", 320, 240, "#000", "[]"))
    s2 = db.execute("INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)", ("S2", 320, 240, "#000", "[]"))
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('P', 1)")
    db.execute(
        "INSERT INTO playlist_items(playlist_id, scene_id, position, duration, background_audio_id, background_volume) "
        "VALUES(?,?,?,?,?,?)",
        (pid, s1, 0, 4.0, aid, 0.5),
    )
    db.execute(
        "INSERT INTO playlist_items(playlist_id, scene_id, position, duration, background_audio_continue) VALUES(?,?,?,?,?)",
        (pid, s2, 1, 4.0, 1),
    )
    items = PlaybackEngine()._resolve_items(pid)
    assert items[0]["background_audio_id"] == aid
    # The second item inherits the same track and volume, with a real path.
    assert items[1]["background_audio_id"] == aid
    assert items[1]["background_volume"] == 0.5
    assert items[1]["background_audio_path"]


def test_preview_exposes_loop_flag(authed):
    pid = authed.post("/api/playlists", json={"name": "Boucle", "loop": False}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]})
    data = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()
    assert data["preview"]["loop"] is False


def test_item_patch_continue_music(authed):
    sid = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    item = authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid}).json()["items"][0]
    assert item["background_audio_continue"] is False
    authed.patch(f"/api/playlists/{pid}/items/{item['id']}", json={"background_audio_continue": True})
    after = authed.get(f"/api/playlists/{pid}").json()["items"][0]
    assert after["background_audio_continue"] is True
