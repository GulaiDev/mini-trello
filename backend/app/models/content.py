"""内容模型：列表、卡片、标签及其关联。"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, UUIDMixin, utcnow

# position 使用 DECIMAL(38,18) 分数索引
POSITION_TYPE = Numeric(38, 18)


card_labels = Table(
    "card_labels",
    Base.metadata,
    Column(
        "card_id",
        Uuid,
        ForeignKey("cards.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "label_id",
        Uuid,
        ForeignKey("labels.id", ondelete="CASCADE"),
        primary_key=True,
    ),
)


class List(UUIDMixin, Base):
    __tablename__ = "lists"
    __table_args__ = (Index("ix_lists_board_pos", "board_id", "archived", "position"),)

    board_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    position: Mapped[Decimal] = mapped_column(POSITION_TYPE, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    board: Mapped[Board] = relationship(back_populates="lists")  # noqa: F821
    cards: Mapped[list[Card]] = relationship(back_populates="list", cascade="all, delete-orphan")


class Card(UUIDMixin, Base):
    __tablename__ = "cards"
    __table_args__ = (Index("ix_cards_list_pos", "list_id", "archived", "position"),)

    list_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    position: Mapped[Decimal] = mapped_column(POSITION_TYPE, nullable=False)
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_by: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    list: Mapped[List] = relationship(back_populates="cards")
    # 多对多关系用经典写法（不带 Mapped 注解），显式 uselist=True，
    # 避免 list["Label"] 在运行时被解析为 list[str] 导致集合推断错误。
    labels = relationship(
        "Label",
        secondary=card_labels,
        back_populates="cards",
        lazy="selectin",
        uselist=True,
    )


class Label(UUIDMixin, Base):
    __tablename__ = "labels"
    __table_args__ = (Index("uq_labels_board_name", "board_id", "name", unique=True),)

    board_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    color: Mapped[str] = mapped_column(String(20), nullable=False, default="clay")

    board: Mapped[Board] = relationship(back_populates="labels")  # noqa: F821
    cards = relationship("Card", secondary=card_labels, back_populates="labels", uselist=True)
