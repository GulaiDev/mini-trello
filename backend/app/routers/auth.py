"""认证路由：注册 / 登录 / 刷新 / 登出 / me。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Cookie, Response
from sqlalchemy import func, select

from app.core.cookies import (
    REFRESH_COOKIE,
    clear_auth_cookies,
    set_auth_cookies,
)
from app.core.errors import conflict, unauthorized
from app.core.security import create_token, decode_token, hash_password, verify_password
from app.deps import CurrentUser, SessionDep
from app.models.board import BoardMember
from app.models.user import User
from app.schemas.auth import LoginRequest, MeOut, RegisterRequest, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_and_set(response: Response, user: User) -> None:
    access, _ = create_token(str(user.id), "access")
    refresh, refresh_jti = create_token(str(user.id), "refresh")
    user.refresh_jti = refresh_jti
    set_auth_cookies(response, access, refresh)


@router.post("/register", response_model=UserOut, status_code=201)
async def register(
    body: RegisterRequest,
    response: Response,
    session: SessionDep,
) -> User:
    email = body.email.lower()
    existing = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if existing is not None:
        raise conflict("该邮箱已注册")
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        display_name=body.display_name.strip(),
    )
    session.add(user)
    await session.flush()
    _issue_and_set(response, user)
    await session.commit()
    await session.refresh(user)
    return user


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginRequest,
    response: Response,
    session: SessionDep,
) -> User:
    email = body.email.lower()
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not verify_password(body.password, user.password_hash):
        raise unauthorized("邮箱或密码不正确")
    _issue_and_set(response, user)
    await session.commit()
    return user


@router.post("/refresh", response_model=UserOut)
async def refresh(
    response: Response,
    session: SessionDep,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> User:
    """轮换 refresh：校验旧 jti 与用户记录一致，签发新对，旧 token 立即失效。"""
    if not refresh_token:
        raise unauthorized()
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise unauthorized()
    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        raise unauthorized() from None
    user = await session.get(User, user_id)
    if user is None:
        raise unauthorized()
    # 防重放：jti 必须与当前记录一致
    if user.refresh_jti is None or user.refresh_jti != payload.get("jti"):
        # 疑似旧 token 重放，作废整条刷新链
        user.refresh_jti = None
        await session.commit()
        clear_auth_cookies(response)
        raise unauthorized("刷新令牌已失效，请重新登录")
    _issue_and_set(response, user)
    await session.commit()
    return user


@router.post("/logout", status_code=204)
async def logout(
    user: CurrentUser,
    session: SessionDep,
) -> Response:
    user.refresh_jti = None
    await session.commit()
    response = Response(status_code=204)
    clear_auth_cookies(response)
    return response


@router.get("/me", response_model=MeOut)
async def me(user: CurrentUser, session: SessionDep) -> MeOut:
    count = (
        await session.execute(
            select(func.count()).select_from(BoardMember).where(BoardMember.user_id == user.id)
        )
    ).scalar_one()
    return MeOut(user=UserOut.model_validate(user), board_count=int(count))
