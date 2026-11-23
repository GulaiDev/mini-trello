"""Pydantic I/O 模型（OpenAPI 唯一事实来源）。"""

from app.schemas.auth import (
    LoginRequest,
    MeOut,
    RefreshRequest,
    RegisterRequest,
    UserOut,
)
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
from app.schemas.content import (
    CardCreate,
    CardLabelsUpdate,
    CardMove,
    CardMoveResult,
    CardOut,
    CardUpdate,
    LabelCreate,
    LabelOut,
    LabelUpdate,
    ListCreate,
    ListMove,
    ListOut,
    ListUpdate,
)

__all__ = [
    "Page",
    "LoginRequest",
    "RefreshRequest",
    "RegisterRequest",
    "UserOut",
    "MeOut",
    "BoardCreate",
    "BoardOut",
    "BoardUpdate",
    "MemberAdd",
    "MemberOut",
    "MemberRoleUpdate",
    "SnapshotOut",
    "CardCreate",
    "CardMove",
    "CardMoveResult",
    "CardOut",
    "CardUpdate",
    "LabelCreate",
    "LabelOut",
    "LabelUpdate",
    "ListCreate",
    "ListMove",
    "ListOut",
    "ListUpdate",
    "CardLabelsUpdate",
]
