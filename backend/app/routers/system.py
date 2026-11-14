"""System monitoring: metrics, logs, health for the dashboard."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from .. import __version__, config, db, monitor, permissions
from ..deps import current_user, require

router = APIRouter(prefix="/api/system", tags=["system"])

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
