"""System monitoring: metrics, logs, health for the dashboard."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from .. import config, db, monitor
from ..deps import admin_user, current_user

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/metrics")
def metrics(user: dict = Depends(current_user)) -> dict[str, Any]:
    snap = monitor.snapshot()
    snap["storage"] = {
        "media": monitor.media_usage()["media"],
        "db": db.db_size(),
    }
    return snap


@router.get("/logs")
def logs(lines: int = 100, user: dict = Depends(admin_user)) -> dict[str, Any]:
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
