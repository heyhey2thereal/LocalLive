"""Scheduling: daily/weekly programs with automatic playlist switching."""
from __future__ import annotations

import json
import re
from datetime import datetime, time
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..deps import current_user, require, require_installed
from .. import permissions

router = APIRouter(prefix="/api/schedules", tags=["schedules"])

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class SchedulePayload(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    playlist_id: int | None = None
    days: list[int] = Field(default_factory=lambda: list(range(7)))
    start_time: str
    end_time: str
    enabled: bool = True

    @field_validator("days")
    @classmethod
    def valid_days(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("Sélectionnez au moins un jour")
        for d in v:
            if d < 0 or d > 6:
                raise ValueError("Jour invalide (0-6)")
        return sorted(set(v))

    @field_validator("start_time", "end_time")
    @classmethod
    def valid_time(cls, v: str) -> str:
        if not _TIME_RE.match(v):
            raise ValueError("Format d'heure invalide (HH:MM)")
        return v


def _schedule_dict(row) -> dict[str, Any]:
    d = dict(row)
    try:
        d["days"] = json.loads(d["days"])
    except (json.JSONDecodeError, TypeError):
        d["days"] = []
    d["enabled"] = bool(d["enabled"])
    return d


@router.get("")
def list_schedules(user: dict = Depends(current_user)) -> dict[str, Any]:
    require_installed()
    rows = db.query("SELECT * FROM schedules ORDER BY start_time")
    return {"items": [_schedule_dict(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_schedule(payload: SchedulePayload, user: dict = Depends(require(permissions.CAP_SCHEDULE))) -> dict[str, Any]:
    if payload.playlist_id is not None and not db.query_one(
        "SELECT id FROM playlists WHERE id = ?", (payload.playlist_id,)
    ):
        raise HTTPException(status_code=404, detail="Playlist introuvable")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Le nom est requis")
    sid = db.execute(
        "INSERT INTO schedules(name, playlist_id, days, start_time, end_time, enabled) VALUES(?,?,?,?,?,?)",
        (
            name,
            payload.playlist_id,
            json.dumps(payload.days),
            payload.start_time,
            payload.end_time,
            1 if payload.enabled else 0,
        ),
    )
    return _schedule_dict(db.query_one("SELECT * FROM schedules WHERE id = ?", (sid,)))


@router.put("/{schedule_id}")
def update_schedule(
    schedule_id: int, payload: SchedulePayload, user: dict = Depends(require(permissions.CAP_SCHEDULE))
) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM schedules WHERE id = ?", (schedule_id,)):
        raise HTTPException(status_code=404, detail="Programme introuvable")
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Le nom est requis")
    db.execute(
        "UPDATE schedules SET name=?, playlist_id=?, days=?, start_time=?, end_time=?, enabled=? WHERE id=?",
        (
            name,
            payload.playlist_id,
            json.dumps(payload.days),
            payload.start_time,
            payload.end_time,
            1 if payload.enabled else 0,
            schedule_id,
        ),
    )
    return _schedule_dict(db.query_one("SELECT * FROM schedules WHERE id = ?", (schedule_id,)))


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: int, user: dict = Depends(require(permissions.CAP_SCHEDULE))) -> dict[str, Any]:
    if not db.query_one("SELECT id FROM schedules WHERE id = ?", (schedule_id,)):
        raise HTTPException(status_code=404, detail="Programme introuvable")
    db.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
    return {"ok": True}


def active_playlist_id(now: datetime | None = None) -> int | None:
    """Return the playlist id that should be live right now (or None)."""
    tz_name = db.get_setting("timezone", "Europe/Paris") or "Europe/Paris"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")
    now = (now or datetime.now(tz)).astimezone(tz)
    weekday = now.weekday()  # Monday = 0
    current = now.time()
    for row in db.query("SELECT * FROM schedules WHERE enabled = 1 ORDER BY start_time"):
        try:
            days = json.loads(row["days"])
        except (json.JSONDecodeError, TypeError):
            continue
        try:
            start = time.fromisoformat(row["start_time"])
            end = time.fromisoformat(row["end_time"])
        except ValueError:
            continue
        if start <= end:
            # Same-day window: it runs on the listed days.
            if weekday in days and start <= current < end:
                return row["playlist_id"]
        else:
            # Overnight window (start > end): the part before midnight belongs to
            # the listed day, the part after midnight to the *next* day. Without
            # this the early-morning hours were never matched.
            previous_day = (weekday - 1) % 7
            if weekday in days and current >= start:
                return row["playlist_id"]
            if previous_day in days and current < end:
                return row["playlist_id"]
    fallback = db.get_setting("fallback_playlist_id")
    # A stored "0" (or empty) means "no fallback" — never a playlist id.
    return int(fallback) if fallback and int(fallback) > 0 else None


@router.get("/current")
def current_program(user: dict = Depends(current_user)) -> dict[str, Any]:
    from ..engine import get_engine

    return get_engine().status()
