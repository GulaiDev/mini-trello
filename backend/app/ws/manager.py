"""连接管理器：按 board_id 分房间，维护 presence，处理慢消费者。"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from starlette.websockets import WebSocket

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class Connection:
    ws: WebSocket
    user_id: uuid.UUID
    client_id: str
    board_id: uuid.UUID
    role: str
    connected_at: float = field(default_factory=time.time)
    last_seen: float = field(default_factory=time.time)
    send_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    sender_task: asyncio.Task | None = None


class ConnectionManager:
    """单进程内的房间注册表。

    多实例部署（阶段 5）可在此之上叠加 Redis pub/sub。
    """

    def __init__(self) -> None:
        self._rooms: dict[uuid.UUID, dict[str, Connection]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, conn: Connection) -> None:
        async with self._lock:
            room = self._rooms.setdefault(conn.board_id, {})
            room[conn.client_id] = conn

    async def disconnect(self, board_id: uuid.UUID, client_id: str) -> None:
        async with self._lock:
            room = self._rooms.get(board_id)
            if not room:
                return
            room.pop(client_id, None)
            if not room:
                self._rooms.pop(board_id, None)

    def get_room(self, board_id: uuid.UUID) -> list[Connection]:
        return list(self._rooms.get(board_id, {}).values())

    def presence(self, board_id: uuid.UUID) -> list[str]:
        """返回该看板在线用户 id 列表（去重）。"""
        seen: dict[uuid.UUID, None] = {}
        for conn in self._rooms.get(board_id, {}).values():
            seen.setdefault(conn.user_id, None)
        return [str(uid) for uid in seen]

    async def broadcast(
        self, board_id: uuid.UUID, message: dict, *, exclude_client_id: str | None = None
    ) -> None:
        """向房间内所有连接投递消息（含发起者，客户端按 client_id 自行对账）。"""
        for conn in self.get_room(board_id):
            try:
                conn.send_queue.put_nowait(message)
            except asyncio.QueueFull:
                # 慢消费者：超过队列上限直接断开，避免拖垮服务
                logger.warning(
                    "slow consumer dropped",
                    extra={"context": {"board_id": str(board_id), "client_id": conn.client_id}},
                )
                await self._drop(conn, code=1013)

    async def send_to(self, conn: Connection, message: dict) -> None:
        try:
            conn.send_queue.put_nowait(message)
        except asyncio.QueueFull:
            await self._drop(conn, code=1013)

    async def _drop(self, conn: Connection, code: int) -> None:
        try:
            await conn.ws.close(code=code)
        except Exception:
            pass
        await self.disconnect(conn.board_id, conn.client_id)


# 全局单例
manager = ConnectionManager()

# 发送队列上限（慢消费者保护）
QUEUE_MAXSIZE = settings.ws_backlog_limit


def make_queue() -> asyncio.Queue:
    return asyncio.Queue(maxsize=QUEUE_MAXSIZE)
