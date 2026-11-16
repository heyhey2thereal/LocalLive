"""Media library tests: upload, probe, thumbnails, folders, storage."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app import config


def _make_video(path: Path, seconds: int = 2) -> None:
    subprocess.run(
        [
            config.FFMPEG_BIN, "-y", "-v", "error",
            "-f", "lavfi", "-i", f"testsrc=size=320x240:rate=25:duration={seconds}",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-shortest", str(path),
        ],
        check=True, timeout=120,
    )


def _make_image(path: Path) -> None:
    subprocess.run(
        [
            config.FFMPEG_BIN, "-y", "-v", "error",
            "-f", "lavfi", "-i", "color=c=red:size=320x240:duration=1",
            "-frames:v", "1", str(path),
        ],
        check=True, timeout=60,
    )


def _make_audio(path: Path, seconds: int = 2) -> None:
    subprocess.run(
        [
            config.FFMPEG_BIN, "-y", "-v", "error",
            "-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}",
            str(path),
        ],
        check=True, timeout=60,
    )


def _upload(client, path: Path):
    with path.open("rb") as fh:
        return client.post(
            "/api/media/upload",
            files={"files": (path.name, fh, "application/octet-stream")},
        )


@pytest.fixture(scope="module")
def sample_media(tmp_path_factory):
    d = tmp_path_factory.mktemp("media")
    video = d / "clip.mp4"
    image = d / "poster.png"
    audio = d / "tone.mp3"
    _make_video(video)
    _make_image(image)
    _make_audio(audio)
    return {"video": video, "image": image, "audio": audio}


def test_upload_video_probes_metadata(authed, sample_media):
    r = _upload(authed, sample_media["video"])
    assert r.status_code == 201, r.text
    item = r.json()["items"][0]
    assert item["kind"] == "video"
    assert item["width"] == 320 and item["height"] == 240
    assert item["duration"] > 1.5
    assert item["video_codec"] == "h264"
    assert item["has_audio"] is True
    assert item["size"] > 0


def test_upload_image_and_audio(authed, sample_media):
    r = _upload(authed, sample_media["image"])
    assert r.status_code == 201
    assert r.json()["items"][0]["kind"] == "image"

    r = _upload(authed, sample_media["audio"])
    assert r.status_code == 201
    assert r.json()["items"][0]["kind"] == "audio"


def test_thumbnail_generated(authed, sample_media):
    item = _upload(authed, sample_media["video"]).json()["items"][0]
    assert item["thumbnail_url"]
    r = authed.get(item["thumbnail_url"])
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert len(r.content) > 100


def test_stream_supports_range(authed, sample_media):
    item = _upload(authed, sample_media["video"]).json()["items"][0]
    r = authed.get(item["stream_url"], headers={"Range": "bytes=0-99"})
    assert r.status_code == 206
    assert len(r.content) == 100
    assert "content-range" in r.headers


def test_unsupported_type_rejected(authed, tmp_path):
    bad = tmp_path / "notes.txt"
    bad.write_text("hello")
    r = _upload(authed, bad)
    assert r.status_code == 415


def test_rename_and_delete(authed, sample_media):
    item = _upload(authed, sample_media["image"]).json()["items"][0]
    r = authed.patch(f"/api/media/{item['id']}", json={"title": "Nouveau titre"})
    assert r.status_code == 200 and r.json()["title"] == "Nouveau titre"
    assert authed.delete(f"/api/media/{item['id']}").status_code == 200
    assert authed.get(f"/api/media/{item['id']}").status_code == 404


def test_search_and_filter(authed, sample_media):
    _upload(authed, sample_media["video"])
    _upload(authed, sample_media["image"])
    assert authed.get("/api/media?kind=image").json()["total"] >= 1
    assert authed.get("/api/media?q=clip").json()["total"] >= 1
    assert authed.get("/api/media?kind=video").json()["total"] >= 1


def test_folders(authed, sample_media):
    r = authed.post("/api/media/folders", json={"name": "Promos"})
    assert r.status_code == 201
    fid = r.json()["id"]
    item = _upload(authed, sample_media["image"]).json()["items"][0]
    authed.patch(f"/api/media/{item['id']}", json={"folder_id": fid})
    listing = authed.get("/api/media/folders/list").json()
    assert any(f["name"] == "Promos" and f["count"] == 1 for f in listing["folders"])
    assert authed.get(f"/api/media?folder_id={fid}").json()["total"] == 1


def test_storage_reporting(authed, sample_media):
    _upload(authed, sample_media["video"])
    r = authed.get("/api/media/storage")
    assert r.status_code == 200
    data = r.json()
    assert data["media_bytes"] > 0
    assert data["count"] >= 1
    assert data["disk"]["total"] > 0


def test_upload_requires_admin(installed, sample_media):
    # Not logged in at all -> 401
    assert _upload(installed, sample_media["video"]).status_code == 401


def test_media_preview_endpoint(authed, sample_media):
    item = _upload(authed, sample_media["image"]).json()["items"][0]
    assert item["preview_url"] == f"/api/media/{item['id']}/preview"
    r = authed.get(item["preview_url"])
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/")
    assert len(r.content) > 0
    # Cached on the second request.
    assert authed.get(item["preview_url"]).status_code == 200
