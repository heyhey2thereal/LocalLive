"""User management: create, edit, delete users and assign roles/permissions."""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from .. import db, permissions, security
from ..deps import require

router = APIRouter(prefix="/api/users", tags=["users"])

VALID_ROLES = set(permissions.ROLE_CAPABILITIES)


class UserPayload(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str | None = Field(default=None, max_length=256)
    role: str = "viewer"
    permissions: list[str] = Field(default_factory=list)

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in VALID_ROLES:
            raise ValueError(f"Rôle invalide : {v}")
        return v

    @field_validator("permissions")
    @classmethod
    def valid_permissions(cls, v: list[str]) -> list[str]:
        bad = [p for p in v if p not in permissions.ALL_CAPABILITIES]
        if bad:
            raise ValueError(f"Droit inconnu : {', '.join(bad)}")
        return v


def _user_dict(row) -> dict[str, Any]:
    role = row["role"] or ("admin" if row["is_admin"] else "viewer")
    return {
        "id": row["id"],
        "username": row["username"],
        "role": role,
        "is_admin": bool(row["is_admin"]),
        "permissions": permissions.capabilities_for(role, row["permissions"]),
        "created_at": row["created_at"],
        "last_login": row["last_login"],
    }


def _admin_count() -> int:
    row = db.query_one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
    return int(row["n"]) if row else 0


@router.get("")
def list_users(user: dict = Depends(require(permissions.CAP_USERS))) -> dict[str, Any]:
    rows = db.query("SELECT * FROM users ORDER BY username")
    return {"items": [_user_dict(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserPayload, user: dict = Depends(require(permissions.CAP_USERS))
) -> dict[str, Any]:
    if not payload.password:
        raise HTTPException(status_code=422, detail="Un mot de passe est requis")
    username = payload.username.strip()
    if db.query_one("SELECT id FROM users WHERE username = ?", (username,)):
        raise HTTPException(status_code=409, detail="Ce nom d'utilisateur existe déjà")
    try:
        pw_hash = security.hash_password(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    uid = db.execute(
        "INSERT INTO users(username, password_hash, is_admin, role, permissions) VALUES(?,?,?,?,?)",
        (
            username,
            pw_hash,
            1 if payload.role == "admin" else 0,
            payload.role,
            json.dumps(payload.permissions),
        ),
    )
    return _user_dict(db.query_one("SELECT * FROM users WHERE id = ?", (uid,)))


@router.patch("/{user_id}")
def update_user(
    user_id: int, payload: UserPayload, user: dict = Depends(require(permissions.CAP_USERS))
) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    current_role = row["role"] or ("admin" if row["is_admin"] else "viewer")
    if current_role == "admin" and payload.role != "admin" and _admin_count() <= 1:
        raise HTTPException(status_code=409, detail="Impossible de rétrograder le dernier administrateur")
    # A rename onto an existing username would violate the UNIQUE index and
    # surface as a 500; report it cleanly instead.
    username = payload.username.strip()
    clash = db.query_one("SELECT id FROM users WHERE username = ? AND id != ?", (username, user_id))
    if clash:
        raise HTTPException(status_code=409, detail="Ce nom d'utilisateur existe déjà")
    db.execute(
        "UPDATE users SET username = ?, role = ?, is_admin = ?, permissions = ? WHERE id = ?",
        (
            username,
            payload.role,
            1 if payload.role == "admin" else 0,
            json.dumps(payload.permissions),
            user_id,
        ),
    )
    if payload.password:
        try:
            pw_hash = security.hash_password(payload.password)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
        db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pw_hash, user_id))
        db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
    return _user_dict(db.query_one("SELECT * FROM users WHERE id = ?", (user_id,)))


@router.delete("/{user_id}")
def delete_user(user_id: int, user: dict = Depends(require(permissions.CAP_USERS))) -> dict[str, Any]:
    row = db.query_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if user_id == user["id"]:
        raise HTTPException(status_code=409, detail="Vous ne pouvez pas supprimer votre propre compte")
    current_role = row["role"] or ("admin" if row["is_admin"] else "viewer")
    if current_role == "admin" and _admin_count() <= 1:
        raise HTTPException(status_code=409, detail="Impossible de supprimer le dernier administrateur")
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    return {"ok": True}
