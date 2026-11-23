"""事件类型常量与广播信封。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.models.event import BoardEvent
from app.ws.manager import manager


class EventType:
    BOARD_UPDATED = "board.updated"
    LIST_CREATED = "list.created"
    LIST_UPDATED = "list.updated"
    LIST_MOVED = "list.moved"
    LIST_DELETED = "list.deleted"
    CARD_CREATED = "card.created"
    CARD_UPDATED = "card.updated"
    CARD_MOVED = "card.moved"
    CARD_DELETED = "card.deleted"
    LABEL_CREATED = "label.created"
    LABEL_UPDATED = "label.updated"
    LABEL_DELETED = "label.deleted"
    CARD_LABELS_CHANGED = "card_labels.changed"
    MEMBER_ADDED = "member.added"
    MEMBER_ROLE_CHANGED = "member.role_changed"
    MEMBER_REMOVED = "member.removed"
    # presence 不持久化、无 seq、不补发
    PRESENCE_SYNC = "presence.sync"
    PRESENCE_JOIN = "presence.join"
    PRESENCE_LEAVE = "presence.leave"


def event_envelope(event: BoardEvent) -> dict[str, Any]:
    """把持久化事件序列化为 WS 信封。"""
    return {
        "event_id": str(event.id),
        "board_id": str(event.board_id),
        "seq": event.seq,
        "type": event.type,
        "actor_id": str(event.actor_id) if event.actor_id else None,
        "client_id": event.client_id,
        "client_move_id": event.client_move_id,
        "occurred_at": event.created_at.isoformat()
        if event.created_at
        else datetime.now(UTC).isoformat(),
        "payload": event.payload,
    }


async def broadcast_event(event: BoardEvent) -> None:
    """业务事务提交后广播；失败不影响已提交数据。"""
    await manager.broadcast(event.board_id, event_envelope(event))


async def broadcast_presence(board_id: uuid.UUID, type: str, user_id: uuid.UUID) -> None:
    """广播 presence 变更（无 seq、不持久化）。"""
    message = {
        "type": type,
        "board_id": str(board_id),
        "user_id": str(user_id),
        "presence": manager.presence(board_id),
    }
    await manager.broadcast(board_id, message)
