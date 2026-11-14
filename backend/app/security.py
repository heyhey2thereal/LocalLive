"""Authentication primitives: password hashing and session tokens.

Uses only the standard library so there is no native build step. Password
hashing is scrypt (memory-hard) which is available in hashlib on any modern
CPython. Tokens are random 256-bit values; only a SHA-256 digest is stored.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from . import config, db

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_DKLEN = 32


def hash_password(password: str) -> str:
    if not password or len(password) < 8:
        raise ValueError("Le mot de passe doit contenir au moins 8 caractères.")
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_DKLEN,
    )
    return "scrypt${}${}${}${}".format(
        _SCRYPT_N,
        _SCRYPT_R,
        _SCRYPT_P,
        base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, rest = stored.split("$", 4)
        if scheme != "scrypt":
            return False
        salt_b64, hash_b64 = rest.split("$", 1)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        dk = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(seconds=config.SESSION_TTL_SECONDS)
    db.execute(
        "INSERT INTO sessions(token, user_id, expires_at) VALUES(?, ?, ?)",
        (_hash_token(token), user_id, expires.strftime("%Y-%m-%d %H:%M:%S")),
    )
    return token


def get_session_user(token: str | None):
    if not token:
        return None
    row = db.query_one(
        "SELECT s.expires_at, u.id, u.username, u.is_admin, u.last_login "
        "FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ?",
        (_hash_token(token),),
    )
    if not row:
        return None
    try:
        expires = datetime.strptime(row["expires_at"], "%Y-%m-%d %H:%M:%S").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        return None
    if expires < datetime.now(timezone.utc):
        delete_session(token)
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "is_admin": bool(row["is_admin"]),
        "last_login": row["last_login"],
    }


def delete_session(token: str | None) -> None:
    if not token:
        return
    db.execute("DELETE FROM sessions WHERE token = ?", (_hash_token(token),))


def purge_expired_sessions() -> None:
    db.execute("DELETE FROM sessions WHERE expires_at < datetime('now')")


def generate_secret_key(n: int = 32) -> str:
    return secrets.token_urlsafe(n)


def mask_secret(value: str | None, keep: int = 4) -> str:
    """Never expose a full stream key — show only a short suffix."""
    if not value:
        return ""
    if len(value) <= keep:
        return "•" * len(value)
    return "•" * (len(value) - keep) + value[-keep:]
