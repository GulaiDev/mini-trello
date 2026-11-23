"""WebSocket 实时路由。

- 地址：/api/ws/boards/{board_id}
- 鉴权：读取 httpOnly cookie 中的 access token；禁止 query 传 token。
- 未登录关闭码 4401，无权限 4403。
- 首帧 hello 携带 since_seq / client_id；服务端补发或要求 resync。
- 心跳：客户端 ping → 服务端 pong；超时由后台任务清理。
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.core.config import settings
from app.core.logging import get_logger
from app.core.security import decode_token
from app.db.session import SessionLocal
from app.models.board import BoardMember
from app.models.event import BoardEvent
from app.models.user import User
from app.realtime import events as rt
from app.realtime.events import event_envelope
from app.services import events as event_service
from app.ws.manager import Connection, make_queue, manager

logger = get_logger(__name__)

router = APIRouter()

CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403


async def _authenticate(ws: WebSocket, board_id: uuid.UUID):
    """校验 cookie 中的 access token 与看板成员身份。

    返回 (user, membership)；失败时抛出 _Reject(code)。
    """
    token = ws.cookies.get("access_token")
    if not token:
        raise _Reject(CLOSE_UNAUTHORIZED)
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise _Reject(CLOSE_UNAUTHORIZED)
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise _Reject(CLOSE_UNAUTHORIZED) from None

    async with SessionLocal() as session:
        user = await session.get(User, user_id)
        if user is None:
            raise _Reject(CLOSE_UNAUTHORIZED)
        membership = (
            await session.execute(
                select(BoardMember).where(
                    BoardMember.board_id == board_id,
                    BoardMember.user_id == user_id,
                )
            )
        ).scalar_one_or_none()
        if membership is None:
            raise _Reject(CLOSE_FORBIDDEN)
        return user_id, membership.role.value


class _Reject(Exception):
    def __init__(self, code: int) -> None:
        self.code = code


@router.websocket("/ws/boards/{board_id}")
async def board_socket(ws: WebSocket, board_id: uuid.UUID) -> None:
    # 握手前先鉴权（此时尚未 accept）
    try:
        user_id, role = await _authenticate(ws, board_id)
    except _Reject as reject:
        # 未 accept 时直接以关闭码拒绝
        await ws.close(code=reject.code)
        return

    await ws.accept()

    client_id = f"{user_id}-{uuid.uuid4().hex[:8]}"
    conn = Connection(
        ws=ws,
        user_id=user_id,
        client_id=client_id,
        board_id=board_id,
        role=role,
        send_queue=make_queue(),
    )

    # 等待首帧 hello
    try:
        hello = await asyncio.wait_for(ws.receive_json(), timeout=10)
    except (TimeoutError, WebSocketDisconnect, Exception):
        with contextlib.suppress(Exception):
            await ws.close(code=CLOSE_UNAUTHORIZED)
        return

    if not isinstance(hello, dict) or hello.get("type") != "hello":
        with contextlib.suppress(Exception):
            await ws.close(code=CLOSE_FORBIDDEN)
        return

    if hello.get("client_id"):
        # 用客户端提供的 tab client_id 覆盖，便于事件对账
        conn.client_id = str(hello["client_id"])

    await manager.connect(conn)

    # 启动发送协程
    sender_task = asyncio.create_task(_sender_loop(conn))
    conn.sender_task = sender_task

    # 处理 since_seq 补发 / resync
    since_seq = int(hello.get("since_seq", 0) or 0)
    async with SessionLocal() as session:
        current = await event_service.current_seq(session, board_id)
        need_resync = False
        if since_seq != 0:
            # 保留窗口判断：落后过多（含非法负值）则要求全量重同步
            if current - since_seq > settings.event_retention:
                need_resync = True
            else:
                backlog_stmt = (
                    select(BoardEvent)
                    .where(
                        BoardEvent.board_id == board_id,
                        BoardEvent.seq > since_seq,
                    )
                    .order_by(BoardEvent.seq)
                    .limit(settings.ws_backlog_limit + 1)
                )
                backlog = list((await session.execute(backlog_stmt)).scalars().all())
                if len(backlog) > settings.ws_backlog_limit:
                    need_resync = True
                else:
                    for ev in backlog:
                        await manager.send_to(conn, event_envelope(ev))

    if need_resync:
        await manager.send_to(conn, {"type": "resync", "seq": current})
    else:
        await manager.send_to(
            conn,
            {
                "type": "ready",
                "seq": current,
                "role": role,
                "presence": manager.presence(board_id),
            },
        )

    # 广播 presence.join
    await rt.broadcast_presence(board_id, rt.EventType.PRESENCE_JOIN, user_id)

    heartbeat = asyncio.create_task(_heartbeat_watch(conn))
    try:
        while True:
            message = await ws.receive_json()
            conn.last_seen = asyncio.get_event_loop().time()
            if not isinstance(message, dict):
                continue
            mtype = message.get("type")
            if mtype == "ping":
                await manager.send_to(conn, {"type": "pong"})
            # 其它帧忽略：所有变更走 REST，viewer 无法通过 WS 发变更
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("ws error")
    finally:
        heartbeat.cancel()
        sender_task.cancel()
        await manager.disconnect(board_id, conn.client_id)
        await rt.broadcast_presence(board_id, rt.EventType.PRESENCE_LEAVE, user_id)
        with contextlib.suppress(Exception):
            await ws.close()


async def _sender_loop(conn: Connection) -> None:
    """把发送队列里的消息逐个写出。"""
    try:
        while True:
            message = await conn.send_queue.get()
            await conn.ws.send_json(message)
    except asyncio.CancelledError:
        pass
    except Exception:
        pass


async def _heartbeat_watch(conn: Connection) -> None:
    """超时未收到任何消息则断开（客户端应每 25s ping 一次）。"""
    try:
        loop = asyncio.get_event_loop()
        conn.last_seen = loop.time()
        while True:
            await asyncio.sleep(5)
            if loop.time() - conn.last_seen > settings.ws_heartbeat_timeout:
                with contextlib.suppress(Exception):
                    await conn.ws.close(code=1000)
                break
    except asyncio.CancelledError:
        pass
