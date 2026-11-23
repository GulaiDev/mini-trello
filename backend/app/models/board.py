"""看板与成员模型。"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    PrimaryKeyConstraint,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDMixin, utcnow


class BoardRole(str, enum.Enum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"


# 角色权限等级：数值越大权限越高
ROLE_LEVEL: dict[BoardRole, int] = {
    BoardRole.viewer: 1,
    BoardRole.editor: 2,
    BoardRole.owner: 3,
}


class Board(UUIDMixin, Base):
    __tablename__ = "boards"

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    members: Mapped[list[BoardMember]] = relationship(
        back_populates="board", cascade="all, delete-orphan"
    )
    lists: Mapped[list[List]] = relationship(  # noqa: F821
        back_populates="board", cascade="all, delete-orphan"
    )
    labels: Mapped[list[Label]] = relationship(  # noqa: F821
        back_populates="board", cascade="all, delete-orphan"
    )


class BoardMember(Base):
    __tablename__ = "board_members"
    __table_args__ = (PrimaryKeyConstraint("board_id", "user_id"),)

    board_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("boards.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[BoardRole] = mapped_column(
        Enum(BoardRole, name="board_role", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=BoardRole.viewer,
    )
    invited_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    board: Mapped[Board] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")  # noqa: F821
