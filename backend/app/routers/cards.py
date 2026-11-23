"""卡片路由：创建（list 作用域）与详情/更新/删除/移动（card 作用域）。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import conflict, forbidden, not_found
from app.deps import CurrentUser, SessionDep, resolve_membership
from app.models.board import ROLE_LEVEL, BoardMember, BoardRole
from app.models.content import Card, Label, List
from app.realtime import events as rt
from app.schemas.content import (
    CardCreate,
    CardLabelsUpdate,
    CardMove,
    CardMoveResult,
    CardOut,
    CardUpdate,
)
from app.services import content as content_service
from app.services import events as event_service

router = APIRouter(tags=["cards"])


async def _resolve_card_role(
    card_id: uuid.UUID,
    session: AsyncSession,
    user_id: uuid.UUID,
    minimum: BoardRole,
) -> tuple[Card, List, BoardMember]:
    card = await session.get(Card, card_id)
    if card is None:
        raise not_found("卡片不存在")
    lst = await session.get(List, card.list_id)
    if lst is None:
        raise not_found("卡片所属列表不存在")
    membership = await resolve_membership(session, lst.board_id, user_id)
    if ROLE_LEVEL[membership.role] < ROLE_LEVEL[minimum]:
        raise forbidden(f"{minimum.value} 及以上角色才能执行该操作")
    return card, lst, membership


async def _out(session: AsyncSession, card: Card) -> CardOut:
    # labels 为关系属性，异步上下文需显式加载，避免懒加载触发 greenlet 错误
    await session.refresh(card, attribute_names=["labels"])
    return CardOut.model_validate(content_service.card_to_out_dict(card))


@router.post("/lists/{list_id}/cards", response_model=CardOut, status_code=201)
async def create_card(
    list_id: uuid.UUID,
    body: CardCreate,
    session: SessionDep,
    user: CurrentUser,
) -> CardOut:
    lst = await session.get(List, list_id)
    if lst is None:
        raise not_found("列表不存在")
    membership = await resolve_membership(session, lst.board_id, user.id)
    if ROLE_LEVEL[membership.role] < ROLE_LEVEL[BoardRole.editor]:
        raise forbidden("editor 及以上角色才能创建卡片")

    position = await content_service.create_card_position(
        session, list_id, body.prev_card_id, body.next_card_id
    )
    card = Card(
        list_id=list_id,
        title=body.title.strip(),
        description=body.description,
        position=position,
        assignee_id=body.assignee_id,
        due_date=body.due_date,
        created_by=user.id,
    )
    labels: list[Label] = []
    if body.label_ids:
        labels = list(
            (
                await session.execute(
                    select(Label).where(
                        Label.id.in_(body.label_ids), Label.board_id == lst.board_id
                    )
                )
            )
            .scalars()
            .all()
        )
    card.labels = labels
    session.add(card)
    await session.flush()
    event = await event_service.record_event(
        session,
        board_id=lst.board_id,
        type=rt.EventType.CARD_CREATED,
        actor_id=user.id,
        client_move_id=body.client_move_id,
        payload={
            "card": {
                "id": str(card.id),
                "list_id": str(card.list_id),
                "title": card.title,
                "description": card.description,
                "position": str(card.position),
                "version": card.version,
                "assignee_id": str(card.assignee_id) if card.assignee_id else None,
                "label_ids": [str(x.id) for x in labels],
            }
        },
    )
    await session.commit()
    await session.refresh(card)
    await rt.broadcast_event(event)
    return await _out(session, card)


@router.get("/cards/{card_id}", response_model=CardOut)
async def get_card(
    card_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> CardOut:
    card, lst, membership = await _resolve_card_role(card_id, session, user.id, BoardRole.viewer)
    return await _out(session, card)


@router.patch("/cards/{card_id}", response_model=CardOut)
async def update_card(
    card_id: uuid.UUID,
    body: CardUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> CardOut:
    card, lst, membership = await _resolve_card_role(card_id, session, user.id, BoardRole.editor)
    if body.expected_version is not None and body.expected_version != card.version:
        # 409 + 最新数据，前端据此覆盖预演
        raise conflict(
            "卡片已被他人修改",
            latest=(await _out(session, card)).model_dump(mode="json"),
        )

    changed: dict = {}
    if body.title is not None:
        card.title = body.title.strip()
        changed["title"] = card.title
    if body.description is not None:
        card.description = body.description
        changed["description"] = card.description
    if body.assignee_id is not None:
        card.assignee_id = body.assignee_id
        changed["assignee_id"] = str(body.assignee_id)
    if body.due_date is not None:
        card.due_date = body.due_date
        changed["due_date"] = body.due_date.isoformat()
    if body.archived is not None:
        card.archived = body.archived
        changed["archived"] = body.archived
    card.version += 1

    event_type = rt.EventType.CARD_DELETED if body.archived else rt.EventType.CARD_UPDATED
    event = await event_service.record_event(
        session,
        board_id=lst.board_id,
        type=event_type,
        actor_id=user.id,
        payload={
            "card_id": str(card.id),
            "list_id": str(card.list_id),
            "version": card.version,
            "changed": changed,
        },
    )
    await session.commit()
    await session.refresh(card)
    await rt.broadcast_event(event)
    return await _out(session, card)


@router.delete("/cards/{card_id}", status_code=204)
async def delete_card(
    card_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> Response:
    card, lst, membership = await _resolve_card_role(card_id, session, user.id, BoardRole.editor)
    card.archived = True
    card.version += 1
    event = await event_service.record_event(
        session,
        board_id=lst.board_id,
        type=rt.EventType.CARD_DELETED,
        actor_id=user.id,
        payload={"card_id": str(card.id), "list_id": str(card.list_id)},
    )
    await session.commit()
    await rt.broadcast_event(event)
    return Response(status_code=204)


@router.post("/cards/{card_id}/move", response_model=CardMoveResult)
async def move_card(
    card_id: uuid.UUID,
    body: CardMove,
    session: SessionDep,
    user: CurrentUser,
) -> CardMoveResult:
    card, lst, membership = await _resolve_card_role(card_id, session, user.id, BoardRole.editor)
    # 校验目标列表属于同一看板
    target_list = await session.get(List, body.to_list_id)
    if target_list is None or target_list.board_id != lst.board_id:
        raise not_found("目标列表不存在")

    moved, event = await content_service.move_card(
        session,
        board_id=lst.board_id,
        card_id=card_id,
        to_list_id=body.to_list_id,
        prev_card_id=body.prev_card_id,
        next_card_id=body.next_card_id,
        actor_id=user.id,
        client_id=None,
        client_move_id=body.client_move_id,
    )
    await session.commit()
    await session.refresh(moved)
    await rt.broadcast_event(event)
    return CardMoveResult(
        card=await _out(session, moved), position=moved.position, version=moved.version
    )


@router.put("/cards/{card_id}/labels", response_model=CardOut)
async def set_card_labels(
    card_id: uuid.UUID,
    body: CardLabelsUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> CardOut:
    card, lst, membership = await _resolve_card_role(card_id, session, user.id, BoardRole.editor)
    labels = list(
        (
            await session.execute(
                select(Label).where(Label.id.in_(body.label_ids), Label.board_id == lst.board_id)
            )
        )
        .scalars()
        .all()
    )
    card.labels = labels
    card.version += 1
    event = await event_service.record_event(
        session,
        board_id=lst.board_id,
        type=rt.EventType.CARD_LABELS_CHANGED,
        actor_id=user.id,
        payload={
            "card_id": str(card.id),
            "label_ids": [str(x.id) for x in labels],
            "version": card.version,
        },
    )
    await session.commit()
    await session.refresh(card)
    await rt.broadcast_event(event)
    return await _out(session, card)
