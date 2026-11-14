"""Playback engine tests: command building and real FFmpeg execution."""
from __future__ import annotations

import subprocess
import time
from pathlib import Path

import pytest

from app import config, db
from app.engine import OutputConfig, PlaybackEngine, _hex_to_ffmpeg, _escape_drawtext


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


def _make_image(path: Path):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", "color=c=blue:size=320x240:duration=1", "-frames:v", "1", str(path)],
        check=True, timeout=60,
    )


def _make_audio(path: Path, seconds=2):
    subprocess.run(
        [config.FFMPEG_BIN, "-y", "-v", "error", "-f", "lavfi",
         "-i", f"sine=frequency=300:duration={seconds}", str(path)],
        check=True, timeout=60,
    )


def test_hex_and_escape_helpers():
    assert _hex_to_ffmpeg("#ff0000") == "0xff0000"
    assert _hex_to_ffmpeg("fff") == "0xffffff"
    assert _hex_to_ffmpeg("bogus") == "0x000000"
    assert _escape_drawtext("a:b") == "a\\:b"


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


def _make_playlist(media_ids: list[tuple[int, float]]) -> int:
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('Test', 1)")
    for pos, (mid, dur) in enumerate(media_ids):
        db.execute(
            "INSERT INTO playlist_items(playlist_id, media_id, position, duration) VALUES(?,?,?,?)",
            (pid, mid, pos, dur),
        )
    return pid


def test_copy_command_used_for_uniform_videos(installed, tmp_path):
    v1, v2 = tmp_path / "u1.mp4", tmp_path / "u2.mp4"
    _make_video(v1)
    _make_video(v2)
    m1, m2 = _insert_media(v1, "video", 2.0), _insert_media(v2, "video", 2.0)
    pid = _make_playlist([(m1, 0), (m2, 0)])

    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    # Both files share codec/res/fps -> stream copy fast path.
    assert engine._can_stream_copy(items) is True
    cmd = engine._build_copy_command(items, OutputConfig(kind="file", file_path=str(tmp_path / "o.ts")))
    assert "-c" in cmd and "copy" in cmd


def test_filter_command_for_mixed_media(installed, tmp_path):
    v = tmp_path / "v.mp4"
    img = tmp_path / "i.png"
    aud = tmp_path / "a.mp3"
    _make_video(v, size="640x480")
    _make_image(img)
    _make_audio(aud)
    mv = _insert_media(v, "video", 2.0)
    mi = _insert_media(img, "image", 5.0)
    ma = _insert_media(aud, "audio", 2.0)
    pid = _make_playlist([(mv, 0), (mi, 5.0), (ma, 2.0)])

    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    assert engine._can_stream_copy(items) is False
    cmd, pipeline = engine._build_command(items, OutputConfig(kind="file", width=640, height=480))
    assert pipeline == "filter"
    fc = cmd[cmd.index("-filter_complex") + 1]
    assert "concat=n=3" in fc
    assert "scale=640:480" in fc


def test_engine_renders_mixed_playlist_to_file(installed, tmp_path):
    """End-to-end: run ffmpeg on a mixed playlist and verify the output duration."""
    v = tmp_path / "v.mp4"
    img = tmp_path / "i.png"
    aud = tmp_path / "a.mp3"
    _make_video(v, seconds=2)
    _make_image(img)
    _make_audio(aud, seconds=2)
    mv = _insert_media(v, "video", 2.0)
    mi = _insert_media(img, "image", 5.0)
    ma = _insert_media(aud, "audio", 2.0)
    pid = _make_playlist([(mv, 0), (mi, 3.0), (ma, 2.0)])

    engine = PlaybackEngine()
    items = engine._resolve_items(pid)
    out = tmp_path / "out.ts"
    cmd, _ = engine._build_command(items, OutputConfig(kind="file", file_path=str(out), width=320, height=240, fps=25, realtime=False))
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert out.exists() and out.stat().st_size > 0

    # Probe the produced stream.
    from app import probe
    info = probe.probe(out)
    assert info["width"] == 320 and info["height"] == 240
    assert info["has_audio"] == 1
    # 2s video + 3s image + 2s audio ≈ 7s
    assert 6.0 <= info["duration"] <= 8.5, info["duration"]


def test_engine_start_stop_file_output(installed, tmp_path):
    v = tmp_path / "v.mp4"
    _make_video(v, seconds=1)
    mv = _insert_media(v, "video", 1.0)
    pid = _make_playlist([(mv, 0)])

    engine = PlaybackEngine()
    out = tmp_path / "live.ts"
    res = engine.start(pid, {"output_kind": "file", "output_file": str(out), "stream_width": "320", "stream_height": "240"})
    assert res["ok"], res
    time.sleep(1.5)
    status = engine.status()
    assert status["running"] is True
    assert status["pipeline"] in ("copy", "filter")
    engine.stop()
    assert engine.status()["running"] is False


def test_engine_rejects_empty_playlist(installed):
    pid = db.execute("INSERT INTO playlists(name, loop) VALUES('Vide', 1)")
    engine = PlaybackEngine()
    res = engine.start(pid, {"output_kind": "file"})
    assert res["ok"] is False
    assert "vide" in res["error"].lower()


def test_engine_loop_restarts(installed, tmp_path):
    v = tmp_path / "v.mp4"
    _make_video(v, seconds=1)
    mv = _insert_media(v, "video", 1.0)
    pid = _make_playlist([(mv, 0)])
    engine = PlaybackEngine()
    out = tmp_path / "loop.ts"
    engine.start(pid, {"output_kind": "file", "output_file": str(out), "stream_width": "320", "stream_height": "240"})
    time.sleep(3.5)  # enough for at least one loop restart
    status = engine.status()
    assert status["restarts"] >= 1
    engine.stop()
