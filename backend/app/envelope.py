"""Audio loudness envelope for the "reactive to music" layers.

FFmpeg can drive a filter option at runtime through `sendcmd`, but it has no way
to feed an *audio* envelope back into a *video* filter expression inline. To make
a layer genuinely grow when the music gets louder (and shrink when it calms
down), we therefore measure the loudness envelope of the item's audio once, ahead
of time, and turn it into a `sendcmd` script that scales the layer over time.

The envelope is read with `astats` (RMS level in dB per analysis window) and
normalised to a 0..1 factor between a floor and the peak, so a quiet passage
stays near the floor and a loud passage reaches the peak.
"""
from __future__ import annotations

import logging
import re
import subprocess
from pathlib import Path

from . import config

log = logging.getLogger("locallive.envelope")

# astats analyses roughly one window per 1024 samples; keep a sensible default
# in case the metadata does not carry timestamps.
_DEFAULT_WINDOW = 1024.0
_RMS_RE = re.compile(r"lavfi\.astats\.Overall\.RMS_level=(-?[\d.]+|inf|-inf)")
_TIME_RE = re.compile(r"pts_time:([\d.]+)")

# (path, mtime_ns, size) -> normalised envelope. The engine rebuilds the filter
# graph on every restart, so caching avoids re-running astats each time.
_CACHE: dict[tuple[str, int, int], list[tuple[float, float]]] = {}


def _run_astats(path: str, timeout: int = 60) -> list[tuple[float, float]]:
    """Return [(seconds, rms_db)] for `path`, or [] on failure.

    `ametadata=print` writes the RMS level with its timestamp to a file (it goes
    through the FFmpeg log otherwise, which a quiet run would drop), so we read it
    back — this is exact and needs no guessing about the analysis window size.
    """
    import tempfile

    tmp = tempfile.NamedTemporaryFile(prefix="locallive-env-", suffix=".txt", delete=False)
    tmp.close()
    cmd = [
        config.FFMPEG_BIN, "-hide_banner", "-nostats", "-v", "error",
        "-i", path,
        "-af",
        f"astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file={tmp.name}",
        "-f", "null", "-",
    ]
    try:
        subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        try:
            content = Path(tmp.name).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return []
    except (subprocess.TimeoutExpired, OSError) as exc:
        log.debug("astats a échoué sur %s : %s", path, exc)
        return []
    finally:
        try:
            Path(tmp.name).unlink(missing_ok=True)
        except OSError:
            pass
    points: list[tuple[float, float]] = []
    current_t: float | None = None
    for line in content.splitlines():
        line = line.strip()
        if line.startswith("frame:"):
            m = _TIME_RE.search(line)
            current_t = float(m.group(1)) if m else None
            continue
        m = _RMS_RE.search(line)
        if m:
            raw = m.group(1)
            try:
                value = float(raw)
            except ValueError:
                # "-inf"/"inf": silence or clipping; treat as the quiet floor.
                value = -120.0 if raw.startswith("-") else 0.0
            if current_t is None:
                # No timestamp: assume the default analysis window.
                current_t = len(points) * (_DEFAULT_WINDOW / 48000.0)
            points.append((current_t, value))
    return points


def loudness_envelope(
    path: str | Path,
    *,
    max_points: int = 600,
) -> list[tuple[float, float]]:
    """Normalised [(seconds, 0..1)] loudness envelope of an audio/video file.

    Returns [] when the file has no usable audio. The values are the loudness
    mapped linearly from the 10th percentile (floor) to the 98th percentile
    (peak), so a couple of outliers do not flatten the whole curve. The result is
    cached per (path, mtime) because the engine rebuilds the filter graph on every
    restart and re-running astats each time would be wasteful on the target host.
    """
    p = Path(path)
    if not p.exists():
        return []
    try:
        stat = p.stat()
        cache_key = (str(p), stat.st_mtime_ns, stat.st_size)
    except OSError:
        cache_key = None
    if cache_key is not None and cache_key in _CACHE:
        return _CACHE[cache_key]
    result = _compute_envelope(str(p), max_points=max_points)
    if cache_key is not None:
        _CACHE[cache_key] = result
        # Keep the cache small (a handful of tracks is plenty).
        if len(_CACHE) > 32:
            _CACHE.pop(next(iter(_CACHE)))
    return result


def _compute_envelope(path: str, *, max_points: int) -> list[tuple[float, float]]:
    raw = _run_astats(path)
    if len(raw) < 2:
        return []
    # Drop non-finite values.
    raw = [(t, v) for t, v in raw if v == v and abs(v) < 1000]
    if len(raw) < 2:
        return []
    values = sorted(v for _, v in raw)
    floor = values[int(len(values) * 0.10)]
    peak = values[max(0, int(len(values) * 0.98) - 1)]
    if peak - floor < 3.0:
        # Almost no dynamic range: keep a gentle response rather than a flat line.
        peak = floor + 6.0
    span = max(peak - floor, 1.0)
    points = [(t, max(0.0, min(1.0, (v - floor) / span))) for t, v in raw]
    # Downsample for the sendcmd script (a few hundred points is plenty).
    if len(points) > max_points:
        step = len(points) / max_points
        points = [points[min(int(i * step), len(points) - 1)] for i in range(max_points)]
    return points
