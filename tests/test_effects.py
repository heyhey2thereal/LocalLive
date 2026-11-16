"""Effects tests: fx helpers, transitions, background music, reactive layers.

These cover the pure helpers (no ffmpeg) and the filter-graph wiring for the new
engine features (transitions, background audio, scene layers).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from app import config, db, fx
from app.engine import OutputConfig, PlaybackEngine


def _make_video(path: Path, seconds: int = 2, size="320x240", freq=440):
    subprocess.run(
        [
            config.FFMPEG_BIN, "-y", "-v", "error",
            "-f", "lavfi", "-i", f"testsrc=size={size}:rate=25:duration={seconds}",
            "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(path),
        ],
        check=True, timeout=120,
    )


def _make_audio(path: Path, seconds=3, freq=220):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"sine=frequency={freq}:duration={seconds}", str(path)],
        check=True, timeout=60,
    )


def _make_image(path: Path, size="320x240"):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"color=c=blue:size={size}:duration=1", "-frames:v", "1", str(path)],
        check=True, timeout=60,
    )


def _insert_media(path: Path, kind: str, duration: float) -> int:
    from app import probe

    info = probe.probe(path)
    return db.execute(
        """INSERT INTO media(title, filename, path, kind, size, duration, width, height, fps,
                             video_codec, audio_codec, has_audio)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            path.stem, path.name, str(path), kind, path.stat().st_size,
            info["duration"] or duration, info["width"], info["height"], info["fps"],
            info["video_codec"], info["audio_codec"], info["has_audio"],
        ),
    )


# --- pure helpers ----------------------------------------------------------
def test_escape_code_removes_structural_chars():
    # Semicolons, brackets and newlines would let the value rewrite the graph.
    assert fx.escape_code("hflip; rm -rf /") == "hflip rm -rf /"
    assert fx.escape_code("[out][v]overlay") == "out v overlay"
    assert fx.escape_code("hflip\nvflip") == "hflip vflip"
    # Commas are legitimate filter separators and must survive.
    assert fx.escape_code("hflip, vflip") == "hflip, vflip"


def test_animation_expressions():
    marquee = fx.animation_exprs("marquee", 10, 20, speed=100)
    assert "t*100" in marquee["x"] and marquee["y"] == "20"
    blink = fx.animation_exprs("blink", 0, 0, speed=2)
    assert "mod(t" in blink["alpha"]
    countdown = fx.animation_exprs("countdown", 5, 5, duration=30)
    assert "text_expr" in countdown and "30" in countdown["text_expr"]
    # Unknown animations fall back to the static position.
    static = fx.animation_exprs("does-not-exist", 3, 4)
    assert static["x"] == "3" and static["y"] == "4" and static["alpha"] == "1"


def test_transition_resolution():
    assert fx.transition_name("cut") is None
    assert fx.transition_name("fade") == "fade"
    assert fx.transition_name("nope") is None
    assert fx.transition_duration("cut", 5) == 0.0
    assert fx.transition_duration("fade", None) == 0.5
    assert fx.transition_duration("fade", 1.2) == 1.2
    # A zero/negative request falls back to the default.
    assert fx.transition_duration("fade", 0) == 0.5


def test_visualizer_chain_shapes():
    for kind in ("spectrum", "wave", "bars", "vectorscope"):
        chain = fx.visualizer_chain(kind, 320, 120, 25)
        assert "s=320x120" in chain and "fps=25" in chain and chain.endswith("format=rgba")
    # Unknown visualisers fall back to the spectrum.
    assert "showspectrum" in fx.visualizer_chain("nope", 10, 10, 25)


# --- engine wiring ---------------------------------------------------------
def _make_playlist(rows: list[dict]) -> int:
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('FX', 1)")
    for pos, row in enumerate(rows):
        db.execute(
            """INSERT INTO playlist_items(playlist_id, media_id, position, duration,
                                          transition, transition_duration,
                                          background_audio_id, background_volume)
               VALUES(?,?,?,?,?,?,?,?)""",
            (
                pid, row.get("media_id"), pos, row.get("duration", 0),
                row.get("transition", "cut"), row.get("transition_duration", 0),
                row.get("background_audio_id"), row.get("background_volume", 0.15),
            ),
        )
    return pid


def test_filter_graph_transition_vs_plain_concat(installed, tmp_path):
    v1, v2 = tmp_path / "a.mp4", tmp_path / "b.mp4"
    _make_video(v1)
    _make_video(v2)
    m1, m2 = _insert_media(v1, "video", 2.0), _insert_media(v2, "video", 2.0)

    # With a transition: xfade/acrossfade and no copy fast path.
    pid = _make_playlist([
        {"media_id": m1},
        {"media_id": m2, "transition": "fade", "transition_duration": 0.5},
    ])
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    assert engine._can_stream_copy(items) is False
    cmd, pipeline = engine._build_command(items, OutputConfig(kind="file", file_path=str(tmp_path / "o.ts")))
    assert pipeline == "filter"
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "xfade=transition=fade" in fc and "acrossfade" in fc

    # Without a transition (and non-uniform clips): a single concat.
    v3 = tmp_path / "c.mp4"
    _make_video(v3, size="640x480")
    m3 = _insert_media(v3, "video", 2.0)
    pid2 = _make_playlist([{"media_id": m1}, {"media_id": m3}])
    items2 = engine._resolve_items(pid2)
    cmd2, _ = engine._build_command(items2, OutputConfig(kind="file", file_path=str(tmp_path / "o2.ts")))
    fc2 = cmd2[cmd2.index("-filter_complex") + 1]
    assert "concat=n=2:v=1:a=0" in fc2 and "xfade" not in fc2


def test_background_music_mixed_with_amix(installed, tmp_path):
    v = tmp_path / "v.mp4"
    aud = tmp_path / "bg.mp3"
    _make_video(v)
    _make_audio(aud)
    mv = _insert_media(v, "video", 2.0)
    mbg = _insert_media(aud, "audio", 3.0)
    pid = _make_playlist([{"media_id": mv, "background_audio_id": mbg, "background_volume": 0.2}])
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    assert items[0]["background_audio_path"]
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(tmp_path / "o.ts")))
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "amix=inputs=2" in fc
    assert "volume=0.200" in fc


def test_media_layer_stretches_to_box(installed, tmp_path):
    # A resized image must fill its box (stretch), so the on-air render matches
    # the editor where dragging an edge stretches that side of the image.
    img = tmp_path / "i.png"
    _make_image(img)
    mid = _insert_media(img, "image", 5.0)
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('Stretch', 1)")
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        ("Stretch", 320, 240, "#000000",
         f'[{{"type":"image","media_id":{mid},"x":10,"y":10,"width":120,"height":90,"z":1}}]'),
    )
    db.execute(
        "INSERT INTO playlist_items(playlist_id, scene_id, position, duration) VALUES(?,?,?,?)",
        (pid, sid, 0, 2.0),
    )
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(tmp_path / "o.ts"), width=320, height=240))
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "scale=120:90" in fc
    # No letterbox padding: the image fills the whole box.
    assert "pad=120:90" not in fc


def test_reactive_layer_adds_visualizer(installed, tmp_path):
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('Viz', 1)")
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        ("Scope", 320, 240, "#101020", '[{"type":"reactive","visualizer":"bars","x":20,"y":20,"width":160,"height":80,"z":1}]'),
    )
    db.execute(
        "INSERT INTO playlist_items(playlist_id, scene_id, position, duration) VALUES(?,?,?,?)",
        (pid, sid, 0, 2.0),
    )
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(tmp_path / "o.ts"), width=320, height=240))
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "showfreqs" in fc and "overlay=20:20" in fc


def test_code_layer_is_escaped_in_graph(installed, tmp_path):
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('Code', 1)")
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        ("Glitch", 320, 240, "#000000", '[{"type":"code","code":"hflip","x":0,"y":0,"z":1}]'),
    )
    db.execute(
        "INSERT INTO playlist_items(playlist_id, scene_id, position, duration) VALUES(?,?,?,?)",
        (pid, sid, 0, 2.0),
    )
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(tmp_path / "o.ts"), width=320, height=240))
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "hflip" in fc


def test_engine_renders_transition_to_file(installed, tmp_path):
    """End-to-end: two clips joined by a fade must decode without error."""
    v1, v2 = tmp_path / "a.mp4", tmp_path / "b.mp4"
    _make_video(v1, seconds=2, freq=440)
    _make_video(v2, seconds=2, freq=660)
    m1, m2 = _insert_media(v1, "video", 2.0), _insert_media(v2, "video", 2.0)
    pid = _make_playlist([
        {"media_id": m1},
        {"media_id": m2, "transition": "fade", "transition_duration": 0.5},
    ])
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    out = tmp_path / "out.ts"
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(out), width=320, height=240, fps=25, realtime=False))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert out.exists() and out.stat().st_size > 0
    from app import probe
    info = probe.probe(out)
    assert info["width"] == 320 and info["height"] == 240
    # 2s + 2s with a 0.5s overlap ≈ 3.5s
    assert 3.0 <= info["duration"] <= 4.2, info["duration"]


def test_fanout_builds_one_output_per_stream(installed, tmp_path):
    v = tmp_path / "v.mp4"
    _make_video(v)
    mv = _insert_media(v, "video", 2.0)
    pid = _make_playlist([{"media_id": mv}])
    db.execute(
        "INSERT INTO streams(name, kind, rtmp_url, stream_key, width, height, enabled) VALUES(?,?,?,?,?,?,1)",
        ("YouTube", "rtmp", "rtmp://a.rtmp.youtube.com/live2", "key-1", 1280, 720),
    )
    db.execute(
        "INSERT INTO streams(name, kind, rtmp_url, stream_key, width, height, enabled) VALUES(?,?,?,?,?,?,1)",
        ("Twitch", "rtmp", "rtmp://live.twitch.tv/app", "key-2", 640, 360),
    )
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    outputs = engine._resolve_outputs(OutputConfig(kind="rtmp", rtmp_url="rtmp://primary/live", stream_key="pk", width=1280, height=720))
    assert len(outputs) == 3  # primary + 2 streams
    cmd, pipeline = engine._build_command(items, OutputConfig(kind="rtmp", rtmp_url="rtmp://primary/live", stream_key="pk"))
    assert pipeline == "filter"
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "split=3" in fc and "asplit=3" in fc
    # One -map pair per output.
    assert cmd.count("-map") == 6


def test_scene_layer_animation_rotation_and_validation(authed):
    scene = {
        "name": "Anime",
        "layers": [
            {"type": "text", "text": "Bienvenue", "x": 10, "y": 10, "z": 1,
             "animation": "marquee", "animation_speed": 120, "rotation": 15},
            {"type": "reactive", "visualizer": "wave", "x": 0, "y": 0, "z": 2},
        ],
    }
    r = authed.post("/api/scenes", json=scene)
    assert r.status_code == 201, r.text
    layers = r.json()["layers"]
    assert layers[0]["animation"] == "marquee" and layers[0]["rotation"] == 15
    assert layers[1]["visualizer"] == "wave"

    # Invalid animation / visualizer are rejected.
    assert authed.post("/api/scenes", json={
        "name": "S", "layers": [{"type": "text", "text": "x", "animation": "explode"}],
    }).status_code == 422
    assert authed.post("/api/scenes", json={
        "name": "S", "layers": [{"type": "reactive", "visualizer": "nope"}],
    }).status_code == 422


def test_version_comparison():
    from app import versioning

    assert versioning.is_newer("2.2.0", "2.1.0") is True
    assert versioning.is_newer("2.1.0", "2.2.0") is False
    assert versioning.is_newer("2.2.0", "2.2.0") is False
    assert versioning.is_newer("v2.10.0", "2.9.9") is True
    assert versioning.is_newer(None, "1.0.0") is False


def test_layer_motion_combines_in_loop_out():
    from app import fx

    motion = fx.layer_motion(10, 20, anim_in="fade", anim_loop="shake", anim_out="fade", duration=8)
    # The loop keeps driving the position...
    assert "sin" in motion["x"]
    # ...and the alphas are multiplied (fade in * fade out).
    assert "*" in motion["alpha"]
    # A static layer has no time dependence.
    static = fx.layer_motion(5, 6)
    assert static == {"x": "5", "y": "6", "alpha": "1"}


def test_new_layer_types_accepted(authed):
    scene = {
        "name": "Rich",
        "layers": [
            {"type": "countdown", "countdown_seconds": 30, "countdown_mode": "down"},
            {"type": "web", "url": "https://example.com/pic.png"},
            {"type": "chat", "chat_source": "twitch", "chat_lines": 6},
            {"type": "text", "text": "Hi", "anim_in": "fade", "anim_loop": "pulse", "anim_out": "fade"},
        ],
    }
    r = authed.post("/api/scenes", json=scene)
    assert r.status_code == 201, r.text
    layers = r.json()["layers"]
    assert layers[0]["type"] == "countdown"
    assert layers[2]["chat_source"] == "twitch"


def test_scene_rejects_bad_animations(authed):
    assert authed.post("/api/scenes", json={
        "name": "S", "layers": [{"type": "text", "text": "x", "anim_in": "explode"}],
    }).status_code == 422
    assert authed.post("/api/scenes", json={
        "name": "S", "layers": [{"type": "text", "text": "x", "anim_loop": "nope"}],
    }).status_code == 422


def test_countdown_render(installed, tmp_path):
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('CD', 1)")
    sid = db.execute(
        "INSERT INTO scenes(name, width, height, background, layers) VALUES(?,?,?,?,?)",
        ("CD", 320, 240, "#101020",
         '[{"type":"countdown","countdown_seconds":90,"countdown_mode":"down","x":20,"y":40,"font_size":60,"color":"#00ff88"}]'),
    )
    db.execute("INSERT INTO playlist_items(playlist_id, scene_id, position, duration) VALUES(?,?,?,?)", (pid, sid, 0, 2.0))
    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    out = tmp_path / "cd.ts"
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(out), width=320, height=240, fps=25, realtime=False))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr[-1500:]
    from app import probe
    info = probe.probe(out)
    assert info["width"] == 320 and info["height"] == 240
