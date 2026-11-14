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
# An animation turns the static placement of a text/overlay layer into a
# time-varying expression. Each entry returns x/y/alpha expressions that are
# drawtext-compatible (they may use `t`, `w`, `h`, `tw`, `th`, `fontsize`).
ANIMATIONS: dict[str, dict[str, str]] = {
    "none": {
        "label": "Aucune",
        "description": "Position fixe.",
    },
    "marquee": {
        "label": "Défilement (marquee)",
        "description": "Le calque traverse l'écran de droite à gauche.",
        "speed_default": "80",
    },
    "countdown": {
        "label": "Compte à rebours",
        "description": "Affiche le temps restant, décroissant chaque seconde.",
    },
    "blink": {
        "label": "Clignotement",
        "description": "Le calque apparaît et disparaît périodiquement.",
        "speed_default": "1.5",
    },
    "pulse": {
        "label": "Pulsation",
        "description": "L'opacité respire entre deux valeurs.",
        "speed_default": "1.0",
    },
    "fade": {
        "label": "Fondu d'entrée",
        "description": "Apparition en fondu sur la première seconde.",
        "speed_default": "1.0",
    },
    "slide": {
        "label": "Glissement d'entrée",
        "description": "Entrée par le bord gauche.",
        "speed_default": "1.0",
    },
}


def _float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def animation_exprs(
    animation: str,
    x: float,
    y: float,
    *,
    speed: Any = None,
    duration: float = 0.0,
) -> dict[str, str]:
    """Return drawtext x/y/alpha expressions for a layer animation.

    `duration` is the visible duration of the layer (seconds); it is used by the
    countdown to compute the remaining time and by the slide/fade to spread the
    transition. Unknown animations fall back to the static position.
    """
    animation = animation or "none"
    base_x, base_y = str(int(x)), str(int(y))
    if animation == "marquee":
        v = int(_float(speed, _float(ANIMATIONS["marquee"].get("speed_default"), 80)))
        return {"x": f"w-mod(t*{v}\\,w+tw)", "y": base_y, "alpha": "1"}
    if animation == "countdown":
        remaining = max(int(round(duration)), 0) if duration else 0
        # t is time since layer start; show ceil(remaining - t), clamped at 0.
        return {
            "x": base_x,
            "y": base_y,
            "alpha": "1",
            "text_expr": f"max(0\\,{remaining}-floor(t))",
        }
    if animation == "blink":
        v = _float(speed, _float(ANIMATIONS["blink"].get("speed_default"), 1.5))
        period = max(1.0 / v, 0.05) * 2
        return {"x": base_x, "y": base_y, "alpha": f"if(lt(mod(t\\,{period:.3f})\\,{period / 2:.3f})\\,1\\,0)"}
    if animation == "pulse":
        v = _float(speed, _float(ANIMATIONS["pulse"].get("speed_default"), 1.0))
        return {
            "x": base_x,
            "y": base_y,
            "alpha": f"0.35+0.65*(1+sin(2*PI*{v:.3f}*t))/2",
        }
    if animation == "fade":
        d = max(_float(speed, 1.0), 0.05)
        return {"x": base_x, "y": base_y, "alpha": f"min(t/{d:.3f}\\,1)"}
    if animation == "slide":
        d = max(_float(speed, 1.0), 0.05)
        return {"x": f"{base_x}-tw*(1-min(t/{d:.3f}\\,1))", "y": base_y, "alpha": "1"}
    return {"x": base_x, "y": base_y, "alpha": "1"}


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
