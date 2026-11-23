"""实时事件模型：board_events 与 board_counters。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    PrimaryKeyConstraint,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, UUIDMixin, utcnow


class BoardEvent(UUIDMixin, Base):
    """持久化的看板事件，用于补发与审计。"""

    __tablename__ = "board_events"
    __table_args__ = (Index("uq_board_events_board_seq", "board_id", "seq", unique=True),)

    board_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    type: Mapped[str] = mapped_column(String(60), nullable=False)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_move_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class BoardCounter(Base):
    """每看板一行的序号计数器，写事务内行锁分配 seq。"""

    __tablename__ = "board_counters"
    __table_args__ = (PrimaryKeyConstraint("board_id"),)

    board_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("boards.id", ondelete="CASCADE"))
    last_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
