"""Roles and permissions.

Three built-in roles map to a set of capabilities; a user may also carry extra
per-user grants stored as JSON on `users.permissions`. The capability list is the
single source of truth shared with the frontend (see /api/meta/catalog).

Roles:
  * admin    — full control, including user management.
  * operator — day-to-day broadcasting: media, playlists, scenes, broadcast,
               streams, scheduling. No user management.
  * viewer   — read-only: can watch dashboards and previews, nothing else.
"""
from __future__ import annotations

import json
from typing import Any

# Capabilities ---------------------------------------------------------------
CAP_VIEW = "view"            # read dashboards, media, playlists, previews
CAP_MEDIA = "media"          # manage the media library
CAP_PLAYLISTS = "playlists"  # manage playlists
CAP_SCENES = "scenes"        # manage scenes
CAP_BROADCAST = "broadcast"  # start/stop/take, change broadcast settings
CAP_STREAMS = "streams"      # manage output streams
CAP_SCHEDULE = "schedule"    # manage the weekly schedule
CAP_USERS = "users"          # manage users and roles
CAP_SETTINGS = "settings"    # change global settings

ALL_CAPABILITIES = [
    CAP_VIEW, CAP_MEDIA, CAP_PLAYLISTS, CAP_SCENES,
    CAP_BROADCAST, CAP_STREAMS, CAP_SCHEDULE, CAP_USERS, CAP_SETTINGS,
]

ROLE_CAPABILITIES: dict[str, list[str]] = {
    "admin": list(ALL_CAPABILITIES),
    "operator": [
        CAP_VIEW, CAP_MEDIA, CAP_PLAYLISTS, CAP_SCENES,
        CAP_BROADCAST, CAP_STREAMS, CAP_SCHEDULE,
    ],
    "viewer": [CAP_VIEW],
}

ROLES = [
    {"id": "admin", "label": "Administrateur", "description": "Contrôle total, y compris les utilisateurs."},
    {"id": "operator", "label": "Opérateur", "description": "Diffusion et contenu, sans gestion des utilisateurs."},
    {"id": "viewer", "label": "Observateur", "description": "Consultation seule."},
]


def capabilities_for(role: str, extra: Any = None) -> list[str]:
    """Capabilities granted by a role plus any extra per-user grants."""
    caps = set(ROLE_CAPABILITIES.get(role, ROLE_CAPABILITIES["viewer"]))
    if isinstance(extra, str):
        try:
            extra = json.loads(extra or "[]")
        except (json.JSONDecodeError, TypeError):
            extra = []
    if isinstance(extra, list):
        caps.update(c for c in extra if c in ALL_CAPABILITIES)
    # Keep a stable order matching ALL_CAPABILITIES.
    return [c for c in ALL_CAPABILITIES if c in caps]


def has(user: dict, capability: str) -> bool:
    if not user:
        return False
    role = user.get("role") or ("admin" if user.get("is_admin") else "viewer")
    return capability in capabilities_for(role, user.get("permissions"))


def capabilities_catalog() -> list[dict[str, str]]:
    labels = {
        CAP_VIEW: "Consulter",
        CAP_MEDIA: "Gérer la médiathèque",
        CAP_PLAYLISTS: "Gérer les playlists",
        CAP_SCENES: "Gérer les scènes",
        CAP_BROADCAST: "Contrôler la diffusion",
        CAP_STREAMS: "Gérer les flux de sortie",
        CAP_SCHEDULE: "Gérer la programmation",
        CAP_USERS: "Gérer les utilisateurs",
        CAP_SETTINGS: "Modifier les paramètres",
    }
    return [{"id": c, "label": labels[c]} for c in ALL_CAPABILITIES]
