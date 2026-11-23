"""异步引擎与会话管理。"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import settings


def _engine_kwargs() -> dict:
    url = settings.database_url
    kwargs: dict = {"echo": settings.db_echo, "pool_pre_ping": True}
    # SQLite（测试兜底）不支持连接池参数
    if url.startswith("sqlite"):
        return kwargs
    # 使用 READ COMMITTED 隔离级别：写操作依赖列表行锁（FOR UPDATE）串行化，
    # 加锁后需读到其它事务已提交的最新位置；默认的 REPEATABLE READ 会让
    # 事务快照停留在加锁之前，导致并发移动到同一间隙计算出相同 position。
    kwargs["isolation_level"] = "READ COMMITTED"
    # 测试环境使用 NullPool：每个测试跑在独立 event loop 上，
    # 避免池化连接跨 loop 复用导致 "Event loop is closed"。
    if settings.environment == "test":
        kwargs["poolclass"] = NullPool
        return kwargs
    kwargs.update(
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_recycle=settings.db_pool_recycle,
    )
    return kwargs


engine = create_async_engine(settings.database_url, **_engine_kwargs())

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI 依赖：每请求一个会话，正常提交、异常回滚。"""
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
