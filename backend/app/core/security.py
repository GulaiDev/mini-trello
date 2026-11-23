"""安全：密码哈希（argon2）与 JWT 签发/校验。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

# argon2id 为推荐算法
password_hash = PasswordHash.recommended()

TokenType = Literal["access", "refresh"]


def hash_password(plain: str) -> str:
    return password_hash.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return password_hash.verify(plain, hashed)
    except Exception:
        return False


def _now() -> datetime:
    return datetime.now(UTC)


def create_token(
    subject: str,
    token_type: TokenType,
    *,
    extra: dict[str, Any] | None = None,
) -> tuple[str, str]:
    """签发 JWT，返回 (token, jti)。

    jti 用于 refresh 轮换时的失效追踪。
    """
    now = _now()
    if token_type == "access":
        exp = now + timedelta(minutes=settings.access_token_minutes)
    else:
        exp = now + timedelta(days=settings.refresh_token_days)

    jti = uuid.uuid4().hex
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "jti": jti,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    if extra:
        payload.update(extra)
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, jti


def decode_token(token: str) -> dict[str, Any] | None:
    """解码并校验 JWT；失败返回 None。"""
    try:
        return jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.PyJWTError:
        return None
