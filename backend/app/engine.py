"""Continuous 24/7 FFmpeg playback engine.

The engine is deliberately independent from the web layer: it owns a single
long-lived ffmpeg process that plays the whole playlist once and is restarted by
a supervisor thread when it ends (loop) or dies (automatic recovery). Progress
is read from `-progress pipe:1` so the API can report the current/next item
without touching the media files.

Two pipelines are used:
  * fast path  — concat demuxer + `-c copy` when every item shares codec,
    resolution and frame rate (near-zero CPU);
  * safe path  — a normalising filter graph (scale/pad/fps/format + concat)
    that handles mixed videos, images, audio-only tracks and scenes.
"""
from __future__ import annotations

import json
import logging
import shutil
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import config, db, fx

log = logging.getLogger("locallive.engine")

_SILENCE = "anullsrc=channel_layout=stereo:sample_rate=48000"


@dataclass
class OutputConfig:
    kind: str = "rtmp"  # rtmp | file
    rtmp_url: str = ""
    stream_key: str = ""
    file_path: str = ""
    width: int = 1280
    height: int = 720
    fps: int = 25
    bitrate: int = 2500  # kbps
    audio_bitrate: int = 128
    preset: str = "veryfast"
    realtime: bool = True

    @property
    def destination(self) -> str:
        if self.kind == "rtmp":
            url = self.rtmp_url.rstrip("/")
            return f"{url}/{self.stream_key}" if self.stream_key else url
        return self.file_path


@dataclass
class EngineState:
    running: bool = False
    starting: bool = False
    playlist_id: int | None = None
    playlist_name: str = ""
    output: dict[str, Any] = field(default_factory=dict)
    started_at: float | None = None
    current_index: int = 0
    position: float = 0.0
    cycle_duration: float = 0.0
    items: list[dict[str, Any]] = field(default_factory=list)
    restarts: int = 0
    errors: int = 0
    last_error: str = ""
    pipeline: str = ""
    pid: int | None = None
    paused: bool = False


def _ffmpeg_available() -> bool:
    return shutil.which(config.FFMPEG_BIN) is not None


def _font_path() -> str | None:
    return fx.font_path()


# Kept as thin aliases so the historical helpers remain importable (tests and
# external callers); the implementations now live in fx.py.
_hex_to_ffmpeg = fx.hex_to_ffmpeg
_escape_drawtext = fx.escape_drawtext


class PlaybackEngine:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._process: subprocess.Popen | None = None
        self._supervisor: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._state = EngineState()
        self._log_tail: list[str] = []
        self._progress_thread: threading.Thread | None = None
        self._config: OutputConfig | None = None
        self._desired: dict[str, Any] | None = None
        self._scheduler: threading.Thread | None = None
        self._sched_stop = threading.Event()
        # Which output(s) to feed. None = historical fan-out (primary + enabled
        # streams); 'primary' = only the main output; int = the matching stream;
        # 'all' = explicit fan-out.
        self._output_id: int | str | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(
        self,
        playlist_id: int,
        config_override: dict[str, Any] | None = None,
        output_id: int | str | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if self._state.running:
                return {"ok": False, "error": "Diffusion déjà en cours"}
            if not _ffmpeg_available():
                return {"ok": False, "error": "FFmpeg introuvable sur le système"}
            playlist = db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
            if not playlist:
                return {"ok": False, "error": "Playlist introuvable"}
            items = self._resolve_items(playlist_id)
            if not items:
                return {"ok": False, "error": "La playlist est vide"}

            output = self._build_output_config(config_override or {})
            self._config = output
            # Which output(s) to feed: None keeps the historical fan-out (primary
            # + every enabled stream), 'primary' only the main output, an int the
            # matching stream, 'all' the explicit fan-out.
            self._output_id = output_id
            self._state = EngineState(
                running=True,
                starting=True,
                playlist_id=playlist_id,
                playlist_name=playlist["name"],
                output={
                    "kind": output.kind,
                    "url": output.rtmp_url,
                    "has_key": bool(output.stream_key),
                    "masked_key": _mask(output.stream_key),
                    "width": output.width,
                    "height": output.height,
                    "fps": output.fps,
                    "bitrate": output.bitrate,
                    "file_path": output.file_path,
                    "target_id": output_id,
                },
                started_at=time.time(),
                items=[_public_item(i) for i in items],
                cycle_duration=sum(i["duration"] for i in items),
            )
            self._desired = {"playlist_id": playlist_id, "items": items}
            self._stop_event.clear()
            self._spawn(items, output)
            self._supervisor = threading.Thread(target=self._supervise, name="engine-supervisor", daemon=True)
            self._supervisor.start()
            self._start_scheduler()
            return {"ok": True, "state": self.status()}

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._stop_event.set()
            self._sched_stop.set()
            self._terminate_process()
            self._state.running = False
            self._state.starting = False
            self._state.pid = None
        if self._supervisor and self._supervisor.is_alive():
            self._supervisor.join(timeout=3)
        if self._scheduler and self._scheduler.is_alive():
            self._scheduler.join(timeout=3)
        return {"ok": True}

    def pause(self) -> dict[str, Any]:
        """Freeze the broadcast (SIGSTOP) without ending the process.

        Used by the operator's sound console: pausing the music pauses the live,
        resuming continues exactly where it stopped.
        """
        with self._lock:
            proc = self._process
            if not self._state.running or proc is None or proc.poll() is not None:
                return {"ok": False, "error": "La diffusion n'est pas active"}
            try:
                proc.send_signal(signal.SIGSTOP)
            except OSError as exc:
                return {"ok": False, "error": str(exc)}
            self._state.paused = True
        return {"ok": True}

    def resume(self) -> dict[str, Any]:
        """Resume a broadcast frozen by `pause`."""
        with self._lock:
            proc = self._process
            if proc is None or proc.poll() is not None:
                return {"ok": False, "error": "La diffusion n'est pas active"}
            try:
                proc.send_signal(signal.SIGCONT)
            except OSError as exc:
                return {"ok": False, "error": str(exc)}
            self._state.paused = False
        return {"ok": True}

    def switch_playlist(self, playlist_id: int) -> dict[str, Any]:
        """Swap the live playlist without dropping the broadcast for long."""
        with self._lock:
            if not self._state.running:
                return self.start(playlist_id)
            playlist = db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
            if not playlist:
                return {"ok": False, "error": "Playlist introuvable"}
            items = self._resolve_items(playlist_id)
            if not items:
                return {"ok": False, "error": "La playlist est vide"}
            self._state.playlist_id = playlist_id
            self._state.playlist_name = playlist["name"]
            self._state.items = [_public_item(i) for i in items]
            self._state.cycle_duration = sum(i["duration"] for i in items)
            self._state.current_index = 0
            self._desired = {"playlist_id": playlist_id, "items": items}
            self._terminate_process()  # supervisor restarts with new items
            return {"ok": True}

    def set_program(self, playlist_id: int) -> dict[str, Any]:
        """Record which playlist is on air *without starting the broadcast*.

        Used by a take while the live is stopped: the program monitor then shows
        the chosen playlist, so the operator can line up the programme before
        pressing "Démarrer le direct". Nothing is streamed.
        """
        with self._lock:
            playlist = db.query_one("SELECT * FROM playlists WHERE id = ?", (playlist_id,))
            if not playlist:
                return {"ok": False, "error": "Playlist introuvable"}
            items = self._resolve_items(playlist_id)
            if not items:
                return {"ok": False, "error": "La playlist est vide"}
            self._state.playlist_id = playlist_id
            self._state.playlist_name = playlist["name"]
            self._state.items = [_public_item(i) for i in items]
            self._state.cycle_duration = sum(i["duration"] for i in items)
            self._state.current_index = 0
            self._state.position = 0.0
            self._desired = {"playlist_id": playlist_id, "items": items}
            return {"ok": True}

    def skip(self, direction: int = 1) -> dict[str, Any]:
        """Jump to the next (direction>0) or previous item immediately.

        Implemented by rotating the resolved item list so the target item is
        first, then restarting the process: the supervisor picks the new order
        up and the broadcast keeps running. `direction < 0` restarts the current
        item if it is the first of the list.
        """
        with self._lock:
            if not self._state.running:
                return {"ok": False, "error": "La diffusion n'est pas active"}
            items = (self._desired or {}).get("items") or []
            if len(items) < 2:
                return {"ok": False, "error": "Rien à sauter (playlist trop courte)"}
            step = 1 if direction >= 0 else -1
            target = (self._state.current_index + step) % len(items)
            rotated = items[target:] + items[:target]
            self._state.items = [_public_item(i) for i in rotated]
            self._state.cycle_duration = sum(i["duration"] for i in rotated)
            self._state.current_index = 0
            self._desired = {"playlist_id": self._state.playlist_id, "items": rotated}
            self._terminate_process()  # supervisor restarts with the new order
            label = "élément suivant" if step > 0 else "élément précédent"
            return {"ok": True, "message": f"Passage à l'{label}.", "index": target}

    def reload_if_live(self, playlist_id: int) -> dict[str, Any]:
        """Reload a playlist that is currently on air after it was edited.

        Called when a playlist is changed (item added/removed/reordered, scene or
        duration edited): if it is the one being broadcast, the engine re-resolves
        its items and restarts the process so the change is heard on air at once.
        A no-op for any other playlist, so the preview is never disturbed.
        """
        with self._lock:
            if not self._state.running or self._state.playlist_id != playlist_id:
                return {"ok": True, "reloaded": False}
            items = self._resolve_items(playlist_id)
            if not items:
                return {"ok": False, "error": "La playlist est vide"}
            # Keep playing the item that is on air when it still exists.
            current = self._state.items[self._state.current_index] if self._state.items else None
            rotated = items
            if current:
                idx = next((k for k, it in enumerate(items) if it["id"] == current["id"]), None)
                if idx is not None:
                    rotated = items[idx:] + items[:idx]
            self._state.items = [_public_item(i) for i in rotated]
            self._state.cycle_duration = sum(i["duration"] for i in rotated)
            self._state.current_index = 0
            self._state.position = 0.0
            self._desired = {"playlist_id": playlist_id, "items": rotated}
            self._terminate_process()  # supervisor restarts with the new items
            return {"ok": True, "reloaded": True}

    def restart_current(self) -> dict[str, Any]:
        """Restart the item currently on air (from its beginning).

        Used by the countdown controls: restarting the scene that holds the
        countdown makes it start over. The item is rotated to the front so the
        process resumes exactly there instead of from the playlist start.
        """
        with self._lock:
            if not self._state.running:
                return {"ok": False, "error": "La diffusion n'est pas active"}
            items = (self._desired or {}).get("items") or []
            idx = self._state.current_index
            if items and 0 <= idx < len(items):
                rotated = items[idx:] + items[:idx]
                self._state.items = [_public_item(i) for i in rotated]
                self._state.cycle_duration = sum(i["duration"] for i in rotated)
                self._state.current_index = 0
                self._desired = {"playlist_id": self._state.playlist_id, "items": rotated}
            self._terminate_process()  # supervisor restarts with the current item
            return {"ok": True}

    def seek(self, position: float) -> dict[str, Any]:
        """Jump the broadcast to `position` seconds into the current cycle.

        The item that contains `position` is rotated to the front and the process
        is restarted there, so the live resumes from the requested point (used by
        the operator's sound console when scrubbing the music).
        """
        with self._lock:
            if not self._state.running:
                return {"ok": False, "error": "La diffusion n'est pas active"}
            items = (self._desired or {}).get("items") or []
            if not items:
                return {"ok": False, "error": "Playlist vide"}
            position = max(0.0, float(position))
            acc = 0.0
            target = 0
            for k, it in enumerate(items):
                acc += it["duration"] or 0
                if position < acc:
                    target = k
                    break
            else:
                target = len(items) - 1
            rotated = items[target:] + items[:target]
            self._state.items = [_public_item(i) for i in rotated]
            self._state.cycle_duration = sum(i["duration"] or 0 for i in rotated)
            self._state.current_index = 0
            self._state.position = 0.0
            self._desired = {"playlist_id": self._state.playlist_id, "items": rotated}
            self._terminate_process()  # supervisor restarts at the target item
            return {"ok": True, "index": target}

    def status(self) -> dict[str, Any]:
        with self._lock:
            s = self._state
            items = s.items
            current = items[s.current_index] if 0 <= s.current_index < len(items) else None
            nxt = items[s.current_index + 1] if s.current_index + 1 < len(items) else (
                items[0] if items and self._is_looping() else None
            )
            return {
                "running": s.running,
                "starting": s.starting,
                "pipeline": s.pipeline,
                "playlist_id": s.playlist_id,
                "playlist_name": s.playlist_name,
                "output": s.output,
                "started_at": s.started_at,
                "uptime": round(time.time() - s.started_at, 1) if s.started_at else 0,
                "current": current,
                "next": nxt,
                "current_index": s.current_index,
                "position": round(s.position, 2),
                "cycle_duration": round(s.cycle_duration, 2),
                "item_count": len(items),
                "items": items,
                "restarts": s.restarts,
                "errors": s.errors,
                "last_error": s.last_error,
                "pid": s.pid,
                "paused": s.paused,
                "ffmpeg": _ffmpeg_available(),
                "log_tail": self._log_tail[-40:],
            }

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _is_looping(self) -> bool:
        if not self._state.playlist_id:
            return True
        row = db.query_one("SELECT loop FROM playlists WHERE id = ?", (self._state.playlist_id,))
        return bool(row["loop"]) if row else True

    def _resolve_items(self, playlist_id: int) -> list[dict[str, Any]]:
        rows = db.query(
            """SELECT pi.id, pi.position, pi.duration AS override_duration,
                      pi.transition, pi.transition_duration,
                      pi.background_audio_id, pi.background_volume,
                      pi.background_audio_continue,
                      m.id AS media_id, m.title, m.path, m.kind, m.duration, m.has_audio,
                      m.width, m.height, m.fps, m.video_codec, m.audio_codec, m.thumbnail,
                      bg.path AS bg_path, bg.duration AS bg_duration, bg.title AS bg_title,
                      s.id AS scene_id, s.name AS scene_name, s.layers AS scene_layers,
                      s.width AS scene_width, s.height AS scene_height, s.background AS scene_bg
               FROM playlist_items pi
               LEFT JOIN media m ON m.id = pi.media_id
               LEFT JOIN media bg ON bg.id = pi.background_audio_id
               LEFT JOIN scenes s ON s.id = pi.scene_id
               WHERE pi.playlist_id = ?
               ORDER BY pi.position""",
            (playlist_id,),
        )
        default_image = float(db.get_setting("image_duration", "5") or 5)
        items: list[dict[str, Any]] = []
        prev_bg_path: str | None = None
        prev_bg_id: int | None = None
        prev_bg_volume = 0.0
        for r in rows:
            d = dict(r)
            if d["scene_id"]:
                d["kind"] = "scene"
                d["duration"] = float(d["override_duration"] or default_image)
                d["exists"] = True
                d["title"] = d["scene_name"]
            else:
                path = Path(d["path"]) if d["path"] else None
                d["exists"] = bool(path and path.exists())
                if d["kind"] == "image":
                    d["duration"] = float(d["override_duration"] or d["duration"] or default_image)
                elif d["kind"] == "audio":
                    d["duration"] = float(d["duration"] or d["override_duration"] or 0)
                else:
                    d["duration"] = float(d["duration"] or 0)
            d["transition"] = d.get("transition") or "cut"
            d["transition_duration"] = float(d.get("transition_duration") or 0)
            d["background_volume"] = float(d.get("background_volume") or 0)
            bg_path = d.get("bg_path")
            d["background_audio_path"] = bg_path if bg_path and Path(bg_path).exists() else None
            # "Continue previous music": keep playing the track of the item above
            # instead of starting a new one (the music does not restart).
            if d.get("background_audio_continue") and prev_bg_path:
                d["background_audio_path"] = prev_bg_path
                d["background_audio_id"] = prev_bg_id
                d["background_volume"] = prev_bg_volume
            prev_bg_path = d.get("background_audio_path")
            prev_bg_id = d.get("background_audio_id")
            prev_bg_volume = d.get("background_volume")
            items.append(d)
        return items

    def resolve_preview(self, playlist_id: int) -> list[dict[str, Any]]:
        """Resolve a playlist to its public item list without touching the
        broadcast. Used by the Preview/Program switcher."""
        return [_public_item(i) for i in self._resolve_items(playlist_id)]

    def _build_output_config(self, override: dict[str, Any]) -> OutputConfig:
        def get(key: str, default: str) -> str:
            return str(override.get(key, db.get_setting(key, default) or default))

        return OutputConfig(
            kind=get("output_kind", "rtmp"),
            rtmp_url=get("stream_rtmp_url", "rtmp://a.rtmp.youtube.com/live2"),
            stream_key=get("stream_key", ""),
            file_path=get("output_file", str(config.DATA_DIR / "broadcast.flv")),
            width=int(get("stream_width", "1280")),
            height=int(get("stream_height", "720")),
            fps=int(get("stream_fps", "25")),
            bitrate=int(get("stream_bitrate", "2500")),
            audio_bitrate=int(get("stream_audio_bitrate", "128")),
            preset=get("stream_preset", "veryfast"),
            realtime=bool(override.get("realtime", True)),
        )

    def _spawn(self, items: list[dict[str, Any]], output: OutputConfig) -> None:
        cmd, pipeline = self._build_command(items, output)
        self._state.pipeline = pipeline
        self._state.starting = True
        log.info("Démarrage moteur (%s) : %s", pipeline, " ".join(cmd[:12]) + " ...")
        try:
            self._process = subprocess.Popen(
                cmd,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            self._state.pid = self._process.pid
        except OSError as exc:
            self._state.last_error = f"Impossible de lancer FFmpeg : {exc}"
            self._state.errors += 1
            log.error(self._state.last_error)
            self._process = None
            return

        self._progress_thread = threading.Thread(
            target=self._read_progress, args=(self._process,), name="engine-progress", daemon=True
        )
        self._progress_thread.start()
        threading.Thread(
            target=self._read_stderr, args=(self._process,), name="engine-stderr", daemon=True
        ).start()
        time.sleep(0.3)
        with self._lock:
            if self._process and self._process.poll() is None:
                self._state.starting = False

    def _read_progress(self, process: subprocess.Popen) -> None:
        try:
            for line in process.stdout or []:
                line = line.strip()
                if line.startswith("out_time_ms=") or line.startswith("out_time_us="):
                    try:
                        micros = int(line.split("=", 1)[1])
                        seconds = micros / 1_000_000
                    except ValueError:
                        continue
                    with self._lock:
                        self._state.position = seconds
                        self._state.current_index = self._index_for_position(seconds)
                elif line.startswith("progress="):
                    with self._lock:
                        if self._state.starting and self._process and self._process.poll() is None:
                            self._state.starting = False
        except (ValueError, OSError):
            return

    def _read_stderr(self, process: subprocess.Popen) -> None:
        try:
            for line in process.stderr or []:
                line = line.rstrip()
                if not line:
                    continue
                self._log_tail.append(line)
                if len(self._log_tail) > 200:
                    del self._log_tail[:100]
                if "error" in line.lower() or "failed" in line.lower():
                    with self._lock:
                        self._state.last_error = line[:400]
        except (ValueError, OSError):
            return

    def _index_for_position(self, seconds: float) -> int:
        items = self._state.items
        acc = 0.0
        for idx, item in enumerate(items):
            acc += item["duration"] or 0
            if seconds < acc:
                return idx
        return max(len(items) - 1, 0)

    def _supervise(self) -> None:
        """Restart ffmpeg when it exits: loop the playlist or recover from error."""
        while not self._stop_event.is_set():
            process = self._process
            if process is None:
                break
            code = process.wait()
            if self._stop_event.is_set():
                break
            with self._lock:
                self._state.restarts += 1
                if code not in (0, None):
                    self._state.errors += 1
                    log.warning("FFmpeg terminé avec le code %s, redémarrage", code)
                else:
                    log.info("Cycle de playlist terminé, redémarrage")
                if not self._is_looping() and self._desired:
                    # Playlist finished and loop disabled -> fall back.
                    from .routers.schedules import active_playlist_id

                    next_id = active_playlist_id()
                    if next_id and next_id != self._state.playlist_id:
                        items = self._resolve_items(next_id)
                        row = db.query_one("SELECT name FROM playlists WHERE id = ?", (next_id,))
                        if items:
                            self._state.playlist_id = next_id
                            self._state.playlist_name = row["name"] if row else ""
                            self._state.items = [_public_item(i) for i in items]
                            self._state.cycle_duration = sum(i["duration"] for i in items)
                            self._desired = {"playlist_id": next_id, "items": items}
            if self._stop_event.is_set():
                break
            time.sleep(0.25)
            with self._lock:
                items = (self._desired or {}).get("items") or []
                cfg = self._config
            if not items or cfg is None:
                break
            self._spawn(items, cfg)

    # ------------------------------------------------------------------
    # Schedule automation
    # ------------------------------------------------------------------
    def _start_scheduler(self) -> None:
        """Start the background thread that switches playlists on schedule.

        The scheduler compares the playlist the schedule says should be live with
        the one on air, and swaps it when they differ. A 20 s period is short
        enough for a programme change to be near-instant without polling the
        database hard on the small target host.
        """
        if self._scheduler and self._scheduler.is_alive():
            return
        self._sched_stop.clear()
        self._scheduler = threading.Thread(target=self._run_scheduler, name="engine-scheduler", daemon=True)
        self._scheduler.start()

    def _run_scheduler(self) -> None:
        while not self._sched_stop.wait(20):
            try:
                self._apply_schedule_once()
            except Exception:  # never let the thread die on a transient error
                log.exception("Erreur du planificateur de programmes")

    def _apply_schedule_once(self) -> None:
        """Swap the live playlist if a programme window now points elsewhere.

        Only runs while the broadcast is active: with the live stopped, the
        operator keeps full control of the programme lined up in the monitor.
        Only *scheduled* windows are followed (never the fallback playlist), so a
        manual take is not overridden when no programme is active.
        """
        from .routers.schedules import scheduled_playlist_id

        with self._lock:
            if not self._state.running or self._stop_event.is_set():
                return
            target = scheduled_playlist_id()
            if not target or target == self._state.playlist_id:
                return
            row = db.query_one("SELECT name FROM playlists WHERE id = ?", (target,))
            if not row:
                return
            items = self._resolve_items(target)
            if not items:
                return
            log.info("Programme : bascule automatique vers la playlist %s", target)
            self._state.playlist_id = target
            self._state.playlist_name = row["name"]
            self._state.items = [_public_item(i) for i in items]
            self._state.cycle_duration = sum(i["duration"] for i in items)
            self._state.current_index = 0
            self._state.position = 0.0
            self._desired = {"playlist_id": target, "items": items}
            self._terminate_process()  # supervisor restarts with the new playlist

    def _terminate_process(self) -> None:
        process = self._process
        if process and process.poll() is None:
            try:
                process.terminate()
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
            except OSError:
                pass
        self._process = None

    # ------------------------------------------------------------------
    # Command construction
    # ------------------------------------------------------------------
    def _build_command(self, items: list[dict[str, Any]], output: OutputConfig) -> tuple[list[str], str]:
        """Return (ffmpeg command, pipeline). Fan-out happens inside the single
        process: one input graph, then split/asplit feeding one output each."""
        usable = [i for i in items if i.get("exists") and (i["kind"] != "audio" or i["duration"] > 0)]
        if not usable:
            usable = [i for i in items if i.get("exists")]
        outputs = self._resolve_outputs(output)
        # Stream copy cannot fan out (split needs decoding) and cannot apply a
        # transition or background music, so those force the filter pipeline.
        if len(outputs) == 1 and self._can_stream_copy(usable):
            try:
                return self._build_copy_command(usable, outputs[0][0]), "copy"
            except OSError:
                pass
        return self._build_filter_command(usable, outputs), "filter"

    def _resolve_outputs(self, output: OutputConfig) -> list[tuple[OutputConfig, str]]:
        """Build the list of (config, destination) for the fan-out.

        The configured output is always primary. For an RTMP broadcast we append
        every enabled row of the `streams` table, so a single engine process can
        feed several platforms at once.

        `self._output_id` narrows the target: 'primary' keeps only the main
        output, an int keeps only that stream, None/'all' keep the historical
        fan-out (primary + every enabled stream).
        """
        target = self._output_id
        targets: list[tuple[OutputConfig, str]] = []
        if target != "primary" and not isinstance(target, int):
            # Historical behaviour: the primary output is always used, unless a
            # specific stream was chosen (int) or the primary alone was requested.
            targets.append((output, output.destination))
        if output.kind == "rtmp" and target != "primary":
            for row in db.query("SELECT * FROM streams WHERE kind = 'rtmp' ORDER BY id"):
                if isinstance(target, int) and row["id"] != target:
                    continue
                if target is None or target == "all":
                    if not row["enabled"]:
                        continue
                key = row["stream_key"] or ""
                url = (row["rtmp_url"] or "").rstrip("/")
                dest = f"{url}/{key}" if key else url
                if not dest or any(dest == d for _, d in targets):
                    continue
                targets.append((
                    OutputConfig(
                        kind="rtmp",
                        rtmp_url=url,
                        stream_key=key,
                        width=int(row["width"] or output.width),
                        height=int(row["height"] or output.height),
                        fps=int(row["fps"] or output.fps),
                        bitrate=int(row["bitrate"] or output.bitrate),
                        audio_bitrate=int(row["audio_bitrate"] or output.audio_bitrate),
                        preset=row["encoding"] or output.preset,
                        realtime=output.realtime,
                    ),
                    dest,
                ))
        # A chosen stream that vanished would leave nothing to feed: fall back to
        # the primary output so the broadcast still starts.
        if not targets:
            targets.append((output, output.destination))
        return targets

    def _can_stream_copy(self, items: list[dict[str, Any]]) -> bool:
        if not items or any(i["kind"] != "video" for i in items):
            return False
        if any((i.get("transition") or "cut") != "cut" for i in items):
            return False
        if any(i.get("background_audio_path") for i in items):
            return False
        first = items[0]
        for item in items:
            if item["video_codec"] != first["video_codec"]:
                return False
            if item["audio_codec"] != first["audio_codec"]:
                return False
            if item["width"] != first["width"] or item["height"] != first["height"]:
                return False
            if round(item["fps"] or 0, 2) != round(first["fps"] or 0, 2):
                return False
            if not item["video_codec"]:
                return False
        return True

    def _build_copy_command(self, items: list[dict[str, Any]], output: OutputConfig) -> list[str]:
        list_path = config.TMP_DIR / "concat_list.txt"
        config.TMP_DIR.mkdir(parents=True, exist_ok=True)
        with list_path.open("w", encoding="utf-8") as fh:
            for item in items:
                escaped = str(item["path"]).replace("'", "'\\''")
                fh.write(f"file '{escaped}'\n")
        cmd = [config.FFMPEG_BIN, "-hide_banner", "-nostdin", "-loglevel", "warning"]
        if output.realtime:
            cmd += ["-re"]
        cmd += ["-f", "concat", "-safe", "0", "-i", str(list_path)]
        cmd += ["-c", "copy", "-bsf:a", "aac_adtstoasc"] if output.kind == "rtmp" else ["-c", "copy"]
        cmd += ["-progress", "pipe:1", "-nostats"]
        cmd += self._output_args(output)
        return cmd

    def _output_args(self, output: OutputConfig) -> list[str]:
        if output.kind == "rtmp":
            if not output.destination:
                raise OSError("URL RTMP manquante")
            return ["-f", "flv", output.destination]
        Path(output.file_path).parent.mkdir(parents=True, exist_ok=True)
        return ["-f", "mpegts", "-y", output.file_path]

    def _encoder_args(self, cfg: OutputConfig) -> list[str]:
        return [
            "-c:v", "libx264",
            "-preset", cfg.preset,
            "-tune", "zerolatency",
            "-b:v", f"{cfg.bitrate}k",
            "-maxrate", f"{cfg.bitrate}k",
            "-bufsize", f"{cfg.bitrate * 2}k",
            "-pix_fmt", "yuv420p",
            "-g", str(cfg.fps * 2),
            "-keyint_min", str(cfg.fps),
            "-sc_threshold", "0",
            "-c:a", "aac",
            "-b:a", f"{cfg.audio_bitrate}k",
            "-ar", "48000",
        ]

    def _build_filter_command(
        self, items: list[dict[str, Any]], outputs: list[tuple[OutputConfig, str]]
    ) -> list[str]:
        w, h, fps = outputs[0][0].width, outputs[0][0].height, outputs[0][0].fps
        realtime = outputs[0][0].realtime
        inputs: list[str] = []
        filters: list[str] = []
        counter = [0]  # number of -i inputs declared so far
        font = fx.font_path()

        def add_input(args: list[str]) -> int:
            index = counter[0]
            inputs.extend(args)
            counter[0] += 1
            return index

        # `fps` is applied *after* `setpts` so every segment presents a valid
        # constant frame rate to xfade (otherwise it fails with "rate 1/0").
        v_base = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
        )
        v_tail = f"format=yuv420p,setpts=PTS-STARTPTS,fps={fps}"
        a_norm = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"

        for n, item in enumerate(items):
            dur = max(item["duration"] or 0, 0.2)
            if item["kind"] == "image":
                vi = add_input(["-loop", "1", "-t", f"{dur:.3f}", "-i", item["path"]])
                filters.append(f"[{vi}:v]{v_base},trim=duration={dur:.3f},{v_tail}[v{n}]")
                self._audio_segment(item, filters, add_input, n, dur, a_norm, None)
            elif item["kind"] == "audio":
                vi = add_input(["-f", "lavfi", "-t", f"{dur:.3f}", "-i", f"color=c=black:s={w}x{h}:r={fps}"])
                filters.append(f"[{vi}:v]{v_base},trim=duration={dur:.3f},{v_tail}[v{n}]")
                self._audio_segment(item, filters, add_input, n, dur, a_norm, None)
            elif item["kind"] == "scene":
                self._scene_graph(item, filters, add_input, w, h, fps, font, n)
                self._audio_segment(item, filters, add_input, n, dur, a_norm, None)
            else:  # video — reuse the same input for its video and audio streams
                vi = add_input(["-i", item["path"]])
                filters.append(f"[{vi}:v]{v_base},{v_tail}[v{n}]")
                self._audio_segment(item, filters, add_input, n, dur, a_norm, vi)

        # --- assemble segments: cross-fades then background music ------------
        video = self._assemble_video(items, filters, len(items))
        audio = self._assemble_audio(items, filters, len(items))
        # Pace the whole timeline to realtime *after* it has been assembled, so
        # every item type (video, image, scene, audio) advances at wall-clock
        # speed. Pacing the inputs individually only slowed video down; a
        # playlist of scenes/images was rendered as fast as FFmpeg could go, so
        # the programme jumped through the whole playlist in a fraction of a
        # second (and never appeared to change scene).
        if realtime:
            filters.append(f"{video}realtime[outv]")
            filters.append(f"{audio}arealtime[outa]")
        else:
            filters.append(f"{video}null[outv]")
            filters.append(f"{audio}anull[outa]")
        video_maps, audio_maps = self._fanout_maps(filters, outputs, w, h)
        filter_complex = ";".join(filters)

        cmd = [config.FFMPEG_BIN, "-hide_banner", "-nostdin", "-loglevel", "warning"]
        cmd += inputs
        cmd += ["-filter_complex", filter_complex]
        for i, (cfg, _dest) in enumerate(outputs):
            cmd += ["-map", video_maps[i], "-map", audio_maps[i]]
            cmd += self._encoder_args(cfg)
            cmd += self._output_args(cfg)
        cmd += ["-progress", "pipe:1", "-nostats"]
        return cmd

    def _audio_segment(
        self, item: dict[str, Any], filters: list[str], add_input,
        n: int, dur: float, a_norm: str, video_index: int | None,
    ) -> None:
        """Emit the [aN] audio label, mixing the background track when present.

        For a video item with sound the audio is read from the same input as the
        video (`video_index`), avoiding a second decode of the same file.
        """
        bg = item.get("background_audio_path")
        kind = item["kind"]
        if kind == "video" and item.get("has_audio") and video_index is not None:
            filters.append(f"[{video_index}:a]{a_norm},asetpts=PTS-STARTPTS[base{n}]")
        elif kind == "audio":
            ai = add_input(["-t", f"{dur:.3f}", "-i", item["path"]])
            filters.append(f"[{ai}:a]{a_norm},atrim=duration={dur:.3f},asetpts=PTS-STARTPTS[base{n}]")
        else:
            ai = add_input(["-f", "lavfi", "-t", f"{dur:.3f}", "-i", _SILENCE])
            filters.append(f"[{ai}:a]anull[base{n}]")

        if bg:
            bgi = add_input(["-t", f"{dur:.3f}", "-i", bg])
            vol = float(item.get("background_volume") or 0.15)
            filters.append(f"[{bgi}:a]{a_norm},atrim=duration={dur:.3f},asetpts=PTS-STARTPTS,volume={vol:.3f}[bgm{n}]")
            filters.append(
                f"[base{n}][bgm{n}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a{n}]"
            )
        else:
            filters.append(f"[base{n}]anull[a{n}]")

    def _has_transitions(self, items: list[dict[str, Any]]) -> bool:
        return any(fx.transition_name(i.get("transition") or "cut") for i in items[1:])

    def _assemble_video(self, items: list[dict[str, Any]], filters: list[str], count: int) -> str:
        """Chain the [vN] segments; return the final video label.

        Without transitions a single `concat` is both cheaper and keeps the
        timing exact. When at least one transition is configured we fold the
        segments pairwise so each junction can use its own xfade.
        """
        if count == 1:
            return "[v0]"
        if not self._has_transitions(items):
            filters.append("".join(f"[v{n}]" for n in range(count)) + f"concat=n={count}:v=1:a=0[outv0]")
            return "[outv0]"
        # The transition stored on an item describes how it *enters* the timeline.
        current = "[v0]"
        offset = max(items[0]["duration"] or 0, 0.2)
        for n in range(1, count):
            item = items[n]
            name = fx.transition_name(item.get("transition") or "cut")
            dur = fx.transition_duration(item.get("transition") or "cut", item.get("transition_duration"))
            if name and dur > 0:
                # xfade consumes `dur` seconds of overlap; keep offset >= dur.
                dur = min(dur, max(offset - 0.05, 0.1), max(items[n]["duration"] or 0.2, 0.1))
                filters.append(f"{current}[v{n}]xfade=transition={name}:duration={dur:.3f}:offset={offset:.3f}[vx{n}]")
                current = f"[vx{n}]"
                offset = offset + max(items[n]["duration"] or 0, 0.2) - dur
            else:
                filters.append(f"{current}[v{n}]concat=n=2:v=1:a=0[vx{n}]")
                current = f"[vx{n}]"
                offset = offset + max(items[n]["duration"] or 0, 0.2)
        return current

    def _assemble_audio(self, items: list[dict[str, Any]], filters: list[str], count: int) -> str:
        """Chain the [aN] segments; return the final audio label."""
        if count == 1:
            return "[a0]"
        if not self._has_transitions(items):
            filters.append("".join(f"[a{n}]" for n in range(count)) + f"concat=n={count}:v=0:a=1[outa0]")
            return "[outa0]"
        current = "[a0]"
        for n in range(1, count):
            item = items[n]
            name = fx.transition_name(item.get("transition") or "cut")
            dur = fx.transition_duration(item.get("transition") or "cut", item.get("transition_duration"))
            if name and dur > 0:
                dur = min(dur, max(items[n]["duration"] or 0.2, 0.1), max(items[n - 1]["duration"] or 0.2, 0.1))
                filters.append(f"{current}[a{n}]acrossfade=d={dur:.3f}[ax{n}]")
            else:
                filters.append(f"{current}[a{n}]concat=n=2:v=0:a=1[ax{n}]")
            current = f"[ax{n}]"
        return current

    def _fanout_maps(
        self, filters: list[str], outputs: list[tuple[OutputConfig, str]], w: int, h: int
    ) -> tuple[list[str], list[str]]:
        """Append split/asplit filters for multi-output and return the map labels."""
        if len(outputs) == 1:
            return ["[outv]"], ["[outa]"]
        n = len(outputs)
        filters.append("[outv]split=" + str(n) + "".join(f"[ov{i}]" for i in range(n)))
        filters.append("[outa]asplit=" + str(n) + "".join(f"[oa{i}]" for i in range(n)))
        video_maps: list[str] = []
        audio_maps: list[str] = []
        for i, (cfg, _dest) in enumerate(outputs):
            if int(cfg.width) != w or int(cfg.height) != h:
                filters.append(f"[ov{i}]scale={int(cfg.width)}:{int(cfg.height)}[ovr{i}]")
                video_maps.append(f"[ovr{i}]")
            else:
                video_maps.append(f"[ov{i}]")
            audio_maps.append(f"[oa{i}]")
        return video_maps, audio_maps

    def _scene_graph(
        self, item: dict[str, Any], filters: list[str], add_input,
        w: int, h: int, fps: int, font: str | None, n: int,
    ) -> None:
        """Compose scene layers onto a background; emits the [vN] video label."""
        dur = max(item["duration"] or 0, 0.2)
        bg = fx.hex_to_ffmpeg(item.get("scene_bg") or "#000000")
        try:
            layers = json.loads(item.get("scene_layers") or "[]")
        except (json.JSONDecodeError, TypeError):
            layers = []
        filters.append(
            f"color=c={bg}:s={w}x{h}:r={fps},trim=duration={dur:.3f},setpts=PTS-STARTPTS[bg{n}]"
        )
        current = f"[bg{n}]"
        layer_index = 0
        for layer in sorted(layers, key=lambda l: l.get("z", 0)):
            if not layer.get("visible", True):
                continue
            out_label = f"[sc{n}_{layer_index}]"
            applied = self._layer_overlay(
                layer, item, filters, add_input, current, out_label, n, layer_index, dur, w, h, fps, font
            )
            if applied:
                current = out_label
                layer_index += 1
        filters.append(f"{current}format=yuv420p,fps={fps}[v{n}]")

    def _layer_overlay(
        self, layer: dict[str, Any], item: dict[str, Any], filters: list[str], add_input,
        src: str, out_label: str, n: int, layer_index: int,
        dur: float, w: int, h: int, fps: int, font: str | None,
    ) -> bool:
        """Apply one scene layer. Returns True when a filter was emitted."""
        ltype = layer.get("type")
        x, y = int(layer.get("x", 0)), int(layer.get("y", 0))
        opacity = float(layer.get("opacity", 1.0))
        speed = layer.get("animation_speed")
        prs = fx.layer_motion(
            x, y,
            anim_in=layer.get("anim_in") or layer.get("animation") or "none",
            anim_loop=layer.get("anim_loop") or "none",
            anim_out=layer.get("anim_out") or "none",
            speed=speed,
            duration=dur,
        )
        color = fx.hex_to_ffmpeg(layer.get("color") or "#ffffff")
        boxcolor = fx.hex_to_ffmpeg(str(layer.get("background") or "#000000"))
        # Per-layer font selection (falls back to the default when unset).
        layer_font = fx.resolve_font(layer.get("font")) or font

        def draw_text(text: str, fontsize: int, *, box: bool, spacing: int = 0) -> str:
            arg = f"'{fx.escape_drawtext(text)}'"
            if "text_expr" in prs:
                arg = f"'%{{eif\\:{prs['text_expr']}\\:d}}'"

            def one(fontcolor: str, enable: str = "") -> str:
                dt = (
                    f"drawtext=text={arg}:x={prs['x']}:y={prs['y']}:"
                    f"fontsize={fontsize}:fontcolor={fontcolor}:alpha={prs['alpha']}"
                )
                if spacing:
                    dt += f":line_spacing={spacing}"
                if layer_font:
                    dt += f":fontfile={layer_font}"
                if box:
                    dt += f":box=1:boxcolor={boxcolor}@0.5:boxborderw=10"
                if enable:
                    dt += f":enable='{enable}'"
                return dt

            # The "rainbow" loop recolours the text itself. fontcolor_expr does
            # not evaluate expressions on every build, so we draw the text once
            # per colour, each enabled during its slice of the cycle.
            if (layer.get("anim_loop") or "none") == "rainbow":
                return ",".join(one(c, fx.rainbow_enable(i, speed)) for i, c in enumerate(fx.RAINBOW_COLORS))
            return one(color)

        if ltype in ("text", "overlay"):
            if not layer.get("text"):
                return False
            fontsize = int(layer.get("font_size", 48 if ltype == "text" else 36))
            chain = draw_text(str(layer['text']), fontsize, box=bool(layer.get('background')))
            filters.append(f"{src}{chain}{out_label}")
            return True

        if ltype == "countdown":
            # A clock counting down (or up) from `countdown_seconds`. `t` is the
            # time since the layer went on air, so the timer starts exactly when
            # the scene reaches the program (no need to pre-set anything).
            # Formatted MM:SS for readability. No background box by default.
            total = int(layer.get("countdown_seconds") or 60)
            mode = layer.get("countdown_mode") or "down"
            if mode == "down":
                secs = f"max(0\\,{total}-floor(t))"
            else:
                secs = f"{total}+floor(t)"
            # MM:SS with zero-padding: eif supports a width field (e.g. :d:2).
            # The literal colon between the two expressions must be escaped so
            # the filter_complex parser does not treat it as an option separator.
            expr = f"%{{eif\\:floor(({secs})/60)\\:d\\:2}}\\:%{{eif\\:mod({secs}\\,60)\\:d\\:2}}"
            fontsize = int(layer.get("font_size", 96))

            def clock_dt(fontcolor: str, enable: str = "") -> str:
                dt = (
                    f"drawtext=text='{expr}':x={prs['x']}:y={prs['y']}:"
                    f"fontsize={fontsize}:fontcolor={fontcolor}:alpha={prs['alpha']}"
                )
                if layer_font:
                    dt += f":fontfile={layer_font}"
                # No background box unless the layer explicitly asks for one.
                if layer.get("background"):
                    dt += f":box=1:boxcolor={boxcolor}@0.5:boxborderw=12"
                if enable:
                    dt += f":enable='{enable}'"
                return dt

            if (layer.get("anim_loop") or "none") == "rainbow":
                dt = ",".join(
                    clock_dt(c, fx.rainbow_enable(i, speed)) for i, c in enumerate(fx.RAINBOW_COLORS)
                )
            else:
                dt = clock_dt(color)
            filters.append(f"{src}{dt}{out_label}")
            return True

        if ltype == "chat":
            from . import chat

            source = layer.get("chat_source") or "chat"
            lines = int(layer.get("chat_lines") or 8)
            messages = chat.recent(source, lines)
            if not messages:
                return False
            text = "\n".join(f"{m['user']}: {m['text']}" for m in messages)
            fontsize = int(layer.get("font_size", 28))
            filters.append(f"{src}{draw_text(text, fontsize, box=True, spacing=6)}{out_label}")
            return True

        if ltype == "clock":
            # Live clock / date. FFmpeg expands `%{localtime:...}` on every frame,
            # so the display stays current without any re-render from our side.
            fmt = str(layer.get("clock_format") or "%H:%M")
            fontsize = int(layer.get("font_size", 64))
            arg = f"'{fx.clock_text_expr(fmt, utc=bool(layer.get('clock_utc')))}'"
            dt = (
                f"drawtext=text={arg}:x={prs['x']}:y={prs['y']}:"
                f"fontsize={fontsize}:fontcolor={color}:alpha={prs['alpha']}"
            )
            if layer_font:
                dt += f":fontfile={layer_font}"
            if layer.get("background"):
                dt += f":box=1:boxcolor={boxcolor}@0.5:boxborderw=12"
            filters.append(f"{src}{dt}{out_label}")
            return True

        if ltype == "ticker":
            # Scrolling headline band fed by an RSS/Atom URL. The headlines are
            # fetched and cached by feeds.py; the marquee motion comes from the
            # layer's loop animation (defaults to a left-scrolling marquee).
            from . import feeds

            url = str(layer.get("feed_url") or "").strip()
            limit = int(layer.get("feed_limit") or 8)
            text = feeds.ticker_text(url, limit=limit)
            if not text:
                text = str(layer.get("text") or "Ticker — renseignez une source RSS")
            fontsize = int(layer.get("font_size", 40))
            filters.append(f"{src}{draw_text(text, fontsize, box=True, spacing=4)}{out_label}")
            return True

        if ltype == "web":
            # Render a web page or image URL. FFmpeg can fetch a still image over
            # HTTP (png/jpg); true HTML rendering would need a headless browser,
            # so we document that and fall back to the URL as an image source.
            url = str(layer.get("url") or "").strip()
            if not url:
                return False
            lw = int(layer.get("width") or w)
            lh = int(layer.get("height") or h)
            li = add_input(["-t", f"{dur:.3f}", "-i", url])
            filters.append(
                f"[{li}:v]scale={lw}:{lh}:force_original_aspect_ratio=decrease,"
                f"format=rgba,colorchannelmixer=aa={opacity:.3f}[web{n}_{layer_index}]"
            )
            filters.append(f"{src}[web{n}_{layer_index}]overlay={x}:{y}:shortest=1{out_label}")
            return True

        if ltype == "code":
            code = fx.escape_code(str(layer.get("code") or ""))
            if not code:
                return False
            filters.append(f"{src}{code},format=rgba{out_label}")
            return True

        if ltype == "reactive":
            kind = layer.get("visualizer") or "spectrum"
            lw = int(layer.get("width") or w)
            lh = int(layer.get("height") or h)
            chain = fx.visualizer_chain(kind, lw, lh, fps)
            # The visualiser reacts to the item's audio: its background music when
            # present, otherwise the source's own sound, otherwise silence (so the
            # filter graph is always valid).
            audio_src = item.get("background_audio_path")
            if not audio_src and item.get("kind") == "video" and item.get("has_audio"):
                audio_src = item.get("path")
            if audio_src:
                ai = add_input(["-t", f"{dur:.3f}", "-i", audio_src])
            else:
                ai = add_input(["-f", "lavfi", "-t", f"{dur:.3f}", "-i", _SILENCE])
            filters.append(
                f"[{ai}:a]aformat=channel_layouts=stereo,atrim=duration={dur:.3f},"
                f"asetpts=PTS-STARTPTS,{chain}[viz{n}_{layer_index}]"
            )
            filters.append(f"{src}[viz{n}_{layer_index}]overlay={x}:{y}:shortest=1{out_label}")
            return True

        if ltype in ("video", "image", "logo") and layer.get("media_id"):
            media = db.query_one("SELECT path, kind FROM media WHERE id = ?", (layer["media_id"],))
            if not media or not Path(media["path"]).exists():
                return False
            if media["kind"] == "image":
                li = add_input(["-loop", "1", "-t", f"{dur:.3f}", "-i", media["path"]])
            else:
                li = add_input(["-t", f"{dur:.3f}", "-i", media["path"]])
            lw = int(layer.get("width") or w)
            lh = int(layer.get("height") or h)
            # The editor lets the operator drag a layer's edges freely, so the
            # image must fill the box it was given (stretch), not letterbox
            # inside it: a stretched image looks exactly like the editor.
            chain = f"scale={lw}:{lh}"
            blur = float(layer.get("blur") or 0)
            if blur > 0:
                chain += f",gblur=sigma={blur:.1f}"
            chain += f",format=rgba,colorchannelmixer=aa={opacity:.3f}"
            frame = str(layer.get("frame") or "none")
            if frame and frame != "none":
                radius = int(layer.get("frame_radius") or max(12, min(lw, lh) // 6))
                border = int(layer.get("frame_border") or 0)
                if border > 0 and lw > 2 * border and lh > 2 * border:
                    # A coloured shape of the full size, with the image cropped to
                    # the shape and inset by `border` px: the ring left visible is
                    # the border. The colour shape is a self-contained source (a
                    # `color` source filter), so no extra input is needed.
                    bcolor = fx.hex_to_ffmpeg(str(layer.get("frame_color") or "#ffffff"))
                    iw, ih = lw - 2 * border, lh - 2 * border
                    filters.append(f"{fx.frame_color_source(frame, lw, lh, radius, bcolor, dur)}[frb{n}_{layer_index}]")
                    filters.append(
                        f"[{li}:v]scale={iw}:{ih},format=rgba,colorchannelmixer=aa={opacity:.3f},"
                        f"{fx.frame_chain(frame, iw, ih, max(1, radius - border))}[lyr{n}_{layer_index}]"
                    )
                    filters.append(
                        f"[frb{n}_{layer_index}][lyr{n}_{layer_index}]"
                        f"overlay=x={border}:y={border}:shortest=1[lyrf{n}_{layer_index}]"
                    )
                    filters.append(f"{src}[lyrf{n}_{layer_index}]overlay={x}:{y}:shortest=1{out_label}")
                    return True
                chain += "," + fx.frame_chain(frame, lw, lh, radius)
            filters.append(f"[{li}:v]{chain}[lyr{n}_{layer_index}]")
            filters.append(f"{src}[lyr{n}_{layer_index}]overlay={x}:{y}:shortest=1{out_label}")
            return True
        return False


def _mask(value: str) -> str:
    from .security import mask_secret

    return mask_secret(value)


def _countdown_descriptor(item: dict[str, Any]) -> dict[str, Any] | None:
    """First countdown layer of a scene item, or None.

    Lets the interface show countdown controls (start, add time) for whatever is
    in the preview or on air, without re-fetching the whole scene.
    """
    if not item.get("scene_id"):
        return None
    try:
        layers = json.loads(item.get("scene_layers") or "[]")
    except (json.JSONDecodeError, TypeError):
        return None
    for idx, layer in enumerate(layers):
        if isinstance(layer, dict) and layer.get("type") == "countdown":
            return {
                "layer_index": idx,
                "seconds": int(layer.get("countdown_seconds") or 60),
                "mode": layer.get("countdown_mode") or "down",
            }
    return None


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    bg_id = item.get("background_audio_id")
    return {
        "id": item.get("id"),
        "media_id": item.get("media_id"),
        "scene_id": item.get("scene_id"),
        "title": item.get("title") or item.get("scene_name") or "Élément",
        "kind": item.get("kind"),
        "duration": round(item.get("duration") or 0, 2),
        "thumbnail": f"/api/media/{item['media_id']}/thumbnail" if item.get("media_id") else None,
        "stream_url": f"/api/media/{item['media_id']}/stream" if item.get("media_id") else None,
        # Background music of the item (if any) so the operator's monitor can
        # play it in full screen; it is mixed under the item on air.
        "background_audio_id": bg_id,
        "background_audio_url": f"/api/media/{bg_id}/stream" if bg_id else None,
        "background_audio_title": item.get("bg_title"),
        "background_volume": float(item.get("background_volume") or 0),
        "background_audio_continue": bool(item.get("background_audio_continue")),
        "countdown": _countdown_descriptor(item),
        "exists": bool(item.get("exists")),
    }


_engine: PlaybackEngine | None = None
_engine_lock = threading.Lock()


def get_engine() -> PlaybackEngine:
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = PlaybackEngine()
        return _engine
