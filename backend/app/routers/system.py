"""System monitoring: metrics, logs, health for the dashboard."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

import shlex
import subprocess

from .. import __version__, config, db, monitor, permissions, versioning
from ..deps import current_user, require

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/update/check")
def update_check(user: dict = Depends(current_user)) -> dict[str, Any]:
    """Compare the running version with the latest published tag.

    `update_repo` (setting) is an optional "owner/repo"; when set, the latest
    release tag is read from the public GitHub API. Without it we simply report
    the running version and that no source is configured.
    """
    repo = db.get_setting("update_repo", "") or ""
    latest = None
    if repo:
        import json
        import urllib.request

        try:
            req = urllib.request.Request(
                f"https://api.github.com/repos/{repo}/releases/latest",
                headers={"User-Agent": "LocalLive", "Accept": "application/vnd.github+json"},
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                latest = (json.load(resp).get("tag_name") or "").lstrip("v") or None
        except Exception:
            latest = None
    # Only offer an update when the published version is genuinely newer, so the
    # UI never nags when everything is already up to date.
    available = versioning.is_newer(latest, __version__)
    return {"current": __version__, "latest": latest, "update_available": available, "repo": repo}


@router.post("/update")
def update(user: dict = Depends(require(permissions.CAP_SETTINGS))) -> dict[str, Any]:
    """Trigger the host update command if one is configured.

    The service usually runs as an unprivileged user, so it cannot update itself.
    The admin can set `update_command` (e.g. `sudo /opt/locallive/update.sh`) via
    the settings; when it is empty we return a manual hint instead.
    """
    command = (db.get_setting("update_command", "") or "").strip()
    if not command:
        return {
            "ok": False,
            "manual": True,
            "hint": "Aucune commande de mise à jour configurée. Lancez update.sh sur le serveur.",
        }
    try:
        proc = subprocess.run(
            shlex.split(command),
            capture_output=True,
            text=True,
            timeout=600,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "Délai dépassé pendant la mise à jour"}
    if proc.returncode == 0:
        return {"ok": True, "output": (proc.stdout or "")[-2000:]}
    return {"ok": False, "error": (proc.stderr or proc.stdout or "Échec de la mise à jour")[-2000:]}

@router.get("/version")
def version_info(user: dict = Depends(current_user)) -> dict[str, Any]:
    # The changelog sits next to the app (APP_DIR/CHANGELOG.md); FRONTEND_DIST is
    # APP_DIR/frontend/dist, so its grandparent is the app root.
    candidates = [
        config.FRONTEND_DIST.parent.parent / "CHANGELOG.md",
        config.DATA_DIR.parent / "CHANGELOG.md",
    ]
    changelog = ""
    for candidate in candidates:
        if candidate.exists():
            changelog = candidate.read_text(encoding="utf-8", errors="replace")
            break
    return {"version": __version__, "changelog": changelog}


@router.get("/metrics")
def metrics(user: dict = Depends(current_user)) -> dict[str, Any]:
    snap = monitor.snapshot()
    snap["storage"] = {
        "media": monitor.media_usage()["media"],
        "db": db.db_size(),
    }
    return snap


@router.get("/logs")
def logs(lines: int = 100, user: dict = Depends(require(permissions.CAP_SETTINGS))) -> dict[str, Any]:
    lines = max(1, min(lines, 500))
    path = config.LOGS_DIR / "locallive.log"
    if not path.exists():
        return {"lines": []}
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            content = fh.readlines()
        return {"lines": [ln.rstrip("\n") for ln in content[-lines:]]}
    except OSError:
        return {"lines": []}
