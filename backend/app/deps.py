"""FastAPI 依赖：会话、当前用户、RBAC。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Cookie, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import forbidden, not_found, unauthorized
from app.core.security import decode_token
from app.db.session import get_session
from app.models.board import ROLE_LEVEL, Board, BoardMember, BoardRole
from app.models.user import User

SessionDep = Annotated[AsyncSession, Depends(get_session)]


async def _load_user(session: AsyncSession, token: str | None) -> User:
    if not token:
        raise unauthorized()
    payload = decode_token(token)
    if not payload or payload.get("type") != "access":
        raise unauthorized()
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise unauthorized() from None
    user = await session.get(User, user_id)
    if user is None:
        raise unauthorized()
    return user


async def get_current_user(
    session: SessionDep,
    access_token: Annotated[str | None, Cookie()] = None,
) -> User:
    """从 httpOnly cookie 解析当前用户；未登录抛 401。"""
    return await _load_user(session, access_token)


CurrentUser = Annotated[User, Depends(get_current_user)]


async def resolve_membership(
    session: AsyncSession, board_id: uuid.UUID, user_id: uuid.UUID
) -> BoardMember:
    """按 UUID 解析看板成员；非成员抛 403（不泄露看板存在性）。

    供 list/card 作用域路由直接调用（这些路由没有 board_id 路径参数）。
    """
    stmt = select(BoardMember).where(
        BoardMember.board_id == board_id,
        BoardMember.user_id == user_id,
    )
    member = (await session.execute(stmt)).scalar_one_or_none()
    if member is None:
        raise forbidden("非该看板成员")
    return member


async def get_board_membership(
    board_id: uuid.UUID,
    user: CurrentUser,
    session: SessionDep,
) -> BoardMember:
    """FastAPI 依赖版本：从 board_id 路径参数与当前用户解析成员。"""
    return await resolve_membership(session, board_id, user.id)


async def get_board_or_404(board_id: uuid.UUID, session: SessionDep) -> Board:
    board = await session.get(Board, board_id)
    if board is None:
        raise not_found()
    return board


def require_role(minimum: BoardRole):
    """依赖工厂：要求当前用户在该看板的角色 >= minimum。

    用法：member = Depends(require_role(BoardRole.editor))
    """

    async def _checker(
        membership: Annotated[BoardMember, Depends(get_board_membership)],
    ) -> BoardMember:
        if ROLE_LEVEL[membership.role] < ROLE_LEVEL[minimum]:
            raise forbidden(f"{minimum.value} 及以上角色才能执行该操作")
        return membership

    return _checker


# 常用角色依赖
RequireMember = Annotated[BoardMember, Depends(require_role(BoardRole.viewer))]
RequireEditor = Annotated[BoardMember, Depends(require_role(BoardRole.editor))]
RequireOwner = Annotated[BoardMember, Depends(require_role(BoardRole.owner))]


def client_id_from_request(request: Request) -> str | None:
    return request.headers.get("X-Client-Id")
