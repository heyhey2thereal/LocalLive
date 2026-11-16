"""Shared pytest fixtures.

Every test run gets an isolated data directory so tests never touch real user
data. The environment variable must be set before the app modules are imported.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

_TMP = Path(tempfile.mkdtemp(prefix="locallive-test-"))
os.environ["LOCALLIVE_DATA"] = str(_TMP)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import config, db, monitor  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture()
def client() -> TestClient:
    # Fresh database per test.
    for suffix in ("", "-wal", "-shm"):
        p = Path(str(config.DB_PATH) + suffix)
        if p.exists():
            p.unlink()
    db._initialised = False
    # The media-size cache is process-wide; clear it so each test sees its own
    # freshly written files.
    monitor._media_cache = None
    db.init_db()
    with TestClient(create_app()) as c:
        yield c


def _do_setup(client: TestClient, username="admin", password="SuperSecret123") -> None:
    client.post("/api/setup/admin", json={"username": username, "password": password})
    client.post("/api/setup/channel", json={"channel_name": "Test TV", "timezone": "Europe/Paris"})
    client.post("/api/setup/finish")


@pytest.fixture()
def installed(client: TestClient) -> TestClient:
    _do_setup(client)
    return client


@pytest.fixture()
def authed(installed: TestClient) -> TestClient:
    r = installed.post("/api/auth/login", json={"username": "admin", "password": "SuperSecret123"})
    assert r.status_code == 200, r.text
    return installed
