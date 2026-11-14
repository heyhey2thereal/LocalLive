"""Chat overlay endpoints.

Viewers (or a relay script) push messages with `POST /api/chat/{source}`; the
scene editor reads the recent lines with `GET /api/chat/{source}` and can send a
test message. The source name matches the one configured on the chat layer.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import chat
from ..deps import current_user, require
from .. import permissions

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatMessage(BaseModel):
    user: str = Field(default="Anonyme", max_length=40)
    text: str = Field(min_length=1, max_length=300)


@router.get("/{source}")
def get_chat(source: str, limit: int = 10, user: dict = Depends(current_user)) -> dict[str, Any]:
    limit = max(1, min(limit, 50))
    return {"source": source, "messages": chat.recent(source, limit)}


@router.post("/{source}")
def post_chat(source: str, payload: ChatMessage, user: dict = Depends(current_user)) -> dict[str, Any]:
    entry = chat.add(source, payload.user, payload.text)
    return {"ok": True, "message": entry}


@router.delete("/{source}")
def clear_chat(source: str, user: dict = Depends(require(permissions.CAP_SCENES))) -> dict[str, Any]:
    chat.clear(source)
    return {"ok": True}
