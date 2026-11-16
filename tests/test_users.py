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


def test_update_check_reports_repo_and_branch(authed):
    authed.put("/api/broadcast/settings", json={"update_repo": "owner/repo", "update_branch": "main"})
    data = authed.get("/api/system/update/check").json()
    assert data["repo"] == "owner/repo"
    assert data["branch"] == "main"
    # No network in tests: latest stays null, so no update is offered.
    assert data["update_available"] is False


def test_update_check_normalizes_git_url(authed):
    # install.sh stores the clone's remote URL; the GitHub API needs owner/repo.
    authed.put("/api/broadcast/settings", json={"update_repo": "https://github.com/heyhey2thereal/LocalLive.git"})
    data = authed.get("/api/system/update/check").json()
    assert data["repo"] == "heyhey2thereal/LocalLive"
    assert data["branch"]  # a branch is always reported (defaults to main)


def test_update_check_normalizes_ssh_url(authed):
    authed.put("/api/broadcast/settings", json={"update_repo": "git@github.com:owner/repo.git"})
    data = authed.get("/api/system/update/check").json()
    assert data["repo"] == "owner/repo"


def test_update_command_missing_returns_manual_hint(authed):
    # Clear any configured command, then ensure the endpoint reports a manual hint.
    authed.put("/api/broadcast/settings", json={"update_command": ""})
    res = authed.post("/api/system/update", json={}).json()
    assert res["ok"] is False
    assert res.get("manual") is True


def test_update_detached_does_not_announce_a_version(authed, tmp_path):
    """A detached update is still running: no 'updated' notice must be queued."""
    from app import db

    helper = tmp_path / "helper.sh"
    helper.write_text("#!/usr/bin/env bash\necho LOCALLIVE_UPDATE_DETACHED_OK\n", encoding="utf-8")
    helper.chmod(0o755)
    authed.put("/api/broadcast/settings", json={"update_command": str(helper)})
    db.set_setting("pending_update_notice", "")
    res = authed.post("/api/system/update", json={}).json()
    assert res["ok"] is True and res.get("detached") is True
    # The notice is written by the background helper, not by the API here.
    assert (db.get_setting("pending_update_notice", "") or "") == ""


def test_update_sync_sets_notice_to_installed_version(authed, tmp_path):
    """A synchronous success queues the freshly written VERSION, not __version__."""
    from app import db, __version__

    helper = tmp_path / "helper.sh"
    helper.write_text("#!/usr/bin/env bash\nexit 0\n", encoding="utf-8")
    helper.chmod(0o755)
    authed.put("/api/broadcast/settings", json={"update_command": str(helper)})
    # Point _installed_version() at a fresh VERSION file.
    version_file = tmp_path / "VERSION"
    version_file.write_text("9.9.9\n", encoding="utf-8")
    import app.routers.system as system

    original = system._installed_version
    system._installed_version = lambda: "9.9.9"
    try:
        db.set_setting("pending_update_notice", "")
        res = authed.post("/api/system/update", json={}).json()
        assert res["ok"] is True
        assert db.get_setting("pending_update_notice") == "9.9.9"
        assert db.get_setting("pending_update_notice") != __version__
    finally:
        system._installed_version = original


def test_update_notice_is_one_shot(authed):
    from app import db

    db.set_setting("pending_update_notice", "2.16.0")
    first = authed.get("/api/system/update-notice").json()
    assert first == {"show": True, "version": "2.16.0"}
    # Cleared on read, so it never shows twice.
    assert authed.get("/api/system/update-notice").json() == {"show": False}


def test_update_missing_command_file_returns_manual_hint(authed, tmp_path):
    """A configured command that does not exist reports a manual hint, not a 500."""
    missing = tmp_path / "does-not-exist.sh"
    authed.put("/api/broadcast/settings", json={"update_command": str(missing)})
    res = authed.post("/api/system/update", json={}).json()
    assert res["ok"] is False
    assert res.get("manual") is True


def test_update_malformed_command_returns_hint_not_500(authed):
    """A stray quote in the configured command must not crash the endpoint."""
    authed.put("/api/broadcast/settings", json={"update_command": "echo 'unbalanced"})
    r = authed.post("/api/system/update", json={})
    assert r.status_code == 200, r.text
    res = r.json()
    assert res["ok"] is False
    assert res.get("manual") is True


def test_update_directory_command_returns_hint(authed, tmp_path):
    """A non-executable path (a directory) reports a hint instead of a 500."""
    authed.put("/api/broadcast/settings", json={"update_command": str(tmp_path)})
    r = authed.post("/api/system/update", json={})
    assert r.status_code == 200, r.text
    assert r.json()["ok"] is False


def test_update_log_endpoint_reports_lines(authed):
    """The console endpoint returns the tail of the update log (or an empty list)."""
    from app.routers import system as system_mod

    path = system_mod._update_log_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("ligne 1\nligne 2\nligne 3\n", encoding="utf-8")
    data = authed.get("/api/system/update/log?lines=2").json()
    assert data["lines"] == ["ligne 2", "ligne 3"]
    assert data["path"] == str(path)


def test_update_log_requires_settings_capability(installed):
    assert installed.get("/api/system/update/log").status_code == 401


def test_latest_published_prefers_release_then_tags(monkeypatch):
    """The update check prefers a Release, then falls back to the newest tag."""
    import app.routers.system as system

    # A Release is present: it wins, and no tags call is needed.
    calls: list[str] = []

    def release_get(url):
        calls.append(url)
        assert "/releases/latest" in url
        return {"tag_name": "v2.16.0"}

    monkeypatch.setattr(system, "_github_get", release_get)
    assert system._latest_published("owner/repo") == "2.16.0"
    assert all("/tags" not in u for u in calls)

    # No Release: fall back to the highest SemVer among the tags.
    def tags_get(url):
        if "/releases/latest" in url:
            raise RuntimeError("404")
        assert "/tags" in url
        return [{"name": "v2.0.0"}, {"name": "v2.15.0"}, {"name": "v2.9.0"}, {"name": "v2.16.0"}]

    monkeypatch.setattr(system, "_github_get", tags_get)
    assert system._latest_published("owner/repo") == "2.16.0"


def test_update_check_reports_tags_fallback(authed, monkeypatch):
    """The endpoint reports an update when only a newer tag exists."""
    import app.routers.system as system

    def fake_get(url):
        if "/releases/latest" in url:
            raise RuntimeError("404")
        return [{"name": "v99.0.0"}]

    monkeypatch.setattr(system, "_github_get", fake_get)
    authed.put("/api/broadcast/settings", json={"update_repo": "owner/repo"})
    data = authed.get("/api/system/update/check").json()
    assert data["repo"] == "owner/repo"
    assert data["latest"] == "99.0.0"
    assert data["update_available"] is True
