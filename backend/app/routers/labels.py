"""标签路由：看板级增删改。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Response
from sqlalchemy import select

from app.core.errors import conflict, not_found
from app.deps import RequireEditor, SessionDep, get_board_or_404
from app.models.content import Label
from app.realtime import events as rt
from app.schemas.content import LabelCreate, LabelOut, LabelUpdate
from app.services import events as event_service

router = APIRouter(prefix="/boards/{board_id}/labels", tags=["labels"])


@router.get("", response_model=list[LabelOut])
async def list_labels(
    board_id: uuid.UUID,
    session: SessionDep,
    membership: RequireEditor,
) -> list[LabelOut]:
    labels = (
        (
            await session.execute(
                select(Label).where(Label.board_id == board_id).order_by(Label.name)
            )
        )
        .scalars()
        .all()
    )
    return [LabelOut.model_validate(lb) for lb in labels]


@router.post("", response_model=LabelOut, status_code=201)
async def create_label(
    board_id: uuid.UUID,
    body: LabelCreate,
    session: SessionDep,
    membership: RequireEditor,
) -> LabelOut:
    await get_board_or_404(board_id, session)
    dup = (
        await session.execute(
            select(Label).where(Label.board_id == board_id, Label.name == body.name.strip())
        )
    ).scalar_one_or_none()
    if dup is not None:
        raise conflict("同名标签已存在")
    label = Label(board_id=board_id, name=body.name.strip(), color=body.color)
    session.add(label)
    await session.flush()
    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=rt.EventType.LABEL_CREATED,
        actor_id=membership.user_id,
        payload={
            "label": {
                "id": str(label.id),
                "board_id": str(board_id),
                "name": label.name,
                "color": label.color,
            }
        },
    )
    await session.commit()
    await session.refresh(label)
    await rt.broadcast_event(event)
    return LabelOut.model_validate(label)


@router.patch("/{label_id}", response_model=LabelOut)
async def update_label(
    board_id: uuid.UUID,
    label_id: uuid.UUID,
    body: LabelUpdate,
    session: SessionDep,
    membership: RequireEditor,
) -> LabelOut:
    label = await session.get(Label, label_id)
    if label is None or label.board_id != board_id:
        raise not_found("标签不存在")
    if body.name is not None:
        label.name = body.name.strip()
    if body.color is not None:
        label.color = body.color
    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=rt.EventType.LABEL_UPDATED,
        actor_id=membership.user_id,
        payload={
            "label_id": str(label.id),
            "name": label.name,
            "color": label.color,
        },
    )
    await session.commit()
    await session.refresh(label)
    await rt.broadcast_event(event)
    return LabelOut.model_validate(label)


@router.delete("/{label_id}", status_code=204)
async def delete_label(
    board_id: uuid.UUID,
    label_id: uuid.UUID,
    session: SessionDep,
    membership: RequireEditor,
) -> Response:
    label = await session.get(Label, label_id)
    if label is None or label.board_id != board_id:
        raise not_found("标签不存在")
    await session.delete(label)
    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=rt.EventType.LABEL_DELETED,
        actor_id=membership.user_id,
        payload={"label_id": str(label_id)},
    )
    await session.commit()
    await rt.broadcast_event(event)
    return Response(status_code=204)
