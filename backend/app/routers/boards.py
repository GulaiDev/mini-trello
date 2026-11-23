"""看板与成员路由。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response
from sqlalchemy import func, select

from app.core.errors import bad_request, conflict, forbidden, not_found
from app.deps import (
    CurrentUser,
    RequireMember,
    RequireOwner,
    SessionDep,
    get_board_or_404,
)
from app.models.board import Board, BoardMember, BoardRole
from app.models.content import Card, Label, List
from app.models.event import BoardCounter
from app.models.user import User
from app.realtime import events as rt
from app.schemas.board import (
    BoardCreate,
    BoardOut,
    BoardUpdate,
    MemberAdd,
    MemberOut,
    MemberRoleUpdate,
    SnapshotOut,
)
from app.schemas.common import Page
from app.schemas.content import CardOut, LabelOut, ListOut
from app.services import content as content_service
from app.services import events as event_service

router = APIRouter(prefix="/boards", tags=["boards"])

BoardIdPath = uuid.UUID


@router.get("", response_model=Page[BoardOut])
async def list_boards(
    session: SessionDep,
    user: CurrentUser,
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, max_length=100),
) -> Page[BoardOut]:
    """仅返回当前用户可见的看板。"""
    base = (
        select(Board, BoardMember.role)
        .join(BoardMember, BoardMember.board_id == Board.id)
        .where(BoardMember.user_id == user.id)
    )
    count_base = (
        select(func.count())
        .select_from(Board)
        .join(BoardMember, BoardMember.board_id == Board.id)
        .where(BoardMember.user_id == user.id)
    )
    if q:
        like = f"%{q.strip()}%"
        base = base.where(Board.title.like(like))
        count_base = count_base.where(Board.title.like(like))

    total = (await session.execute(count_base)).scalar_one()
    stmt = base.order_by(Board.updated_at.desc()).offset((page - 1) * size).limit(size)
    rows = (await session.execute(stmt)).all()
    items = []
    for board, role in rows:
        out = BoardOut.model_validate(board)
        out.role = role
        items.append(out)
    return Page[BoardOut](items=items, total=int(total), page=page, size=size)


@router.post("", response_model=BoardOut, status_code=201)
async def create_board(
    body: BoardCreate,
    session: SessionDep,
    user: CurrentUser,
) -> BoardOut:
    board = Board(
        title=body.title.strip(),
        description=body.description.strip(),
        owner_id=user.id,
    )
    session.add(board)
    await session.flush()
    # 创建者即 owner
    session.add(BoardMember(board_id=board.id, user_id=user.id, role=BoardRole.owner))
    session.add(BoardCounter(board_id=board.id, last_seq=0))
    await session.commit()
    await session.refresh(board)
    out = BoardOut.model_validate(board)
    out.role = BoardRole.owner
    return out


@router.get("/{board_id}", response_model=BoardOut)
async def get_board(
    board_id: uuid.UUID,
    session: SessionDep,
    membership: RequireMember,
) -> BoardOut:
    board = await get_board_or_404(board_id, session)
    out = BoardOut.model_validate(board)
    out.role = membership.role
    return out


@router.patch("/{board_id}", response_model=BoardOut)
async def update_board(
    board_id: uuid.UUID,
    body: BoardUpdate,
    session: SessionDep,
    membership: RequireOwner,
) -> BoardOut:
    board = await get_board_or_404(board_id, session)
    changed: dict = {}
    if body.title is not None:
        board.title = body.title.strip()
        changed["title"] = board.title
    if body.description is not None:
        board.description = body.description.strip()
        changed["description"] = board.description
    if changed:
        event = await event_service.record_event(
            session,
            board_id=board_id,
            type=rt.EventType.BOARD_UPDATED,
            actor_id=membership.user_id,
            payload={"board_id": str(board_id), "changed": changed},
        )
        await session.commit()
        await rt.broadcast_event(event)
    else:
        await session.commit()
    await session.refresh(board)
    out = BoardOut.model_validate(board)
    out.role = membership.role
    return out


@router.delete("/{board_id}", status_code=204)
async def delete_board(
    board_id: uuid.UUID,
    session: SessionDep,
    membership: RequireOwner,
) -> Response:
    board = await get_board_or_404(board_id, session)
    await session.delete(board)
    await session.commit()
    return Response(status_code=204)


@router.get("/{board_id}/snapshot", response_model=SnapshotOut)
async def get_snapshot(
    board_id: uuid.UUID,
    session: SessionDep,
    membership: RequireMember,
) -> SnapshotOut:
    board = await get_board_or_404(board_id, session)

    lists = list(
        (
            await session.execute(
                select(List)
                .where(List.board_id == board_id, List.archived.is_(False))
                .order_by(List.position)
            )
        )
        .scalars()
        .all()
    )
    list_ids = [lst.id for lst in lists]

    cards_stmt = (
        (
            select(Card)
            .where(Card.list_id.in_(list_ids), Card.archived.is_(False))
            .order_by(Card.position)
            .limit(content_service.CARD_LOAD_LIMIT + 1)
        )
        if list_ids
        else None
    )
    cards: list[Card] = []
    truncated = False
    if cards_stmt is not None:
        cards = list((await session.execute(cards_stmt)).scalars().all())
        if len(cards) > content_service.CARD_LOAD_LIMIT:
            truncated = True
            cards = cards[: content_service.CARD_LOAD_LIMIT]

    labels = list(
        (
            await session.execute(
                select(Label).where(Label.board_id == board_id).order_by(Label.name)
            )
        )
        .scalars()
        .all()
    )

    member_rows = (
        await session.execute(
            select(User, BoardMember.role, BoardMember.created_at)
            .join(BoardMember, BoardMember.user_id == User.id)
            .where(BoardMember.board_id == board_id)
        )
    ).all()
    members = [
        MemberOut(
            id=u.id,
            email=u.email,
            display_name=u.display_name,
            role=role,
            created_at=created_at,
        )
        for u, role, created_at in member_rows
    ]

    board_out = BoardOut.model_validate(board)
    board_out.role = membership.role
    seq = await event_service.current_seq(session, board_id)

    return SnapshotOut(
        board=board_out,
        role=membership.role,
        seq=seq,
        lists=[ListOut.model_validate(lst) for lst in lists],
        cards=[CardOut.model_validate(content_service.card_to_out_dict(c)) for c in cards],
        labels=[LabelOut.model_validate(lb) for lb in labels],
        members=members,
        truncated=truncated,
    )


# --- 成员管理 ---
members_router = APIRouter(prefix="/boards/{board_id}/members", tags=["members"])


@members_router.get("", response_model=list[MemberOut])
async def list_members(
    board_id: uuid.UUID,
    session: SessionDep,
    membership: RequireMember,
) -> list[MemberOut]:
    rows = (
        await session.execute(
            select(User, BoardMember.role, BoardMember.created_at)
            .join(BoardMember, BoardMember.user_id == User.id)
            .where(BoardMember.board_id == board_id)
        )
    ).all()
    return [
        MemberOut(
            id=u.id,
            email=u.email,
            display_name=u.display_name,
            role=role,
            created_at=created_at,
        )
        for u, role, created_at in rows
    ]


@members_router.post("", response_model=MemberOut, status_code=201)
async def add_member(
    board_id: uuid.UUID,
    body: MemberAdd,
    session: SessionDep,
    membership: RequireOwner,
) -> MemberOut:
    await get_board_or_404(board_id, session)
    email = body.email.lower()
    target = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if target is None:
        raise not_found("该邮箱尚未注册")
    existing = (
        await session.execute(
            select(BoardMember).where(
                BoardMember.board_id == board_id, BoardMember.user_id == target.id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise conflict("该用户已是成员")
    if body.role == BoardRole.owner:
        raise bad_request("不能直接邀请为 owner")

    member = BoardMember(
        board_id=board_id,
        user_id=target.id,
        role=body.role,
        invited_by=membership.user_id,
    )
    session.add(member)
    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=rt.EventType.MEMBER_ADDED,
        actor_id=membership.user_id,
        payload={
            "user_id": str(target.id),
            "email": target.email,
            "display_name": target.display_name,
            "role": body.role.value,
        },
    )
    await session.commit()
    await rt.broadcast_event(event)
    return MemberOut(
        id=target.id,
        email=target.email,
        display_name=target.display_name,
        role=body.role,
        created_at=member.created_at,
    )


@members_router.patch("/{user_id}", response_model=MemberOut)
async def change_role(
    board_id: uuid.UUID,
    user_id: uuid.UUID,
    body: MemberRoleUpdate,
    session: SessionDep,
    membership: RequireOwner,
) -> MemberOut:
    target_member = (
        await session.execute(
            select(BoardMember).where(
                BoardMember.board_id == board_id, BoardMember.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if target_member is None:
        raise not_found("成员不存在")

    # owner 唯一性保护
    if target_member.role == BoardRole.owner and body.role != BoardRole.owner:
        raise forbidden("不能降级唯一的 owner")

    old_role = target_member.role
    target_member.role = body.role
    user = await session.get(User, user_id)
    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=rt.EventType.MEMBER_ROLE_CHANGED,
        actor_id=membership.user_id,
        payload={
            "user_id": str(user_id),
            "from": old_role.value,
            "to": body.role.value,
        },
    )
    await session.commit()
    await rt.broadcast_event(event)
    assert user is not None
    return MemberOut(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=body.role,
        created_at=target_member.created_at,
    )


@members_router.delete("/{user_id}", status_code=204)
async def remove_member(
    board_id: uuid.UUID,
    user_id: uuid.UUID,
    session: SessionDep,
    membership: RequireOwner,
) -> Response:
    target_member = (
        await session.execute(
            select(BoardMember).where(
                BoardMember.board_id == board_id, BoardMember.user_id == user_id
            )
        )
    ).scalar_one_or_none()
    if target_member is None:
        raise not_found("成员不存在")
    if target_member.role == BoardRole.owner:
        raise forbidden("不能移除 owner")
    await session.delete(target_member)
    event = await event_service.record_event(
        session,
        board_id=board_id,
        type=rt.EventType.MEMBER_REMOVED,
        actor_id=membership.user_id,
        payload={"user_id": str(user_id)},
    )
    await session.commit()
    await rt.broadcast_event(event)
    return Response(status_code=204)
