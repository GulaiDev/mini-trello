"""列表与卡片的领域服务：位置计算、行锁串行化、间隙重排、事件落库。

所有写操作在同一事务内完成：锁目标列表行 → 读邻居 → 计算/重排位置 →
更新业务数据 → 记录事件；提交由路由层负责，广播在提交后进行。
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import bad_request, conflict, not_found
from app.models.content import Card, List
from app.models.event import BoardEvent
from app.realtime.events import EventType
from app.services import events as event_service
from app.services.position import (
    first_position,
    gap_exhausted,
    position_between,
    rebalance_positions,
)

MAX_REBALANCE_RETRY = 3
CARD_LOAD_LIMIT = 500


async def lock_list(session: AsyncSession, list_id: uuid.UUID) -> List:
    """对列表行加事务级行锁（SELECT ... FOR UPDATE），串行化该列的移动。"""
    stmt = select(List).where(List.id == list_id).with_for_update()
    lst = (await session.execute(stmt)).scalar_one_or_none()
    if lst is None:
        raise not_found("列表不存在")
    return lst


async def lock_card(session: AsyncSession, card_id: uuid.UUID) -> Card:
    stmt = select(Card).where(Card.id == card_id).with_for_update()
    card = (await session.execute(stmt)).scalar_one_or_none()
    if card is None:
        raise not_found("卡片不存在")
    return card


async def _neighbor_positions(
    session: AsyncSession,
    list_id: uuid.UUID,
    prev_id: uuid.UUID | None,
    next_id: uuid.UUID | None,
    *,
    exclude_card_id: uuid.UUID | None = None,
) -> tuple[Decimal | None, Decimal | None]:
    """在列表锁内解析真实的相邻位置。

    不直接信任客户端传来的 prev/next 是否仍相邻：并发插入可能已使两者
    不再相邻。以 prev 为锚点，取其后的实际最小 position 作为 next；若只给了
    next，取其前的实际最大 position 作为 prev。两者都为空时追加到末尾。
    这样保证并发移动到同一间隙时位置互不相同。
    """

    async def _card_pos(card_id: uuid.UUID | None) -> Decimal | None:
        if card_id is None:
            return None
        card = await session.get(Card, card_id)
        if card is None or card.list_id != list_id:
            raise bad_request("邻居不属于目标列表")
        return card.position

    def _base_filter():
        stmt = select(Card.position).where(Card.list_id == list_id, Card.archived.is_(False))
        if exclude_card_id is not None:
            stmt = stmt.where(Card.id != exclude_card_id)
        return stmt

    prev_pos = await _card_pos(prev_id)
    next_pos = await _card_pos(next_id)

    if prev_pos is not None:
        # 以 prev 为锚，取实际后继（可能因并发插入而非客户端传来的 next）
        succ = (
            await session.execute(
                _base_filter().where(Card.position > prev_pos).order_by(Card.position).limit(1)
            )
        ).scalar_one_or_none()
        next_pos = succ
    elif next_pos is not None:
        pred = (
            await session.execute(
                _base_filter()
                .where(Card.position < next_pos)
                .order_by(Card.position.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        prev_pos = pred
    else:
        # 都为空：追加到末尾
        last = (
            await session.execute(_base_filter().order_by(Card.position.desc()).limit(1))
        ).scalar_one_or_none()
        prev_pos = last
        next_pos = None

    if prev_pos is not None and next_pos is not None and prev_pos >= next_pos:
        raise bad_request("邻居顺序非法：prev 必须在 next 之前")
    return prev_pos, next_pos


async def _rebalance_list_cards(
    session: AsyncSession, list_id: uuid.UUID, *, exclude_card_id: uuid.UUID | None
) -> None:
    """按当前顺序把整列卡片重排为 1024 的倍数（间隙耗尽时调用）。"""
    stmt = (
        select(Card)
        .where(Card.list_id == list_id, Card.archived.is_(False))
        .where(Card.id != exclude_card_id if exclude_card_id else True)
        .order_by(Card.position)
    )
    cards = list((await session.execute(stmt)).scalars().all())
    new_positions = rebalance_positions(len(cards))
    for card, pos in zip(cards, new_positions, strict=True):
        card.position = pos
    await session.flush()


async def move_card(
    session: AsyncSession,
    *,
    board_id: uuid.UUID,
    card_id: uuid.UUID,
    to_list_id: uuid.UUID,
    prev_card_id: uuid.UUID | None,
    next_card_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
    client_id: str | None,
    client_move_id: str | None,
) -> tuple[Card, BoardEvent]:
    """把卡片移动到目标列表的指定间隙，服务端计算权威位置。返回 (卡片, 事件)。"""
    # 1. 锁目标列表行，串行化
    target_list = await lock_list(session, to_list_id)
    if target_list.board_id != board_id:
        raise bad_request("目标列表不属于该看板")

    card = await lock_card(session, card_id)
    from_list_id = card.list_id

    # 2. 读邻居 + 计算位置，间隙耗尽则重排后重试
    for _attempt in range(MAX_REBALANCE_RETRY):
        prev_pos, next_pos = await _neighbor_positions(
            session, to_list_id, prev_card_id, next_card_id, exclude_card_id=card_id
        )
        if gap_exhausted(prev_pos, next_pos):
            await _rebalance_list_cards(session, to_list_id, exclude_card_id=card_id)
            # 重排后邻居位置变化，重新读取
            continue
        break
    else:
        raise conflict("位置计算冲突，请重试")

    new_position = position_between(prev_pos, next_pos)
    card.list_id = to_list_id
    card.position = new_position
    card.version += 1
    await session.flush()

    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=EventType.CARD_MOVED,
        actor_id=actor_id,
        client_id=client_id,
        client_move_id=client_move_id,
        payload={
            "card_id": str(card.id),
            "from_list_id": str(from_list_id),
            "to_list_id": str(to_list_id),
            "position": str(new_position),
            "version": card.version,
        },
    )
    return card, event


async def create_card_position(
    session: AsyncSession,
    list_id: uuid.UUID,
    prev_card_id: uuid.UUID | None,
    next_card_id: uuid.UUID | None,
) -> Decimal:
    """为新卡片计算位置；未指定邻居则追加到末尾。"""
    if prev_card_id is None and next_card_id is None:
        stmt = select(Card.position).where(Card.list_id == list_id, Card.archived.is_(False))
        positions = [p for (p,) in (await session.execute(stmt)).all()]
        return first_position(positions)
    prev_pos, next_pos = await _neighbor_positions(session, list_id, prev_card_id, next_card_id)
    return position_between(prev_pos, next_pos)


async def move_list(
    session: AsyncSession,
    *,
    board_id: uuid.UUID,
    list_id: uuid.UUID,
    prev_list_id: uuid.UUID | None,
    next_list_id: uuid.UUID | None,
    actor_id: uuid.UUID | None,
    client_id: str | None,
    client_move_id: str | None,
) -> tuple[List, BoardEvent]:
    """在看板内移动列表顺序。返回 (列表, 事件)。"""
    target = await lock_list(session, list_id)
    if target.board_id != board_id:
        raise bad_request("列表不属于该看板")

    prev_pos: Decimal | None = None
    next_pos: Decimal | None = None
    if prev_list_id is not None:
        prev = await session.get(List, prev_list_id)
        if prev is None or prev.board_id != board_id:
            raise bad_request("prev 列表非法")
        prev_pos = prev.position
    if next_list_id is not None:
        nxt = await session.get(List, next_list_id)
        if nxt is None or nxt.board_id != board_id:
            raise bad_request("next 列表非法")
        next_pos = nxt.position

    if prev_list_id is None and next_list_id is None:
        stmt = select(List.position).where(
            List.board_id == board_id, List.archived.is_(False), List.id != list_id
        )
        positions = [p for (p,) in (await session.execute(stmt)).all()]
        new_position = first_position(positions)
    else:
        if prev_pos is not None and next_pos is not None and prev_pos >= next_pos:
            raise bad_request("邻居顺序非法")
        new_position = position_between(prev_pos, next_pos)

    target.position = new_position
    target.version += 1
    await session.flush()

    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=EventType.LIST_MOVED,
        actor_id=actor_id,
        client_id=client_id,
        client_move_id=client_move_id,
        payload={
            "list_id": str(target.id),
            "position": str(new_position),
            "version": target.version,
        },
    )
    return target, event


def card_to_out_dict(card: Card) -> dict:
    """把 Card ORM 对象转为 CardOut 需要的字典（含 label_ids）。"""
    return {
        "id": card.id,
        "list_id": card.list_id,
        "title": card.title,
        "description": card.description,
        "position": card.position,
        "assignee_id": card.assignee_id,
        "due_date": card.due_date,
        "archived": card.archived,
        "version": card.version,
        "created_by": card.created_by,
        "created_at": card.created_at,
        "updated_at": card.updated_at,
        "label_ids": [label.id for label in card.labels],
    }
