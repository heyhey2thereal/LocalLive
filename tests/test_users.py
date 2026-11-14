"""User management and permissions tests."""
from __future__ import annotations


def _login(client, username, password):
    return client.post("/api/auth/login", json={"username": username, "password": password})


def test_list_users_requires_admin(installed):
    assert installed.get("/api/users").status_code == 401


def test_admin_can_list_and_create_users(authed):
    data = authed.get("/api/users").json()
    assert any(u["username"] == "admin" and u["role"] == "admin" for u in data["items"])
    r = authed.post("/api/users", json={"username": "op", "password": "OperatorPass1", "role": "operator"})
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "operator"
    assert "view" in r.json()["permissions"] and "users" not in r.json()["permissions"]


def test_create_user_requires_password(authed):
    r = authed.post("/api/users", json={"username": "nopw", "role": "viewer"})
    assert r.status_code == 422


def test_duplicate_username_rejected(authed):
    authed.post("/api/users", json={"username": "dup", "password": "Password123", "role": "viewer"})
    r = authed.post("/api/users", json={"username": "dup", "password": "Password123", "role": "viewer"})
    assert r.status_code == 409


def test_invalid_role_rejected(authed):
    r = authed.post("/api/users", json={"username": "x", "password": "Password123", "role": "root"})
    assert r.status_code == 422


def test_invalid_capability_rejected(authed):
    r = authed.post("/api/users", json={
        "username": "x", "password": "Password123", "role": "viewer", "permissions": ["nonsense"],
    })
    assert r.status_code == 422


def test_operator_cannot_manage_users(authed):
    authed.post("/api/users", json={"username": "op", "password": "OperatorPass1", "role": "operator"})
    client = authed
    _login(client, "op", "OperatorPass1")
    assert client.get("/api/users").status_code == 403
    # An operator can still read dashboards.
    assert client.get("/api/broadcast/status").status_code == 200


def test_viewer_cannot_manage_media(authed):
    authed.post("/api/users", json={"username": "view", "password": "ViewerPass1", "role": "viewer"})
    client = authed
    _login(client, "view", "ViewerPass1")
    # Viewers may read the media library but not delete/upload.
    assert client.get("/api/media").status_code == 200
    assert client.delete("/api/media/9999").status_code == 403


def test_extra_permission_granted(authed):
    r = authed.post("/api/users", json={
        "username": "mixed", "password": "MixedPass1", "role": "viewer", "permissions": ["broadcast"],
    })
    assert "broadcast" in r.json()["permissions"]
    client = authed
    _login(client, "mixed", "MixedPass1")
    # The extra grant lets this viewer control the broadcast (needs a playlist).
    assert client.post("/api/broadcast/stop").status_code == 200


def test_update_user_role_and_password(authed):
    uid = authed.post("/api/users", json={"username": "u", "password": "Password123", "role": "viewer"}).json()["id"]
    r = authed.patch(f"/api/users/{uid}", json={"username": "u", "role": "operator", "permissions": []})
    assert r.json()["role"] == "operator"
    # Password change forces a re-login.
    authed.patch(f"/api/users/{uid}", json={"username": "u", "role": "operator", "password": "NewPassword123"})
    assert _login(authed, "u", "NewPassword123").status_code == 200


def test_cannot_demote_last_admin(authed):
    admin = next(u for u in authed.get("/api/users").json()["items"] if u["role"] == "admin")
    r = authed.patch(f"/api/users/{admin['id']}", json={"username": admin["username"], "role": "viewer"})
    assert r.status_code == 409


def test_cannot_delete_self(authed):
    admin = next(u for u in authed.get("/api/users").json()["items"] if u["role"] == "admin")
    assert authed.delete(f"/api/users/{admin['id']}").status_code == 409


def test_delete_user(authed):
    uid = authed.post("/api/users", json={"username": "gone", "password": "Password123", "role": "viewer"}).json()["id"]
    assert authed.delete(f"/api/users/{uid}").status_code == 200
    assert all(u["id"] != uid for u in authed.get("/api/users").json()["items"])


def test_version_endpoint(authed):
    data = authed.get("/api/system/version").json()
    assert data["version"]
    assert isinstance(data["changelog"], str)


def test_reset_preview_and_reset(authed):
    # Create some content, then reset and confirm it is gone but users remain.
    pid = authed.post("/api/playlists", json={"name": "Temp"}).json()["id"]
    authed.post("/api/scenes", json={"name": "S", "layers": []})
    preview = authed.get("/api/maintenance/reset/preview").json()
    assert preview["confirm_phrase"] == "RESET"
    assert preview["tables"]["playlists"] >= 1

    # Wrong confirmation is rejected.
    assert authed.post("/api/maintenance/reset", json={"confirm": "nope"}).status_code == 422

    r = authed.post("/api/maintenance/reset", json={"confirm": "RESET"})
    assert r.status_code == 200, r.text
    assert authed.get("/api/playlists").json()["items"] == []
    assert authed.get("/api/scenes").json()["items"] == []
    # Users are preserved and the session still works.
    assert any(u["username"] == "admin" for u in authed.get("/api/users").json()["items"])


def test_reset_requires_admin(installed):
    assert installed.get("/api/maintenance/reset/preview").status_code == 401


def test_update_check_endpoint(authed):
    data = authed.get("/api/system/update/check").json()
    assert data["current"]
    assert "update_available" in data
