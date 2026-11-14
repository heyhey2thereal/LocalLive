"""Visual effects for the playback engine.

Keeps the FFmpeg filter vocabulary in one place so the engine, the scene editor
and the API catalogue stay in sync:

  * layer animations    — marquee, countdown, blink, pulse, fade/slide;
  * reactive visualisers — spectrum, wave, bars, vectorscope (driven by audio);
  * transitions          — the subset of xfade/acrossfade we expose in the UI;
  * code escaping        — safe wrapping of a user-provided FFmpeg filter chain.

Every helper returns plain FFmpeg filter strings; nothing here touches the
database or the process layer.
"""
from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
]


def font_path() -> str | None:
    from pathlib import Path

    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None


# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
def hex_to_ffmpeg(value: str) -> str:
    """Accept #rrggbb or rrggbb and return FFmpeg's 0xrrggbb form."""
    value = (value or "").strip().lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if len(value) != 6:
        return "0x000000"
    return f"0x{value}"


def escape_drawtext(text: str) -> str:
    """Escape a string for use inside drawtext=text='...'."""
    return (
        text.replace("\\", "\\\\")
        .replace(":", "\\:")
        .replace("'", "\\'")
        .replace("%", "\\%")
        .replace("\n", "\\n")
    )


def escape_code(code: str) -> str:
    """Sanitise a user-provided FFmpeg filter chain used inside filter_complex.

    We remove the characters that would let the value escape its own chain and
    rewrite the graph: the semicolon (chain separator), the square brackets
    (input/output labels) and the newline. Commas are kept — they separate the
    filters of a single chain, which is exactly what a "code" layer is for (e.g.
    ``hflip,vflip``). Colons and equals are valid filter arguments and untouched.
    Whitespace is collapsed to keep the command readable.
    """
    forbidden = "[];"
    cleaned = "".join(" " if ch in forbidden or ch == "\n" else ch for ch in (code or ""))
    return " ".join(cleaned.split())


# ---------------------------------------------------------------------------
# Layer animations
# ---------------------------------------------------------------------------
# Three independent families, combined by layer_motion():
#   * IN   — plays once at the start (fade in, slide in, zoom in…)
#   * LOOP — plays forever while the layer is visible (blink, pulse, shake…)
#   * OUT  — plays once at the end (fade out, slide out…)
# Each entry carries a human description so the UI can explain what it does.
IN_ANIMATIONS: dict[str, dict[str, Any]] = {
    "none": {"label": "Aucune", "description": "Apparition instantanée."},
    "fade": {"label": "Fondu", "description": "Apparition progressive.", "duration_default": 0.6},
    "slideleft": {"label": "Depuis la droite", "description": "Entre en glissant depuis la droite.", "duration_default": 0.5},
    "slideright": {"label": "Depuis la gauche", "description": "Entre en glissant depuis la gauche.", "duration_default": 0.5},
    "slideup": {"label": "Depuis le bas", "description": "Entre en glissant depuis le bas.", "duration_default": 0.5},
    "slidedown": {"label": "Depuis le haut", "description": "Entre en glissant depuis le haut.", "duration_default": 0.5},
    "zoomin": {"label": "Zoom avant", "description": "Grossit jusqu'à sa taille.", "duration_default": 0.5},
    "pop": {"label": "Pop", "description": "Apparaît avec un petit rebond.", "duration_default": 0.4},
}

LOOP_ANIMATIONS: dict[str, dict[str, Any]] = {
    "none": {"label": "Aucune", "description": "Statique."},
    "marquee": {"label": "Défilement", "description": "Traverse l'écran de droite à gauche.", "speed_default": 80},
    "blink": {"label": "Clignotement", "description": "Apparaît/disparaît périodiquement.", "speed_default": 1.5},
    "pulse": {"label": "Pulsation", "description": "L'opacité respire.", "speed_default": 1.0},
    "shake": {"label": "Tremblement", "description": "Vibre légèrement sur place.", "speed_default": 6},
    "float": {"label": "Flottement", "description": "Monte et descend doucement.", "speed_default": 0.5},
    "spin": {"label": "Rotation lente", "description": "Tourne lentement sur elle-même.", "speed_default": 0.1},
    "pulse_size": {"label": "Respiration", "description": "Grossit et rétrécit doucement.", "speed_default": 0.8},
    "rainbow": {"label": "Couleurs", "description": "Alterne la couleur (texte).", "speed_default": 0.5},
}

OUT_ANIMATIONS: dict[str, dict[str, Any]] = {
    "none": {"label": "Aucune", "description": "Disparition instantanée."},
    "fade": {"label": "Fondu", "description": "Disparition progressive.", "duration_default": 0.6},
    "slideleft": {"label": "Vers la gauche", "description": "Sort en glissant vers la gauche.", "duration_default": 0.5},
    "slideright": {"label": "Vers la droite", "description": "Sort en glissant vers la droite.", "duration_default": 0.5},
    "slideup": {"label": "Vers le haut", "description": "Sort en glissant vers le haut.", "duration_default": 0.5},
    "slidedown": {"label": "Vers le bas", "description": "Sort en glissant vers le bas.", "duration_default": 0.5},
    "zoomout": {"label": "Zoom arrière", "description": "Rétrécit en disparaissant.", "duration_default": 0.5},
}

# Kept for backward compatibility with older scenes that stored a single
# `animation` field.
ANIMATIONS: dict[str, dict[str, str]] = {
    "none": {"label": "Aucune", "description": "Position fixe."},
    "marquee": {"label": "Défilement (marquee)", "description": "Le calque traverse l'écran."},
    "countdown": {"label": "Compte à rebours", "description": "Affiche le temps restant."},
    "blink": {"label": "Clignotement", "description": "Apparaît et disparaît."},
    "pulse": {"label": "Pulsation", "description": "L'opacité respire."},
    "fade": {"label": "Fondu d'entrée", "description": "Apparition en fondu."},
    "slide": {"label": "Glissement d'entrée", "description": "Entrée par le bord gauche."},
}


def _float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _in_exprs(kind: str, x: float, y: float, d: float) -> dict[str, str]:
    """Entry animation. `d` is the animation duration in seconds."""
    bx, by = str(int(x)), str(int(y))
    if kind == "fade":
        return {"x": bx, "y": by, "alpha": f"min(t/{d:.3f}\\,1)"}
    if kind == "slideleft":
        return {"x": f"{bx}+tw*(1-min(t/{d:.3f}\\,1))", "y": by, "alpha": "1"}
    if kind == "slideright":
        return {"x": f"{bx}-tw*(1-min(t/{d:.3f}\\,1))", "y": by, "alpha": "1"}
    if kind == "slideup":
        return {"x": bx, "y": f"{by}+th*(1-min(t/{d:.3f}\\,1))", "alpha": "1"}
    if kind == "slidedown":
        return {"x": bx, "y": f"{by}-th*(1-min(t/{d:.3f}\\,1))", "alpha": "1"}
    if kind in ("zoomin", "pop"):
        return {"x": bx, "y": by, "alpha": f"min(t/{d:.3f}\\,1)"}
    return {"x": bx, "y": by, "alpha": "1"}


def _out_exprs(kind: str, x: float, y: float, d: float, duration: float) -> dict[str, str]:
    """Exit animation. `d` is the duration; it plays at the end of the layer."""
    bx, by = str(int(x)), str(int(y))
    start = max(duration - d, 0.0)
    tail = f"max((t-{start:.3f})/{d:.3f}\\,0)"
    if kind == "fade":
        return {"x": bx, "y": by, "alpha": f"(1-min({tail}\\,1))"}
    if kind == "slideleft":
        return {"x": f"{bx}-tw*min({tail}\\,1)", "y": by, "alpha": "1"}
    if kind == "slideright":
        return {"x": f"{bx}+tw*min({tail}\\,1)", "y": by, "alpha": "1"}
    if kind == "slideup":
        return {"x": bx, "y": f"{by}-th*min({tail}\\,1)", "alpha": "1"}
    if kind == "slidedown":
        return {"x": bx, "y": f"{by}+th*min({tail}\\,1)", "alpha": "1"}
    if kind == "zoomout":
        return {"x": bx, "y": by, "alpha": f"(1-min({tail}\\,1))"}
    return {"x": bx, "y": by, "alpha": "1"}


def _loop_exprs(kind: str, x: float, y: float, speed: Any, duration: float) -> dict[str, str]:
    """Loop animation, applied between the in and out animations."""
    bx, by = str(int(x)), str(int(y))
    if kind == "marquee":
        v = int(_float(speed, _float(LOOP_ANIMATIONS["marquee"]["speed_default"], 80)))
        return {"x": f"w-mod(t*{v}\\,w+tw)", "y": by, "alpha": "1"}
    if kind == "blink":
        v = _float(speed, _float(LOOP_ANIMATIONS["blink"]["speed_default"], 1.5))
        period = max(1.0 / v, 0.05) * 2
        return {"x": bx, "y": by, "alpha": f"if(lt(mod(t\\,{period:.3f})\\,{period / 2:.3f})\\,1\\,0)"}
    if kind == "pulse":
        v = _float(speed, _float(LOOP_ANIMATIONS["pulse"]["speed_default"], 1.0))
        return {"x": bx, "y": by, "alpha": f"0.35+0.65*(1+sin(2*PI*{v:.3f}*t))/2"}
    if kind == "shake":
        amp = _float(speed, _float(LOOP_ANIMATIONS["shake"]["speed_default"], 6))
        return {"x": f"{bx}+{amp}*sin(40*t)", "y": f"{by}+{amp}*cos(37*t)", "alpha": "1"}
    if kind == "float":
        amp = _float(speed, _float(LOOP_ANIMATIONS["float"]["speed_default"], 0.5)) * 40
        return {"x": bx, "y": f"{by}+{amp:.1f}*sin(2*PI*0.3*t)", "alpha": "1"}
    if kind == "spin":
        return {"x": bx, "y": by, "alpha": "1", "rotate": f"360*{_float(speed, 0.1):.3f}*t"}
    if kind == "pulse_size":
        return {"x": bx, "y": by, "alpha": f"0.6+0.4*(1+sin(2*PI*{_float(speed, 0.8):.3f}*t))/2"}
    if kind == "rainbow":
        return {"x": bx, "y": by, "alpha": "1"}
    return {"x": bx, "y": by, "alpha": "1"}


def layer_motion(
    x: float,
    y: float,
    *,
    anim_in: str = "none",
    anim_loop: str = "none",
    anim_out: str = "none",
    speed: Any = None,
    duration: float = 0.0,
) -> dict[str, str]:
    """Combine in/loop/out animations into drawtext x/y/alpha expressions.

    Position: the loop wins for the steady state, then in/out refine it. Alpha:
    the three alphas are multiplied so, e.g., a pulse loop still shows through a
    final fade out.
    """
    loop = _loop_exprs(anim_loop or "none", x, y, speed, duration)
    result = dict(loop)
    alphas = [loop.get("alpha", "1")]

    if anim_in and anim_in != "none":
        d = max(_float(speed, 0.5), 0.05)
        got = _in_exprs(anim_in, x, y, d)
        # Only let the entry animation drive position when there is no loop.
        if anim_loop in (None, "", "none"):
            result["x"], result["y"] = got["x"], got["y"]
        alphas.append(got.get("alpha", "1"))

    if anim_out and anim_out != "none":
        d = max(_float(speed, 0.5), 0.05)
        got = _out_exprs(anim_out, x, y, d, duration)
        if anim_loop in (None, "", "none"):
            result["x"], result["y"] = got["x"], got["y"]
        alphas.append(got.get("alpha", "1"))

    if len(alphas) == 1:
        result["alpha"] = alphas[0]
    else:
        result["alpha"] = "*".join(f"({a})" for a in alphas)
    return result


def animation_exprs(animation: str, x: float, y: float, *, speed: Any = None, duration: float = 0.0) -> dict[str, str]:
    """Backward-compatible single-animation helper (older scenes)."""
    animation = animation or "none"
    base_x, base_y = str(int(x)), str(int(y))
    if animation == "countdown":
        remaining = max(int(round(duration)), 0) if duration else 0
        return {"x": base_x, "y": base_y, "alpha": "1", "text_expr": f"max(0\\,{remaining}-floor(t))"}
    if animation in LOOP_ANIMATIONS:
        return _loop_exprs(animation, x, y, speed, duration)
    if animation in ("fade",):
        return _in_exprs("fade", x, y, max(_float(speed, 1.0), 0.05))
    if animation in ("slide",):
        return _in_exprs("slideright", x, y, max(_float(speed, 1.0), 0.05))
    return {"x": base_x, "y": base_y, "alpha": "1"}


def in_animations_catalog() -> list[dict[str, Any]]:
    return [{"id": k, "label": v["label"], "description": v.get("description", ""), "duration_default": v.get("duration_default")} for k, v in IN_ANIMATIONS.items()]


def loop_animations_catalog() -> list[dict[str, Any]]:
    return [{"id": k, "label": v["label"], "description": v.get("description", ""), "speed_default": v.get("speed_default")} for k, v in LOOP_ANIMATIONS.items()]


def out_animations_catalog() -> list[dict[str, Any]]:
    return [{"id": k, "label": v["label"], "description": v.get("description", ""), "duration_default": v.get("duration_default")} for k, v in OUT_ANIMATIONS.items()]


# ---------------------------------------------------------------------------
# Reactive visualisers
# ---------------------------------------------------------------------------
# Each visualiser turns an audio stream into a video stream whose size matches
# the layer box. The helper returns the filter chain that must be appended after
# an audio label, ending with `format=rgba` so it can be overlaid on a scene.
VISUALIZERS: dict[str, dict[str, str]] = {
    "spectrum": {
        "label": "Spectre",
        "description": "Analyse spectrale en couleurs.",
        "filter": "showspectrum=mode=combined:color=intensity:scale=cbrt",
    },
    "wave": {
        "label": "Oscilloscope",
        "description": "Forme d'onde au fil du temps.",
        "filter": "showwaves=mode=cline",
    },
    "bars": {
        "label": "Barres",
        "description": "Barres de fréquences.",
        "filter": "showfreqs=mode=bar:ascale=cbrt",
    },
    "vectorscope": {
        "label": "Vectorscope",
        "description": "Figure de Lissajous stéréo.",
        "filter": "avectorscope=mode=lissajous",
    },
}


def visualizer_chain(kind: str, width: int, height: int, fps: int) -> str:
    """Filter chain (without a leading label) for a reactive visualiser.

    The chain starts from an audio stream, scales the produced video to the
    requested box and normalises the frame rate and pixel format. The frame rate
    is set with a dedicated `fps` filter rather than each visualiser's own
    option, because only some of them expose a `rate` parameter.
    """
    spec = VISUALIZERS.get(kind) or VISUALIZERS["spectrum"]
    return f"{spec['filter']}:s={int(width)}x{int(height)},fps={int(fps)},format=rgba"


# ---------------------------------------------------------------------------
# Transitions
# ---------------------------------------------------------------------------
# The keys are the values stored on playlist_items.transition. `ffmpeg` maps to
# an xfade transition name; the same key is applied to acrossfade (which only
# supports a cross fade, so any transition degrades gracefully to a fade).
TRANSITIONS: dict[str, dict[str, Any]] = {
    "cut": {"label": "Coupe franche", "ffmpeg": None, "default_duration": 0.0},
    "fade": {"label": "Fondu", "ffmpeg": "fade", "default_duration": 0.5},
    "fadeblack": {"label": "Fondu au noir", "ffmpeg": "fadeblack", "default_duration": 0.5},
    "fadewhite": {"label": "Fondu au blanc", "ffmpeg": "fadewhite", "default_duration": 0.5},
    "dissolve": {"label": "Dissolution", "ffmpeg": "dissolve", "default_duration": 0.6},
    "wipeleft": {"label": "Balayage gauche", "ffmpeg": "wipeleft", "default_duration": 0.6},
    "wiperight": {"label": "Balayage droite", "ffmpeg": "wiperight", "default_duration": 0.6},
    "wipeup": {"label": "Balayage haut", "ffmpeg": "wipeup", "default_duration": 0.6},
    "wipedown": {"label": "Balayage bas", "ffmpeg": "wipedown", "default_duration": 0.6},
    "slideleft": {"label": "Glissement gauche", "ffmpeg": "slideleft", "default_duration": 0.6},
    "slideright": {"label": "Glissement droite", "ffmpeg": "slideright", "default_duration": 0.6},
    "slideup": {"label": "Glissement haut", "ffmpeg": "slideup", "default_duration": 0.6},
    "slidedown": {"label": "Glissement bas", "ffmpeg": "slidedown", "default_duration": 0.6},
    "circlecrop": {"label": "Cercle", "ffmpeg": "circlecrop", "default_duration": 0.7},
    "rectcrop": {"label": "Rectangle", "ffmpeg": "rectcrop", "default_duration": 0.7},
    "radial": {"label": "Radial", "ffmpeg": "radial", "default_duration": 0.7},
    "circleopen": {"label": "Cercle ouvrant", "ffmpeg": "circleopen", "default_duration": 0.7},
    "circleclose": {"label": "Cercle fermant", "ffmpeg": "circleclose", "default_duration": 0.7},
    "pixelize": {"label": "Pixellisation", "ffmpeg": "pixelize", "default_duration": 0.7},
    "hblur": {"label": "Flou horizontal", "ffmpeg": "hblur", "default_duration": 0.7},
    "squeezeh": {"label": "Compression horizontale", "ffmpeg": "squeezeh", "default_duration": 0.6},
    "squeezev": {"label": "Compression verticale", "ffmpeg": "squeezev", "default_duration": 0.6},
    "zoomin": {"label": "Zoom", "ffmpeg": "zoomin", "default_duration": 0.7},
    "hlwind": {"label": "Vent horizontal", "ffmpeg": "hlwind", "default_duration": 0.8},
    "coverleft": {"label": "Recouvrement gauche", "ffmpeg": "coverleft", "default_duration": 0.6},
    "revealright": {"label": "Révélation droite", "ffmpeg": "revealright", "default_duration": 0.6},
}


def transition_name(transition: str) -> str | None:
    """Return the xfade transition name, or None for a hard cut."""
    spec = TRANSITIONS.get(transition or "cut")
    return spec["ffmpeg"] if spec else None


def transition_duration(transition: str, requested: float | None) -> float:
    """Resolve the effective transition duration (seconds).

    A hard cut always returns 0. Otherwise the explicit value wins; when it is
    missing or zero we fall back to the transition's default.
    """
    if not transition_name(transition):
        return 0.0
    default = float(TRANSITIONS[transition]["default_duration"])
    if requested is None:
        return default
    value = _float(requested, default)
    return value if value > 0 else default


def transitions_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": key,
            "label": spec["label"],
            "default_duration": spec["default_duration"],
            "hard_cut": spec["ffmpeg"] is None,
        }
        for key, spec in TRANSITIONS.items()
    ]


def animations_catalog() -> list[dict[str, Any]]:
    return [
        {
            "id": key,
            "label": spec["label"],
            "description": spec.get("description", ""),
            "speed_default": spec.get("speed_default"),
        }
        for key, spec in ANIMATIONS.items()
    ]


def visualizers_catalog() -> list[dict[str, Any]]:
    return [
        {"id": key, "label": spec["label"], "description": spec["description"]}
        for key, spec in VISUALIZERS.items()
    ]


# ---------------------------------------------------------------------------
# Clock / date layer
# ---------------------------------------------------------------------------
# Common strftime patterns offered by the editor. The value stored on the layer
# is a strftime format string; it is shown by FFmpeg's drawtext via the `%{gmtime}`
# expansion (or `localtime` on hosts where the timezone is set).
CLOCK_FORMATS: list[dict[str, str]] = [
    {"id": "%H:%M", "label": "Heure (24h) · 14:05"},
    {"id": "%H:%M:%S", "label": "Heure avec secondes · 14:05:09"},
    {"id": "%I:%M %p", "label": "Heure (12h) · 02:05 PM"},
    {"id": "%d/%m/%Y", "label": "Date · 14/11/2026"},
    {"id": "%A %d %B", "label": "Jour et date · samedi 14 novembre"},
    {"id": "%d/%m/%Y %H:%M", "label": "Date et heure · 14/11/2026 14:05"},
    {"id": "%H:%M · %d/%m", "label": "Heure et jour · 14:05 · 14/11"},
]

# strftime -> drawtext strftime tokens are almost identical, but the leading '%'
# must be escaped in the filter string and day/month names are locale-dependent.
# We keep the mapping minimal and pass the format through mostly unchanged.
CLOCK_LOCALES: list[dict[str, str]] = [
    {"id": "fr_FR", "label": "Français"},
    {"id": "en_US", "label": "English"},
    {"id": "es_ES", "label": "Español"},
    {"id": "de_DE", "label": "Deutsch"},
]


def clock_formats_catalog() -> list[dict[str, str]]:
    return [dict(entry) for entry in CLOCK_FORMATS]


def clock_locales_catalog() -> list[dict[str, str]]:
    return [dict(entry) for entry in CLOCK_LOCALES]


# A strftime directive: "%" followed by a letter, or "%%" for a literal percent.
_STRFTIME_DIRECTIVE = re.compile(r"%[A-Za-z]|%%")


def _escape_clock_literal(text: str) -> str:
    """Escape literal text for use inside a drawtext `text=` value.

    A colon must be escaped so the filtergraph parser does not read it as an
    option separator; a backslash and a quote are escaped for the same reason.
    """
    return text.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def clock_text_expr(fmt: str, *, utc: bool = False) -> str:
    """Build the FFmpeg drawtext expansion for a live clock.

    FFmpeg exposes `gmtime` (UTC) and `localtime` (host timezone) as
    `%{localtime:FORMAT}`, but the expansion parser treats every colon inside the
    format as an argument separator, so `%{localtime:%H:%M}` is rejected. We
    therefore expand each strftime directive on its own and join the pieces with
    escaped literal separators, e.g. `%{localtime\\:%H}\\:%{localtime\\:%M}`.
    """
    source = "gmtime" if utc else "localtime"
    fmt = fmt or "%H:%M"
    parts: list[str] = []
    pos = 0
    for match in _STRFTIME_DIRECTIVE.finditer(fmt):
        parts.append(_escape_clock_literal(fmt[pos:match.start()]))
        token = match.group(0)
        if token == "%%":
            parts.append("%")
        else:
            parts.append(f"%{{{source}\\:{token}}}")
        pos = match.end()
    parts.append(_escape_clock_literal(fmt[pos:]))
    return "".join(parts)

