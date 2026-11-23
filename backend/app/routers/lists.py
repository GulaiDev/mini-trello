"""列表路由：创建（board 作用域）与更新/删除/移动（list 作用域）。

list 作用域的路由没有 board_id 路径参数，故在处理器内通过 _resolve_list_role
解析所属看板并校验角色。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import conflict, forbidden, not_found
from app.deps import CurrentUser, RequireEditor, SessionDep, resolve_membership
from app.models.board import ROLE_LEVEL, BoardMember, BoardRole
from app.models.content import Card, List
from app.realtime import events as rt
from app.schemas.content import ListCreate, ListMove, ListOut, ListUpdate
from app.services import content as content_service
from app.services import events as event_service
from app.services.position import first_position

router = APIRouter(tags=["lists"])


async def _resolve_list_role(
    list_id: uuid.UUID,
    session: AsyncSession,
    user_id: uuid.UUID,
    minimum: BoardRole,
) -> tuple[List, BoardMember]:
    """按 list_id 解析列表、所属看板与当前用户角色，校验最低权限。"""
    lst = await session.get(List, list_id)
    if lst is None:
        raise not_found("列表不存在")
    membership = await resolve_membership(session, lst.board_id, user_id)
    if ROLE_LEVEL[membership.role] < ROLE_LEVEL[minimum]:
        raise forbidden(f"{minimum.value} 及以上角色才能执行该操作")
    return lst, membership


@router.post("/boards/{board_id}/lists", response_model=ListOut, status_code=201)
async def create_list(
    board_id: uuid.UUID,
    body: ListCreate,
    session: SessionDep,
    membership: RequireEditor,
) -> ListOut:
    stmt = select(List.position).where(List.board_id == board_id, List.archived.is_(False))
    positions = [p for (p,) in (await session.execute(stmt)).all()]
    position = first_position(positions)

    lst = List(board_id=board_id, title=body.title.strip(), position=position)
    session.add(lst)
    await session.flush()
    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=rt.EventType.LIST_CREATED,
        actor_id=membership.user_id,
        client_move_id=body.client_move_id,
        payload={
            "list": {
                "id": str(lst.id),
                "board_id": str(board_id),
                "title": lst.title,
                "position": str(lst.position),
                "version": lst.version,
            }
        },
    )
    await session.commit()
    await session.refresh(lst)
    await rt.broadcast_event(event)
    return ListOut.model_validate(lst)


@router.patch("/lists/{list_id}", response_model=ListOut)
async def update_list(
    list_id: uuid.UUID,
    body: ListUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> ListOut:
    lst, membership = await _resolve_list_role(list_id, session, user.id, BoardRole.editor)
    if body.expected_version is not None and body.expected_version != lst.version:
        raise conflict("列表已被他人修改", latest_version=lst.version)

    changed: dict = {}
    if body.title is not None:
        lst.title = body.title.strip()
        changed["title"] = lst.title
    if body.archived is not None:
        lst.archived = body.archived
        changed["archived"] = body.archived
    lst.version += 1
    event_type = rt.EventType.LIST_DELETED if body.archived else rt.EventType.LIST_UPDATED
    event = await event_service.record_event(
        session,
        board_id=lst.board_id,
        type=event_type,
        actor_id=user.id,
        payload={
            "list_id": str(lst.id),
            "version": lst.version,
            "changed": changed,
        },
    )
    await session.commit()
    await session.refresh(lst)
    await rt.broadcast_event(event)
    return ListOut.model_validate(lst)


@router.delete("/lists/{list_id}", status_code=204)
async def delete_list(
    list_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> Response:
    """软删除：标记 archived，并软删除其下所有卡片。"""
    lst, membership = await _resolve_list_role(list_id, session, user.id, BoardRole.editor)
    lst.archived = True
    lst.version += 1
    for card in (await session.execute(select(Card).where(Card.list_id == list_id))).scalars():
        card.archived = True
    event = await event_service.record_event(
        session,
        board_id=lst.board_id,
        type=rt.EventType.LIST_DELETED,
        actor_id=user.id,
        payload={"list_id": str(lst.id), "board_id": str(lst.board_id)},
    )
    await session.commit()
    await rt.broadcast_event(event)
    return Response(status_code=204)


@router.patch("/lists/{list_id}/move", response_model=ListOut)
async def move_list(
    list_id: uuid.UUID,
    body: ListMove,
    session: SessionDep,
    user: CurrentUser,
) -> ListOut:
    lst, membership = await _resolve_list_role(list_id, session, user.id, BoardRole.editor)
    moved, event = await content_service.move_list(
        session,
        board_id=lst.board_id,
        list_id=list_id,
        prev_list_id=body.prev_list_id,
        next_list_id=body.next_list_id,
        actor_id=user.id,
        client_id=None,
        client_move_id=body.client_move_id,
    )
    await session.commit()
    await session.refresh(moved)
    await rt.broadcast_event(event)
    return ListOut.model_validate(moved)
