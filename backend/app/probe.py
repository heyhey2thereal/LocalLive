"""FFprobe / thumbnail helpers.

All calls use subprocess with a hard timeout and never load media into the
Python process — ffmpeg/ffprobe stream the data themselves.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from . import config

VIDEO_EXT = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v", ".ts", ".mpg", ".mpeg", ".flv", ".wmv"}
AUDIO_EXT = {".mp3", ".aac", ".wav", ".flac", ".ogg", ".m4a", ".opus", ".wma"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".tiff"}


def kind_for_ext(ext: str) -> str | None:
    ext = ext.lower()
    if ext in VIDEO_EXT:
        return "video"
    if ext in AUDIO_EXT:
        return "audio"
    if ext in IMAGE_EXT:
        return "image"
    return None


def _ratio(value: str | None) -> float | None:
    if not value or value in ("0/0", "N/A"):
        return None
    try:
        if "/" in value:
            num, den = value.split("/")
            den_f = float(den)
            return round(float(num) / den_f, 3) if den_f else None
        return round(float(value), 3)
    except (ValueError, ZeroDivisionError):
        return None


def probe(path: str | Path) -> dict[str, Any]:
    """Return normalised metadata for a media file."""
    result: dict[str, Any] = {
        "duration": 0.0,
        "width": None,
        "height": None,
        "fps": None,
        "video_codec": None,
        "audio_codec": None,
        "bitrate": None,
        "has_audio": 0,
        "has_video": 0,
    }
    try:
        proc = subprocess.run(
            [
                config.FFPROBE_BIN,
                "-v", "error",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=60,
            stdin=subprocess.DEVNULL,
        )
    except (subprocess.TimeoutExpired, OSError):
        return result
    if proc.returncode != 0:
        return result
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return result

    fmt = data.get("format", {})
    try:
        result["duration"] = round(float(fmt.get("duration", 0) or 0), 3)
    except (TypeError, ValueError):
        result["duration"] = 0.0
    try:
        result["bitrate"] = int(float(fmt.get("bit_rate", 0) or 0)) or None
    except (TypeError, ValueError):
        result["bitrate"] = None

    for stream in data.get("streams", []):
        codec_type = stream.get("codec_type")
        if codec_type == "video" and not result["has_video"]:
            result["has_video"] = 1
            result["width"] = stream.get("width")
            result["height"] = stream.get("height")
            result["video_codec"] = stream.get("codec_name")
            result["fps"] = _ratio(stream.get("avg_frame_rate") or stream.get("r_frame_rate"))
            if not result["duration"]:
                try:
                    result["duration"] = round(float(stream.get("duration", 0) or 0), 3)
                except (TypeError, ValueError):
                    pass
        elif codec_type == "audio":
            result["has_audio"] = 1
            if not result["audio_codec"]:
                result["audio_codec"] = stream.get("codec_name")
    return result


def make_thumbnail(src: str | Path, dest: str | Path, kind: str, duration: float) -> bool:
    """Extract a single frame (video/image) or a waveform-free still (audio)."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if kind == "audio":
        cmd = [
            config.FFMPEG_BIN, "-y", "-v", "error",
            "-i", str(src),
            "-an",
            "-vf", "scale=320:-1:flags=fast_bilinear",
            "-frames:v", "1",
            str(dest),
        ]
    else:
        # Seek ~1s in (or 10% for short clips) so we don't grab a black frame.
        seek = "0" if duration <= 0 else str(min(max(duration * 0.1, 0), 5))
        cmd = [
            config.FFMPEG_BIN, "-y", "-v", "error",
            "-ss", seek,
            "-i", str(src),
            "-vf", "scale=320:-1:flags=fast_bilinear",
            "-frames:v", "1",
            str(dest),
        ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=60, stdin=subprocess.DEVNULL)
        return proc.returncode == 0 and dest.exists() and dest.stat().st_size > 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def ffmpeg_version() -> str | None:
    try:
        proc = subprocess.run(
            [config.FFMPEG_BIN, "-version"], capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL
        )
        if proc.returncode == 0:
            return proc.stdout.splitlines()[0]
    except (subprocess.TimeoutExpired, OSError):
        pass
    return None
