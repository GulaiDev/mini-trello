"""事件序号分配与持久化服务。

seq 由 board_counters 行锁在写事务内自增分配，保证同看板事件顺序与数据顺序一致。
MySQL 不支持 INSERT ... RETURNING，采用 UPDATE ... 后 SELECT last_seq。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.event import BoardCounter, BoardEvent


async def ensure_counter(session: AsyncSession, board_id: uuid.UUID) -> BoardCounter:
    """确保计数器行存在（带行锁）。"""
    stmt = select(BoardCounter).where(BoardCounter.board_id == board_id).with_for_update()
    counter = (await session.execute(stmt)).scalar_one_or_none()
    if counter is None:
        counter = BoardCounter(board_id=board_id, last_seq=0)
        session.add(counter)
        await session.flush()
        # 重新加锁读取
        counter = (await session.execute(stmt)).scalar_one()
    return counter


async def next_seq(session: AsyncSession, board_id: uuid.UUID) -> int:
    """在写事务内分配下一个 seq（计数器行已被 ensure_counter 锁定）。"""
    counter = await ensure_counter(session, board_id)
    counter.last_seq += 1
    await session.flush()
    return counter.last_seq


async def current_seq(session: AsyncSession, board_id: uuid.UUID) -> int:
    """读取当前最新 seq（不加锁，用于快照）。"""
    stmt = select(BoardCounter.last_seq).where(BoardCounter.board_id == board_id)
    value = (await session.execute(stmt)).scalar_one_or_none()
    return value or 0


async def record_event(
    session: AsyncSession,
    *,
    board_id: uuid.UUID,
    type: str,
    payload: dict[str, Any],
    actor_id: uuid.UUID | None = None,
    client_id: str | None = None,
    client_move_id: str | None = None,
) -> BoardEvent:
    """分配 seq、写入 board_events（不提交，由调用方在业务事务内统一提交）。"""
    seq = await next_seq(session, board_id)
    event = BoardEvent(
        board_id=board_id,
        seq=seq,
        type=type,
        payload=payload,
        actor_id=actor_id,
        client_id=client_id,
        client_move_id=client_move_id,
    )
    session.add(event)
    await session.flush()
    return event
