"""看板与成员相关 schema。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.board import BoardRole
from app.schemas.content import CardOut, LabelOut, ListOut


class BoardCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""


class BoardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class BoardOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    description: str
    owner_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    role: BoardRole | None = None  # 当前用户在该看板的角色（列表/详情填充）


class MemberOut(BaseModel):
    id: uuid.UUID
    email: EmailStr
    display_name: str
    role: BoardRole
    created_at: datetime


class MemberAdd(BaseModel):
    email: EmailStr
    role: BoardRole = BoardRole.editor


class MemberRoleUpdate(BaseModel):
    role: BoardRole


class SnapshotOut(BaseModel):
    """看板快照：一次性返回渲染所需的全部数据与当前 seq。"""

    board: BoardOut
    role: BoardRole
    seq: int
    lists: list[ListOut]
    cards: list[CardOut]
    labels: list[LabelOut]
    members: list[MemberOut]
    truncated: bool = False
