"""内容相关 schema：列表、卡片、标签。"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


# --- 标签 ---
class LabelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    board_id: uuid.UUID
    name: str
    color: str


class LabelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(default="clay", max_length=20)


class LabelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = Field(default=None, max_length=20)


# --- 卡片 ---
class CardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    list_id: uuid.UUID
    title: str
    description: str
    position: Decimal
    assignee_id: uuid.UUID | None
    due_date: datetime | None
    archived: bool
    version: int
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    label_ids: list[uuid.UUID] = []


class CardCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str = ""
    # 前一张 / 后一张卡片 id；都为空表示放到列表末尾
    prev_card_id: uuid.UUID | None = None
    next_card_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    due_date: datetime | None = None
    label_ids: list[uuid.UUID] = []
    client_move_id: str | None = Field(default=None, max_length=64)


class CardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    assignee_id: uuid.UUID | None = None
    due_date: datetime | None = None
    archived: bool | None = None
    expected_version: int | None = None


class CardMove(BaseModel):
    to_list_id: uuid.UUID
    prev_card_id: uuid.UUID | None = None
    next_card_id: uuid.UUID | None = None
    client_move_id: str | None = Field(default=None, max_length=64)


class CardMoveResult(BaseModel):
    card: CardOut
    position: Decimal
    version: int


class CardLabelsUpdate(BaseModel):
    label_ids: list[uuid.UUID]


# --- 列表 ---
class ListOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    board_id: uuid.UUID
    title: str
    position: Decimal
    archived: bool
    version: int
    created_at: datetime
    updated_at: datetime


class ListCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    prev_list_id: uuid.UUID | None = None
    next_list_id: uuid.UUID | None = None
    client_move_id: str | None = Field(default=None, max_length=64)


class ListUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    archived: bool | None = None
    expected_version: int | None = None


class ListMove(BaseModel):
    prev_list_id: uuid.UUID | None = None
    next_list_id: uuid.UUID | None = None
    client_move_id: str | None = Field(default=None, max_length=64)
