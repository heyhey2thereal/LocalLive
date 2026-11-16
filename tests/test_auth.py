"""Authentication and setup-wizard tests."""
from __future__ import annotations


def test_setup_status_initially_not_installed(client):
    r = client.get("/api/setup/status")
    assert r.status_code == 200
    assert r.json()["installed"] is False


def test_setup_checks_report_tools(client):
    r = client.get("/api/setup/checks")
    assert r.status_code == 200
    data = r.json()
    assert "ffmpeg" in data and "storage" in data and "hardware" in data


def test_full_setup_flow_then_login(client):
    assert client.post(
        "/api/setup/admin", json={"username": "admin", "password": "SuperSecret123"}
    ).status_code == 200
    assert client.post(
        "/api/setup/channel", json={"channel_name": "Ma Chaîne", "timezone": "Europe/Paris"}
    ).status_code == 200
    assert client.post("/api/setup/finish").status_code == 200
    assert client.get("/api/setup/status").json()["installed"] is True

    r = client.post("/api/auth/login", json={"username": "admin", "password": "SuperSecret123"})
    assert r.status_code == 200
    assert r.json()["user"]["is_admin"] is True
    assert client.get("/api/auth/me").status_code == 200


def test_setup_rejects_weak_password(client):
    r = client.post("/api/setup/admin", json={"username": "admin", "password": "short"})
    assert r.status_code == 422


def test_setup_cannot_run_twice(installed):
    r = installed.post("/api/setup/admin", json={"username": "other", "password": "SuperSecret123"})
    assert r.status_code == 409


def test_login_rejects_bad_password(installed):
    r = installed.post("/api/auth/login", json={"username": "admin", "password": "WrongPass123"})
    assert r.status_code == 401


def test_protected_routes_require_auth(installed):
    assert installed.get("/api/auth/me").status_code == 401
    assert installed.get("/api/media").status_code == 401


def test_logout_invalidates_session(authed):
    assert authed.get("/api/auth/me").status_code == 200
    assert authed.post("/api/auth/logout").status_code == 200
    assert authed.get("/api/auth/me").status_code == 401


def test_password_change_and_old_password_rejected(authed):
    r = authed.post(
        "/api/auth/password",
        json={"current_password": "SuperSecret123", "new_password": "BrandNewPass456"},
    )
    assert r.status_code == 200
    authed.post("/api/auth/logout")
    assert authed.post(
        "/api/auth/login", json={"username": "admin", "password": "SuperSecret123"}
    ).status_code == 401
    assert authed.post(
        "/api/auth/login", json={"username": "admin", "password": "BrandNewPass456"}
    ).status_code == 200


def test_password_never_returned_in_api(installed):
    body = installed.get("/api/config").text
    assert "password" not in body.lower()


def test_session_cookie_is_httponly(installed):
    r = installed.post("/api/auth/login", json={"username": "admin", "password": "SuperSecret123"})
    set_cookie = r.headers.get("set-cookie", "")
    assert "httponly" in set_cookie.lower()
