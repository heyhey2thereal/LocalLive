"""Authentication: login, logout, session introspection."""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field

from .. import config, db, security
from ..deps import current_user

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Simple in-memory throttle to slow brute-force attempts.
_attempts: dict[str, list[float]] = defaultdict(list)
_WINDOW = 300
_MAX_ATTEMPTS = 10


def _throttle_key(request: Request, username: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}:{username.lower()}"


def _is_throttled(key: str) -> bool:
    now = time.time()
    _attempts[key] = [t for t in _attempts[key] if now - t < _WINDOW]
    return len(_attempts[key]) >= _MAX_ATTEMPTS


class LoginPayload(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class PasswordPayload(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


@router.post("/login")
def login(payload: LoginPayload, request: Request, response: Response) -> dict[str, Any]:
    if not db.is_installed():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Installation non terminée")
    key = _throttle_key(request, payload.username)
    if _is_throttled(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Trop de tentatives. Réessayez dans quelques minutes.",
        )
    user = db.query_one("SELECT * FROM users WHERE username = ?", (payload.username,))
    if not user or not security.verify_password(payload.password, user["password_hash"]):
        _attempts[key].append(time.time())
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Identifiants invalides")
    _attempts.pop(key, None)
    db.execute("UPDATE users SET last_login = datetime('now') WHERE id = ?", (user["id"],))
    token = security.create_session(user["id"])
    response.set_cookie(
        key=config.SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=config.SESSION_TTL_SECONDS,
        path="/",
    )
    return {"ok": True, "user": {"username": user["username"], "is_admin": bool(user["is_admin"])}}


@router.post("/logout")
def logout(request: Request, response: Response) -> dict[str, Any]:
    token = request.cookies.get(config.SESSION_COOKIE)
    security.delete_session(token)
    response.delete_cookie(config.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(current_user)) -> dict[str, Any]:
    return {
        "user": user,
        "channel_name": db.get_setting("channel_name", "LocalLive"),
        "language": db.get_setting("language", "fr"),
        "timezone": db.get_setting("timezone", "Europe/Paris"),
    }


@router.post("/password")
def change_password(
    payload: PasswordPayload, user: dict = Depends(current_user)
) -> dict[str, Any]:
    row = db.query_one("SELECT password_hash FROM users WHERE id = ?", (user["id"],))
    if not row or not security.verify_password(payload.current_password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Mot de passe actuel incorrect")
    try:
        new_hash = security.hash_password(payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (new_hash, user["id"]))
    # Invalidate all sessions for this user; the caller must log in again.
    db.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
    return {"ok": True}
