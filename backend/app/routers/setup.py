"""First-run setup wizard endpoints."""
from __future__ import annotations

import os
import platform
import shutil
import socket
import subprocess
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from .. import __version__, config, db, probe, security

router = APIRouter(prefix="/api/setup", tags=["setup"])


class AdminPayload(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=256)

    @field_validator("username")
    @classmethod
    def clean_username(cls, v: str) -> str:
        v = v.strip()
        if not v.replace("_", "").replace("-", "").replace(".", "").isalnum():
            raise ValueError("Le nom d'utilisateur contient des caractères invalides.")
        return v


class ChannelPayload(BaseModel):
    channel_name: str = Field(min_length=1, max_length=120)
    timezone: str = Field(default="Europe/Paris", max_length=64)
    language: str = Field(default="fr", max_length=8)


def _local_ips() -> list[str]:
    ips: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None):
            addr = info[4][0]
            if ":" not in addr and not addr.startswith("127."):
                ips.add(addr)
    except socket.gaierror:
        pass
    # Primary route IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    return sorted(ips)


def _check_ffmpeg() -> dict[str, Any]:
    version = probe.ffmpeg_version()
    return {"ok": bool(version), "version": version or "introuvable", "path": shutil.which(config.FFMPEG_BIN) or ""}


def _check_ffprobe() -> dict[str, Any]:
    path = shutil.which(config.FFPROBE_BIN)
    version = None
    if path:
        try:
            out = subprocess.run([config.FFPROBE_BIN, "-version"], capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
            if out.returncode == 0:
                version = out.stdout.splitlines()[0]
        except (subprocess.TimeoutExpired, OSError):
            version = None
    return {"ok": bool(path), "version": version or "introuvable", "path": path or ""}


def _check_storage() -> dict[str, Any]:
    config.ensure_dirs()
    usage = shutil.disk_usage(str(config.DATA_DIR))
    free_gb = usage.free / 1024**3
    return {
        "ok": free_gb >= 1.0,
        "free": usage.free,
        "total": usage.total,
        "free_gb": round(free_gb, 1),
        "path": str(config.DATA_DIR),
        "writable": os.access(config.DATA_DIR, os.W_OK),
    }


def _check_cpu_ram() -> dict[str, Any]:
    cores = os.cpu_count() or 1
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as fh:
            total_kb = 0
            for line in fh:
                if line.startswith("MemTotal"):
                    total_kb = int(line.split()[1])
                    break
        ram_gb = round(total_kb / 1024**2, 1)
    except OSError:
        ram_gb = 0.0
    return {"ok": cores >= 1 and ram_gb >= 1.0, "cores": cores, "ram_gb": ram_gb}


@router.get("/status")
def status_endpoint() -> dict[str, Any]:
    return {
        "installed": db.is_installed(),
        "channel_name": db.get_setting("channel_name"),
        "version": __version__,
    }


@router.get("/checks")
def checks() -> dict[str, Any]:
    """System requirements check used by step 1 of the wizard."""
    results = {
        "ffmpeg": _check_ffmpeg(),
        "ffprobe": _check_ffprobe(),
        "storage": _check_storage(),
        "hardware": _check_cpu_ram(),
        "python": {"ok": True, "version": platform.python_version()},
    }
    results["all_ok"] = all(v.get("ok") for v in results.values() if isinstance(v, dict))
    return results


@router.get("/network")
def network() -> dict[str, Any]:
    ips = _local_ips()
    primary = ips[0] if ips else "127.0.0.1"
    return {
        "ips": ips,
        "hostname": socket.gethostname(),
        "primary": primary,
        "port": config.PORT,
        "url": f"http://{primary}:{config.PORT}",
    }


@router.get("/timezones")
def timezones() -> dict[str, Any]:
    zones: list[str] = []
    try:
        from zoneinfo import available_timezones

        zones = sorted(available_timezones())
    except Exception:
        zones = ["Europe/Paris", "Europe/London", "America/New_York", "UTC"]
    common = ["Europe/Paris", "Europe/London", "Europe/Brussels", "Europe/Zurich", "UTC"]
    return {"timezones": zones, "suggested": "Europe/Paris", "common": common}


@router.post("/admin")
def create_admin(payload: AdminPayload) -> dict[str, Any]:
    if db.is_installed():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="L'application est déjà installée.")
    existing = db.query_one("SELECT id FROM users LIMIT 1")
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Un administrateur existe déjà.")
    try:
        pw_hash = security.hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    user_id = db.execute(
        "INSERT INTO users(username, password_hash, is_admin) VALUES(?, ?, 1)",
        (payload.username, pw_hash),
    )
    return {"ok": True, "user_id": user_id}


@router.post("/channel")
def configure_channel(payload: ChannelPayload) -> dict[str, Any]:
    if db.is_installed():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="L'application est déjà installée.")
    db.set_setting("channel_name", payload.channel_name.strip())
    db.set_setting("timezone", payload.timezone)
    db.set_setting("language", payload.language)
    return {"ok": True}


@router.post("/finish")
def finish(request: Request) -> dict[str, Any]:
    if db.is_installed():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="L'application est déjà installée.")
    user = db.query_one("SELECT id FROM users ORDER BY id LIMIT 1")
    if not user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Créez d'abord un administrateur.")
    if not db.get_setting("channel_name"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Configurez d'abord la chaîne.")

    # Defaults that make the app immediately usable.
    defaults = {
        "stream_width": "1280",
        "stream_height": "720",
        "stream_fps": "25",
        "stream_bitrate": "2500",
        "stream_preset": "veryfast",
        "stream_audio_bitrate": "128",
        "stream_rtmp_url": "rtmp://a.rtmp.youtube.com/live2",
        "stream_key": "",
        "video_format": "mp4",
        "fallback_playlist_id": "",
        "theme": "dark",
    }
    for key, value in defaults.items():
        if db.get_setting(key) is None:
            db.set_setting(key, value)
    if db.get_setting("session_secret") is None:
        db.set_setting("session_secret", security.generate_secret_key())
    db.set_setting("installed", "1")
    db.set_setting("installed_at", datetime.now(timezone.utc).isoformat())

    return {"ok": True, "redirect": "/login"}
