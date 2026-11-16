"""Lightweight system metrics read straight from /proc and statvfs.

No psutil dependency: reading a few /proc files costs nothing and keeps the
container footprint minimal on the 2-core target host.
"""
from __future__ import annotations

import os
import shutil
import time

from . import config

_last_cpu: tuple[float, float] | None = None  # (total_jiffies, idle_jiffies)


def _read_cpu_jiffies() -> tuple[float, float]:
    with open("/proc/stat", "r", encoding="utf-8") as fh:
        first = fh.readline()
    parts = first.split()
    values = [float(v) for v in parts[1:]]
    idle = values[3] + (values[4] if len(values) > 4 else 0.0)
    total = sum(values)
    return total, idle


def cpu_percent() -> float:
    """CPU utilisation since the previous call (0-100), normalised to host cores."""
    global _last_cpu
    total, idle = _read_cpu_jiffies()
    if _last_cpu is None:
        _last_cpu = (total, idle)
        time.sleep(0.05)
        total, idle = _read_cpu_jiffies()
    prev_total, prev_idle = _last_cpu
    _last_cpu = (total, idle)
    delta_total = total - prev_total
    delta_idle = idle - prev_idle
    if delta_total <= 0:
        return 0.0
    cores = os.cpu_count() or 1
    busy = (delta_total - delta_idle) / delta_total * 100.0
    return round(min(busy, 100.0 * cores) / cores, 1)


def memory() -> dict:
    info: dict[str, int] = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as fh:
        for line in fh:
            key, _, rest = line.partition(":")
            info[key.strip()] = int(rest.split()[0]) * 1024
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", info.get("MemFree", 0))
    used = max(total - available, 0)
    return {
        "total": total,
        "used": used,
        "available": available,
        "percent": round(used / total * 100, 1) if total else 0.0,
    }


def load_average() -> list[float]:
    try:
        return [round(x, 2) for x in os.getloadavg()]
    except OSError:
        return [0.0, 0.0, 0.0]


def _dir_size(path: str, limit: int = 200000) -> int:
    total = 0
    count = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
            count += 1
            if count > limit:
                return total
    return total


def disk() -> dict:
    usage = shutil.disk_usage(str(config.DATA_DIR))
    return {
        "total": usage.total,
        "used": usage.used,
        "free": usage.free,
        "percent": round(usage.used / usage.total * 100, 1) if usage.total else 0.0,
    }


_media_cache: tuple[float, dict] | None = None
_MEDIA_CACHE_TTL = 30.0


def media_usage() -> dict:
    """Size of the media and thumbnail directories.

    Walking the media tree can be slow on a large library, and the result barely
    moves between two polls, so it is cached for 30 seconds.
    """
    global _media_cache
    now = time.monotonic()
    if _media_cache and now - _media_cache[0] < _MEDIA_CACHE_TTL:
        return _media_cache[1]
    value = {
        "media": _dir_size(str(config.MEDIA_DIR)),
        "thumbnails": _dir_size(str(config.THUMBS_DIR)),
    }
    _media_cache = (now, value)
    return value


def uptime_seconds() -> float:
    try:
        with open("/proc/uptime", "r", encoding="utf-8") as fh:
            return float(fh.readline().split()[0])
    except OSError:
        return 0.0


def snapshot() -> dict:
    return {
        "cpu": cpu_percent(),
        "cpu_count": os.cpu_count() or 1,
        "memory": memory(),
        "disk": disk(),
        "load": load_average(),
        "uptime": uptime_seconds(),
    }
