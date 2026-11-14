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
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import config, db

log = logging.getLogger("locallive.engine")

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
]

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


def _ffmpeg_available() -> bool:
    return shutil.which(config.FFMPEG_BIN) is not None


def _font_path() -> str | None:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None


def _hex_to_ffmpeg(value: str) -> str:
    """Accept #rrggbb or rrggbb and return FFmpeg's 0xrrggbb form."""
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if len(value) != 6:
        return "0x000000"
    return f"0x{value}"


def _escape_drawtext(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace("\n", "\\n")
    )


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

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    def start(self, playlist_id: int, config_override: dict[str, Any] | None = None) -> dict[str, Any]:
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
            return {"ok": True, "state": self.status()}

    def stop(self) -> dict[str, Any]:
        with self._lock:
            self._stop_event.set()
            self._terminate_process()
            self._state.running = False
            self._state.starting = False
            self._state.pid = None
        if self._supervisor and self._supervisor.is_alive():
            self._supervisor.join(timeout=3)
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
                      m.id AS media_id, m.title, m.path, m.kind, m.duration, m.has_audio,
                      m.width, m.height, m.fps, m.video_codec, m.audio_codec, m.thumbnail,
                      s.id AS scene_id, s.name AS scene_name, s.layers AS scene_layers,
                      s.width AS scene_width, s.height AS scene_height, s.background AS scene_bg
               FROM playlist_items pi
               LEFT JOIN media m ON m.id = pi.media_id
               LEFT JOIN scenes s ON s.id = pi.scene_id
               WHERE pi.playlist_id = ?
               ORDER BY pi.position""",
            (playlist_id,),
        )
        default_image = float(db.get_setting("image_duration", "5") or 5)
        items: list[dict[str, Any]] = []
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
            items.append(d)
        return items

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
        usable = [i for i in items if i.get("exists") and (i["kind"] != "audio" or i["duration"] > 0)]
        if not usable:
            usable = [i for i in items if i.get("exists")]
        if self._can_stream_copy(usable):
            try:
                return self._build_copy_command(usable, output), "copy"
            except OSError:
                pass
        return self._build_filter_command(usable, output), "filter"

    def _can_stream_copy(self, items: list[dict[str, Any]]) -> bool:
        if not items or any(i["kind"] != "video" for i in items):
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

    def _build_filter_command(self, items: list[dict[str, Any]], output: OutputConfig) -> list[str]:
        w, h, fps = output.width, output.height, output.fps
        inputs: list[str] = []
        filters: list[str] = []
        concat_refs: list[str] = []
        counter = [0]  # number of -i inputs declared so far
        font = _font_path()

        def add_input(args: list[str]) -> int:
            index = counter[0]
            inputs.extend(args)
            counter[0] += 1
            return index

        v_norm = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,"
            f"fps={fps},format=yuv420p"
        )
        a_norm = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"

        for n, item in enumerate(items):
            dur = max(item["duration"] or 0, 0.2)
            if item["kind"] == "image":
                vi = add_input(["-loop", "1", "-t", f"{dur:.3f}", "-i", item["path"]])
                ai = add_input(["-f", "lavfi", "-t", f"{dur:.3f}", "-i", _SILENCE])
                filters.append(f"[{vi}:v]{v_norm},trim=duration={dur:.3f},setpts=PTS-STARTPTS[v{n}]")
                filters.append(f"[{ai}:a]anull[a{n}]")
            elif item["kind"] == "audio":
                ai = add_input(["-t", f"{dur:.3f}", "-i", item["path"]])
                vi = add_input(["-f", "lavfi", "-t", f"{dur:.3f}", "-i", f"color=c=black:s={w}x{h}:r={fps}"])
                filters.append(f"[{vi}:v]{v_norm},trim=duration={dur:.3f},setpts=PTS-STARTPTS[v{n}]")
                filters.append(f"[{ai}:a]{a_norm},atrim=duration={dur:.3f},asetpts=PTS-STARTPTS[a{n}]")
            elif item["kind"] == "scene":
                self._scene_graph(item, filters, add_input, w, h, fps, font, n)
                ai = add_input(["-f", "lavfi", "-t", f"{dur:.3f}", "-i", _SILENCE])
                filters.append(f"[{ai}:a]anull[a{n}]")
            else:  # video (single input reused for both streams)
                pre = ["-re"] if output.realtime else []
                vi = add_input(pre + ["-i", item["path"]])
                filters.append(f"[{vi}:v]{v_norm},setpts=PTS-STARTPTS[v{n}]")
                if item["has_audio"]:
                    filters.append(f"[{vi}:a]{a_norm},asetpts=PTS-STARTPTS[a{n}]")
                else:
                    ai = add_input(["-f", "lavfi", "-t", f"{dur:.3f}", "-i", _SILENCE])
                    filters.append(f"[{ai}:a]anull[a{n}]")
            concat_refs.append(f"[v{n}][a{n}]")

        n = len(items)
        filters.append("".join(concat_refs) + f"concat=n={n}:v=1:a=1[outv][outa]")
        filter_complex = ";".join(filters)

        cmd = [config.FFMPEG_BIN, "-hide_banner", "-nostdin", "-loglevel", "warning"]
        cmd += inputs
        cmd += ["-filter_complex", filter_complex, "-map", "[outv]", "-map", "[outa]"]
        cmd += [
            "-c:v", "libx264",
            "-preset", output.preset,
            "-tune", "zerolatency",
            "-b:v", f"{output.bitrate}k",
            "-maxrate", f"{output.bitrate}k",
            "-bufsize", f"{output.bitrate * 2}k",
            "-pix_fmt", "yuv420p",
            "-g", str(output.fps * 2),
            "-keyint_min", str(output.fps),
            "-sc_threshold", "0",
            "-c:a", "aac",
            "-b:a", f"{output.audio_bitrate}k",
            "-ar", "48000",
        ]
        cmd += ["-progress", "pipe:1", "-nostats"]
        cmd += self._output_args(output)
        return cmd

    def _scene_graph(
        self, item: dict[str, Any], filters: list[str], add_input,
        w: int, h: int, fps: int, font: str | None, n: int,
    ) -> None:
        """Compose scene layers onto a background; emits the [vN] video label."""
        dur = max(item["duration"] or 0, 0.2)
        bg = _hex_to_ffmpeg(item.get("scene_bg") or "#000000")
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
            ltype = layer.get("type")
            x, y = int(layer.get("x", 0)), int(layer.get("y", 0))
            opacity = float(layer.get("opacity", 1.0))
            out_label = f"[sc{n}_{layer_index}]"
            if ltype in ("video", "image", "logo") and layer.get("media_id"):
                media = db.query_one("SELECT path, kind FROM media WHERE id = ?", (layer["media_id"],))
                if not media or not Path(media["path"]).exists():
                    continue
                if media["kind"] == "image":
                    li = add_input(["-loop", "1", "-t", f"{dur:.3f}", "-i", media["path"]])
                else:
                    li = add_input(["-t", f"{dur:.3f}", "-i", media["path"]])
                lw = int(layer.get("width") or w)
                lh = int(layer.get("height") or h)
                filters.append(
                    f"[{li}:v]scale={lw}:{lh}:force_original_aspect_ratio=decrease,"
                    f"format=rgba,colorchannelmixer=aa={opacity:.3f}[lyr{n}_{layer_index}]"
                )
                filters.append(f"{current}[lyr{n}_{layer_index}]overlay={x}:{y}:shortest=1{out_label}")
                current = out_label
                layer_index += 1
            elif ltype in ("text", "overlay") and layer.get("text"):
                text = _escape_drawtext(str(layer["text"]))
                default_size = 48 if ltype == "text" else 36
                fontsize = int(layer.get("font_size", default_size))
                color = _hex_to_ffmpeg(layer.get("color") or "#ffffff")
                drawtext = f"drawtext=text='{text}':x={x}:y={y}:fontsize={fontsize}:fontcolor={color}"
                if font:
                    drawtext += f":fontfile={font}"
                if layer.get("background"):
                    boxcolor = _hex_to_ffmpeg(str(layer["background"]))
                    drawtext += f":box=1:boxcolor={boxcolor}@0.6:boxborderw=10"
                filters.append(f"{current}{drawtext}{out_label}")
                current = out_label
                layer_index += 1
        filters.append(f"{current}format=yuv420p,fps={fps}[v{n}]")


def _mask(value: str) -> str:
    from .security import mask_secret

    return mask_secret(value)


def _public_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "media_id": item.get("media_id"),
        "scene_id": item.get("scene_id"),
        "title": item.get("title") or item.get("scene_name") or "Élément",
        "kind": item.get("kind"),
        "duration": round(item.get("duration") or 0, 2),
        "thumbnail": f"/api/media/{item['media_id']}/thumbnail" if item.get("media_id") else None,
        "stream_url": f"/api/media/{item['media_id']}/stream" if item.get("media_id") else None,
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
