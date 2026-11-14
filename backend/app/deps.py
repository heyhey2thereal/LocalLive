"""FastAPI dependencies: current user, admin guard, setup guard."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from . import config, db, security


def current_user(request: Request) -> dict:
    token = request.cookies.get(config.SESSION_COOKIE)
    user = security.get_session_user(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Non authentifié")
    return user


def admin_user(user: dict = Depends(current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Droits administrateur requis")
    return user


def require_installed() -> None:
    if not db.is_installed():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Installation non terminée")
