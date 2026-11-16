"""FastAPI dependencies: current user, permission guards, setup guard."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from . import config, db, permissions, security


def current_user(request: Request) -> dict:
    token = request.cookies.get(config.SESSION_COOKIE)
    user = security.get_session_user(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Non authentifié")
    return user


def require(capability: str):
    """Dependency factory: allow the request only if the user holds the capability."""
    def _guard(user: dict = Depends(current_user)) -> dict:
        if not permissions.has(user, capability):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Droit requis : {capability}",
            )
        return user

    return _guard


# Kept for the historical call sites: an admin holds every capability.
def admin_user(user: dict = Depends(current_user)) -> dict:
    if not permissions.has(user, permissions.CAP_USERS):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Droits administrateur requis")
    return user


def require_installed() -> None:
    if not db.is_installed():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Installation non terminée")
