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


@router.get("/catalog")
def catalog(user: dict = Depends(current_user)) -> dict[str, Any]:
    return {
        "transitions": fx.transitions_catalog(),
        "animations": fx.animations_catalog(),
        "visualizers": fx.visualizers_catalog(),
        "roles": permissions.ROLES,
        "capabilities": permissions.capabilities_catalog(),
        "layer_types": [
            {"id": "text", "label": "Texte"},
            {"id": "overlay", "label": "Bandeau"},
            {"id": "image", "label": "Image"},
            {"id": "video", "label": "Vidéo"},
            {"id": "logo", "label": "Logo"},
            {"id": "reactive", "label": "Réactif (audio)"},
            {"id": "chat", "label": "Chat box"},
            {"id": "code", "label": "Code FFmpeg"},
        ],
        "code_examples": [
            {"label": "Miroir horizontal", "code": "hflip"},
            {"label": "Niveaux de gris", "code": "format=gray"},
            {"label": "Flou", "code": "gblur=sigma=8"},
            {"label": "Teinte sépia", "code": "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"},
            {"label": "Netteté", "code": "unsharp=5:5:1.0"},
            {"label": "Inversion", "code": "negate"},
        ],
    }
