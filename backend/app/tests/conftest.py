"""pytest 全局装置。

- 测试指向独立的 mini_trello_test 库（在导入 app 前设置环境变量）。
- 会话级建表；每个测试前后用 FOREIGN_KEY_CHECKS=0 清库，避免 FK 顺序问题。
- 提供 async_client、user_factory、auth_client、board_factory、member_with_role。
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncGenerator, Callable

# 必须在导入 app.* 之前设置测试库。
# 允许通过 TEST_DATABASE_URL 覆盖（容器/CI 中指向 db 服务），默认本地 localhost。
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL",
    "mysql+aiomysql://root:123456@localhost:3306/mini_trello_test?charset=utf8mb4",
)
os.environ.setdefault("JWT_SECRET", "test-secret-key-that-is-long-enough-32+")
os.environ.setdefault("ENVIRONMENT", "test")

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.security import create_token, hash_password  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.board import Board, BoardMember, BoardRole  # noqa: E402
from app.models.event import BoardCounter  # noqa: E402
from app.models.user import User  # noqa: E402

# 清库顺序（子表在前）
_CLEAN_TABLES = [
    "card_labels",
    "board_events",
    "board_counters",
    "cards",
    "labels",
    "lists",
    "board_members",
    "boards",
    "users",
]


@pytest_asyncio.fixture(scope="session", autouse=True)
def _configure_asyncio() -> None:
    """pytest-asyncio auto 模式下无需自定义 event_loop。"""
    return None


async def _ensure_schema() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def _clean_db() -> None:
    async with SessionLocal() as session:
        await session.execute(text("SET FOREIGN_KEY_CHECKS=0"))
        for table in _CLEAN_TABLES:
            await session.execute(text(f"DELETE FROM {table}"))
        await session.execute(text("SET FOREIGN_KEY_CHECKS=1"))
        await session.commit()


@pytest_asyncio.fixture
async def client() -> AsyncGenerator[AsyncClient, None]:
    await _ensure_schema()
    await _clean_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await _clean_db()


@pytest_asyncio.fixture
async def make_user() -> Callable[..., uuid.UUID]:
    """直接写库创建用户，返回 user_id。"""

    async def _make(
        email: str | None = None,
        password: str = "password123",
        display_name: str = "测试用户",
    ) -> tuple[uuid.UUID, str]:
        email = email or f"user-{uuid.uuid4().hex[:8]}@example.com"
        async with SessionLocal() as session:
            user = User(
                email=email,
                password_hash=hash_password(password),
                display_name=display_name,
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)
            return user.id, password

    return _make


def _auth_headers(user_id: uuid.UUID) -> dict[str, str]:
    """构造携带 access cookie 的请求头。"""
    access, _ = create_token(str(user_id), "access")
    return {"Cookie": f"access_token={access}", "X-Requested-With": "fetch"}


@pytest_asyncio.fixture
async def auth_client(client: AsyncClient, make_user) -> AsyncGenerator[AsyncClient, None]:
    """已登录（owner 身份由 board_factory 赋予）的客户端。"""
    user_id, _ = await make_user()
    client.headers.update(_auth_headers(user_id))
    client.user_id = user_id  # type: ignore[attr-defined]
    yield client


@pytest_asyncio.fixture
async def board_factory(make_user) -> Callable[..., uuid.UUID]:
    """创建看板并指定 owner，返回 board_id。"""

    async def _make(owner_id: uuid.UUID, title: str = "测试看板") -> uuid.UUID:
        async with SessionLocal() as session:
            board = Board(title=title, description="", owner_id=owner_id)
            session.add(board)
            await session.flush()
            session.add(BoardMember(board_id=board.id, user_id=owner_id, role=BoardRole.owner))
            session.add(BoardCounter(board_id=board.id, last_seq=0))
            await session.commit()
            return board.id

    return _make


@pytest_asyncio.fixture
async def member_with_role() -> Callable[..., uuid.UUID]:
    """把用户以指定角色加入看板，返回 user_id。"""

    async def _add(
        board_id: uuid.UUID,
        user_id: uuid.UUID,
        role: BoardRole,
    ) -> uuid.UUID:
        async with SessionLocal() as session:
            session.add(BoardMember(board_id=board_id, user_id=user_id, role=role))
            await session.commit()
        return user_id

    return _add
