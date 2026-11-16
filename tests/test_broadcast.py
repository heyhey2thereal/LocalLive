"""Broadcast control and system monitoring tests."""
from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

from app import config, db
from app.engine import OutputConfig, PlaybackEngine, get_engine


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


def test_take_does_not_start_broadcast(authed, tmp_path):
    # A take is a switch only: it must never start the live. When the broadcast
    # is stopped the programme is still switched (so the program monitor shows
    # the chosen playlist) but nothing is streamed.
    pid = _setup_playlist(authed, tmp_path)
    authed.put("/api/broadcast/settings", json={
        "output_kind": "file",
        "output_file": str(tmp_path / "take.ts"),
        "stream_width": 160, "stream_height": 120,
    })
    assert authed.get("/api/broadcast/status").json()["engine"]["running"] is False
    r = authed.post("/api/broadcast/take", json={"playlist_id": pid})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["switched"] is True and body["live"] is False
    # The programme is lined up but the live did NOT start.
    status = authed.get("/api/broadcast/status").json()["engine"]
    assert status["running"] is False
    assert status["playlist_id"] == pid


def test_take_switches_when_running(authed, tmp_path):
    pid = _setup_playlist(authed, tmp_path)
    # The target playlist must not be empty (a switch to an empty list fails).
    v = tmp_path / "w.mp4"
    _make_video(v)
    with v.open("rb") as fh:
        item = authed.post("/api/media/upload", files={"files": (v.name, fh, "video/mp4")}).json()["items"][0]
    other = authed.post("/api/playlists", json={"name": "Autre"}).json()["id"]
    authed.post(f"/api/playlists/{other}/items", json={"media_id": item["id"]})
    authed.put("/api/broadcast/settings", json={
        "output_kind": "file",
        "output_file": str(tmp_path / "switch.ts"),
        "stream_width": 160, "stream_height": 120,
    })
    assert authed.post("/api/broadcast/start", json={"playlist_id": pid}).status_code == 200
    try:
        r = authed.post("/api/broadcast/take", json={"playlist_id": other})
        assert r.status_code == 200, r.text
    finally:
        authed.post("/api/broadcast/stop")


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


def _make_countdown_playlist(authed, seconds=60):
    sid = authed.post("/api/scenes", json={
        "name": "Compte",
        "layers": [{"type": "countdown", "countdown_seconds": seconds, "countdown_mode": "down"}],
    }).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "CD"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid, "duration": 5})
    return pid, sid


def test_countdown_descriptor_exposed_in_preview(authed):
    pid, _ = _make_countdown_playlist(authed, 45)
    data = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()
    item = data["preview"]["items"][0]
    cd = item["countdown"]
    assert cd["layer_index"] == 0
    assert cd["seconds"] == 45
    assert cd["mode"] == "down"
    assert cd["background"] is False
    assert cd["start"] is None


def test_countdown_add_time_persists_on_scene(authed):
    pid, sid = _make_countdown_playlist(authed, 30)
    item = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()["preview"]["items"][0]
    r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "add", "seconds": 30})
    assert r.status_code == 200, r.text
    assert r.json()["seconds"] == 60
    # The scene's starting value really changed (so the engine draws it longer).
    scene = authed.get(f"/api/scenes/{sid}").json()
    assert scene["layers"][0]["countdown_seconds"] == 60


def test_countdown_restart_when_not_running_is_noop(authed):
    pid, _ = _make_countdown_playlist(authed)
    item = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()["preview"]["items"][0]
    r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "restart"})
    assert r.status_code == 200, r.text
    assert r.json()["restarted"] is False


def test_countdown_unknown_item_and_missing_layer(authed):
    assert authed.post("/api/broadcast/countdown", json={"item_id": 999, "action": "add", "seconds": 10}).status_code == 404
    # An item whose scene has no countdown layer is rejected too.
    sid = authed.post("/api/scenes", json={"name": "Sans", "layers": [{"type": "text", "text": "x"}]}).json()["id"]
    pid = authed.post("/api/playlists", json={"name": "P"}).json()["id"]
    authed.post(f"/api/playlists/{pid}/items", json={"scene_id": sid})
    item = authed.get(f"/api/playlists/{pid}").json()["items"][0]
    assert authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "add", "seconds": 10}).status_code == 404


def test_countdown_requires_capability(installed):
    assert installed.post("/api/broadcast/countdown", json={"item_id": 1, "action": "add", "seconds": 10}).status_code == 401


def test_countdown_start_and_background_toggle(authed):
    """Starting a countdown records the wall-clock start; background toggles it."""
    pid, sid = _make_countdown_playlist(authed, 90)
    item = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()["preview"]["items"][0]

    # Enabling "continue in background" records a start time on the scene.
    r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "background", "enabled": True})
    assert r.status_code == 200, r.text
    assert r.json()["background"] is True
    scene = authed.get(f"/api/scenes/{sid}").json()
    assert scene["layers"][0]["countdown_background"] is True
    assert scene["layers"][0]["countdown_start"]

    # The descriptor now reports it so the monitor can show the ⟳ badge.
    cd = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()["preview"]["items"][0]["countdown"]
    assert cd["background"] is True and cd["start"]

    # Starting records a fresh wall-clock start.
    r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "start"})
    assert r.status_code == 200, r.text
    assert r.json()["started"] is True

    # Turning it off clears the start.
    r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "background", "enabled": False})
    assert r.json()["background"] is False
    scene = authed.get(f"/api/scenes/{sid}").json()
    assert scene["layers"][0]["countdown_background"] is False
    assert scene["layers"][0]["countdown_start"] is None


def test_visualizers_use_log_frequency_scale():
    """Regression: the spectrum/bars looked empty with a linear frequency axis."""
    from app import fx
    assert "fscale=log" in fx.VISUALIZERS["spectrum"]["filter"]
    assert "fscale=log" in fx.VISUALIZERS["bars"]["filter"]


def test_countdown_controls_apply_while_running(authed, tmp_path):
    # On air: adding time restarts the current item so the longer timer shows at
    # once, and restarting starts the countdown over.
    pid, _ = _make_countdown_playlist(authed, 20)
    authed.put("/api/broadcast/settings", json={
        "output_kind": "file",
        "output_file": str(tmp_path / "cd.ts"),
        "stream_width": 160, "stream_height": 120,
    })
    assert authed.post("/api/broadcast/start", json={"playlist_id": pid}).status_code == 200
    try:
        time.sleep(1.0)
        item = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()["preview"]["items"][0]
        r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "add", "seconds": 10})
        assert r.status_code == 200, r.text
        assert r.json()["applied"] is True and r.json()["seconds"] == 30
        r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "restart"})
        assert r.status_code == 200, r.text
        assert r.json()["restarted"] is True
    finally:
        authed.post("/api/broadcast/stop")


def test_engine_is_independent_singleton():
    # The engine is a process-wide singleton, independent of the web layer.
    assert get_engine() is get_engine()


def test_take_empty_playlist_while_stopped_is_rejected(authed, tmp_path):
    # A take onto an empty playlist cannot line up a programme: clear 409.
    empty = authed.post("/api/playlists", json={"name": "Vide"}).json()["id"]
    assert authed.get("/api/broadcast/status").json()["engine"]["running"] is False
    r = authed.post("/api/broadcast/take", json={"playlist_id": empty})
    assert r.status_code == 409, r.text


def test_take_while_stopped_lines_up_the_programme(authed, tmp_path):
    # The programme is switched (program monitor shows the playlist) but the live
    # is NOT started.
    pid = _setup_playlist(authed, tmp_path)
    r = authed.post("/api/broadcast/take", json={"playlist_id": pid})
    assert r.status_code == 200, r.text
    assert r.json()["switched"] is True and r.json()["live"] is False
    preview = authed.get("/api/broadcast/preview").json()
    assert preview["program"]["playlist_id"] == pid
    assert preview["program"]["running"] is False


def test_schedule_switches_live_playlist(authed, tmp_path):
    """The scheduler swaps the on-air playlist when a programme becomes active.

    Regression: nothing ever consulted the schedule while the live was running,
    so a scheduled playlist never reached the programme.
    """
    import datetime as _dt
    from zoneinfo import ZoneInfo

    from app import db
    from app.engine import PlaybackEngine

    first = _setup_playlist(authed, tmp_path)
    v = tmp_path / "second.mp4"
    _make_video(v)
    with v.open("rb") as fh:
        item = authed.post("/api/media/upload", files={"files": (v.name, fh, "video/mp4")}).json()["items"][0]
    second = authed.post("/api/playlists", json={"name": "Soir"}).json()["id"]
    authed.post(f"/api/playlists/{second}/items", json={"media_id": item["id"]})

    authed.put("/api/broadcast/settings", json={
        "output_kind": "file",
        "output_file": str(tmp_path / "sched.ts"),
        "stream_width": 160, "stream_height": 120,
        "timezone": "UTC",
    })
    assert authed.post("/api/broadcast/start", json={"playlist_id": first}).status_code == 200

    engine = PlaybackEngine()
    engine._config = engine._build_output_config({})
    try:
        # A schedule that is active now must point the live at `second`.
        now = _dt.datetime.now(ZoneInfo("UTC"))
        start = (now - _dt.timedelta(minutes=1)).strftime("%H:%M")
        end = (now + _dt.timedelta(minutes=5)).strftime("%H:%M")
        db.execute(
            "INSERT INTO schedules(name, playlist_id, days, start_time, end_time, enabled) VALUES(?,?,?,?,?,1)",
            ("Soir", second, json.dumps([now.weekday()]), start, end),
        )
        engine._state.running = True
        engine._state.playlist_id = first
        engine._apply_schedule_once()
        assert engine._state.playlist_id == second
    finally:
        authed.post("/api/broadcast/stop")


def test_schedule_does_not_touch_stopped_broadcast(authed, tmp_path):
    """With the live stopped the schedule must not force a programme."""
    import datetime as _dt
    from zoneinfo import ZoneInfo

    from app import db
    from app.engine import PlaybackEngine

    pid = _setup_playlist(authed, tmp_path)
    now = _dt.datetime.now(ZoneInfo("UTC"))
    db.execute(
        "INSERT INTO schedules(name, playlist_id, days, start_time, end_time, enabled) VALUES(?,?,?,?,?,1)",
        ("Jour", pid, "[]", (now - _dt.timedelta(minutes=1)).strftime("%H:%M"), (now + _dt.timedelta(minutes=5)).strftime("%H:%M")),
    )
    engine = PlaybackEngine()
    engine._state.running = False
    engine._state.playlist_id = None
    engine._apply_schedule_once()
    assert engine._state.playlist_id is None



def test_countdown_pause_and_resume(authed):
    """Pausing freezes the countdown; resuming restarts from where it stopped."""
    pid, sid = _make_countdown_playlist(authed, 120)
    item = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()["preview"]["items"][0]

    # Start it, then pause: the elapsed time is accumulated and it is frozen.
    assert authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "start"}).status_code == 200
    r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "pause"})
    assert r.status_code == 200, r.text
    assert r.json()["paused"] is True
    scene = authed.get(f"/api/scenes/{sid}").json()
    assert scene["layers"][0]["countdown_paused"] is True
    assert scene["layers"][0]["countdown_elapsed"] >= 0

    # The descriptor reports the paused state so the monitor shows the ⏸ badge.
    cd = authed.get(f"/api/broadcast/preview?playlist_id={pid}").json()["preview"]["items"][0]["countdown"]
    assert cd["paused"] is True

    # Resume clears the pause (and restarts the wall clock).
    r = authed.post("/api/broadcast/countdown", json={"item_id": item["id"], "action": "resume"})
    assert r.status_code == 200, r.text
    assert r.json()["paused"] is False
    scene = authed.get(f"/api/scenes/{sid}").json()
    assert scene["layers"][0]["countdown_paused"] is False


def test_countdown_paused_freezes_engine_expression(installed, tmp_path):
    """A paused countdown draws a constant time (no `floor(t)` advance)."""
    import json as _json

    layers = [{
        "type": "countdown", "countdown_seconds": 60, "countdown_mode": "down",
        "countdown_background": True, "countdown_start": 1.0,
        "countdown_elapsed": 30, "countdown_paused": True,
    }]
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        ("S", 320, 240, "#000", _json.dumps(layers)),
    )
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('P', 1)")
    db.execute(
        "INSERT INTO playlist_items(playlist_id, scene_id, position, duration) VALUES(?,?,?,?)",
        (pid, sid, 0, 2.0),
    )
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    cmd, _ = engine._build_command(
        items, OutputConfig(kind="file", file_path=str(tmp_path / "o.mp4"), width=320, height=240, fps=25, realtime=False)
    )
    fc = cmd[cmd.index("-filter_complex") + 1]
    # Frozen at the accumulated 30 s: the expression has no advancing tick.
    assert "60-(30+0)" in fc


def test_playlist_item_fade_in_out_persisted(authed):
    """Fade in/out are stored on the item and exposed in the playlist."""
    pid = authed.post("/api/playlists", json={"name": "Fade"}).json()["id"]
    sid = authed.post("/api/scenes", json={"name": "S", "layers": []}).json()["id"]
    item = authed.post(
        f"/api/playlists/{pid}/items",
        json={"scene_id": sid, "duration": 5, "fade_in": 1.5, "fade_out": 2.0},
    ).json()["items"][0]
    assert item["fade_in"] == 1.5 and item["fade_out"] == 2.0

    # PATCH updates them independently.
    authed.patch(f"/api/playlists/{pid}/items/{item['id']}", json={"fade_in": 3})
    items = authed.get(f"/api/playlists/{pid}").json()["items"]
    assert items[0]["fade_in"] == 3 and items[0]["fade_out"] == 2.0


def test_fade_forces_filter_pipeline_and_adds_afade(installed, tmp_path):
    """A fade needs decoding, so it must not use the stream-copy fast path."""
    import subprocess as _sp

    v = tmp_path / "v.mp4"
    _sp.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", "testsrc=size=160x120:rate=25:duration=3",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-shortest", str(v)],
        check=True, timeout=120,
    )
    from app import probe

    info = probe.probe(v)
    mid = db.execute(
        """INSERT INTO media(title, filename, path, kind, size, duration, width, height, fps,
                             video_codec, audio_codec, has_audio)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("v", "v.mp4", str(v), "video", v.stat().st_size, info["duration"], info["width"],
         info["height"], info["fps"], info["video_codec"], info["audio_codec"], info["has_audio"]),
    )
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('P', 1)")
    db.execute(
        "INSERT INTO playlist_items(playlist_id, media_id, position, duration, fade_in, fade_out) "
        "VALUES(?,?,?,?,?,?)",
        (pid, mid, 0, 3.0, 1.0, 1.0),
    )
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    assert engine._can_stream_copy(items) is False
    cmd, pipeline = engine._build_command(
        items, OutputConfig(kind="file", file_path=str(tmp_path / "o.mp4"), width=160, height=120, fps=25, realtime=False)
    )
    assert pipeline == "filter"
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "afade=t=in:st=0:d=1.000" in fc
    assert "afade=t=out:st=2.000:d=1.000" in fc
