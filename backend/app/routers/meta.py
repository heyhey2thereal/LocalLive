"""Shared catalogue: transitions, animations and reactive visualisers.

The frontend scene editor and playlist transition picker both read this single
source of truth so the labels and identifiers never drift from what the engine
actually supports (see fx.py).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends

from .. import fx, permissions
from ..deps import current_user

router = APIRouter(prefix="/api/meta", tags=["meta"])


# Each layer type ships with a label, a short help line and the API it uses, so
# the editor can explain how it works inline.
LAYER_TYPES = [
    {
        "id": "text",
        "label": "Texte",
        "help": "Affiche un texte fixe. Choisissez la police (taille), la couleur et un fond optionnel.",
    },
    {
        "id": "image",
        "label": "Image",
        "help": "Place une image de la médiathèque. Elle est mise à l'échelle sans déborder du cadre.",
    },
    {
        "id": "video",
        "label": "Vidéo",
        "help": "Joue une vidéo de la médiathèque, lue en boucle pour la durée de la scène.",
    },
    {
        "id": "chat",
        "label": "Chat box",
        "help": "Affiche les derniers messages d'une source. Envoyez-les avec POST /api/chat/<source> ({\"user\",\"text\"}).",
    },
    {
        "id": "code",
        "label": "Code FFmpeg",
        "help": "Chaîne de filtres FFmpeg personnalisée (ex. hflip, gblur=sigma=8). Séparés par des virgules.",
    },
    {
        "id": "web",
        "label": "URL web",
        "help": "Affiche une image depuis une URL http(s) (png/jpg). Pour une page HTML complète, capturez-la d'abord en image.",
    },
    {
        "id": "countdown",
        "label": "Compte à rebours",
        "help": "Affiche un compteur. Réglez la durée de départ et le sens (décompte ou comptage).",
    },
    {
        "id": "clock",
        "label": "Horloge",
        "help": "Affiche l'heure et/ou la date en direct. Choisissez le format (heure, date, jour) et le fuseau.",
    },
    {
        "id": "ticker",
        "label": "Bandeau d'actualités (RSS)",
        "help": "Bandeau défilant alimenté par un flux RSS/Atom. Collez l'URL du flux ; le texte est mis en cache quelques minutes.",
    },
    {
        "id": "reactive",
        "label": "Réactif (audio)",
        "help": "Visualiseur piloté par l'audio de l'élément : spectre, oscilloscope, barres, vectorscope.",
    },
    {
        "id": "logo",
        "label": "Logo",
        "help": "Place un logo (image) de la médiathèque, avec opacité réglable.",
    },
    {
        "id": "overlay",
        "label": "Bandeau",
        "help": "Bandeau de texte avec fond, idéal pour les titres et sous-titres.",
    },
]


@router.get("/catalog")
def catalog(user: dict = Depends(current_user)) -> dict[str, Any]:
    return {
        "transitions": fx.transitions_catalog(),
        "animations": fx.animations_catalog(),
        "anim_in": fx.in_animations_catalog(),
        "anim_loop": fx.loop_animations_catalog(),
        "anim_out": fx.out_animations_catalog(),
        "visualizers": fx.visualizers_catalog(),
        "clock_formats": fx.clock_formats_catalog(),
        "clock_locales": fx.clock_locales_catalog(),
        "roles": permissions.ROLES,
        "capabilities": permissions.capabilities_catalog(),
        "layer_types": LAYER_TYPES,
        "code_examples": [
            {"label": "Miroir horizontal", "code": "hflip"},
            {"label": "Miroir vertical", "code": "vflip"},
            {"label": "Niveaux de gris", "code": "format=gray"},
            {"label": "Flou", "code": "gblur=sigma=8"},
            {"label": "Netteté", "code": "unsharp=5:5:1.0"},
            {"label": "Inversion", "code": "negate"},
            {"label": "Sépia", "code": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"},
            {"label": "Contraste", "code": "eq=contrast=1.4:saturation=1.2"},
            {"label": "Rotation 90°", "code": "transpose=1"},
            {"label": "Vignette", "code": "vignette=PI/5"},
        ],
    }


@router.get("/feed")
def feed_preview(url: str, limit: int = 8, user: dict = Depends(current_user)) -> dict[str, Any]:
    """Fetch and parse an RSS/Atom feed so the editor can preview the headlines."""
    from .. import feeds

    limit = max(1, min(limit, 20))
    items = feeds.fetch(url, limit=limit, force=True)
    return {"url": url, "items": items, "count": len(items)}
