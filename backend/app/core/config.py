"""应用配置。

所有敏感项由环境变量注入；缺失关键项时启动失败而非退回默认值。
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- 应用 ---
    app_name: str = "Mini Trello API"
    environment: str = "development"  # development | test | production
    api_prefix: str = "/api"

    # --- 数据库 ---
    database_url: str = "mysql+aiomysql://root:123456@localhost:3306/mini_trello?charset=utf8mb4"
    db_echo: bool = False
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_pool_recycle: int = 1800

    # --- 认证 ---
    jwt_secret: str = "dev-only-insecure-secret-change-me-please-32+"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 15
    refresh_token_days: int = 14

    # --- Cookie ---
    cookie_secure: bool = False
    cookie_samesite: str = "lax"
    cookie_domain: str | None = None

    # --- CORS ---
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # --- 实时 ---
    ws_heartbeat_timeout: int = 60
    ws_backlog_limit: int = 500  # since_seq 单次补发上限
    event_retention: int = 2000  # 每看板保留的事件条数（补发窗口）

    # --- 上传（阶段 5）---
    upload_dir: str = "./uploads"
    max_upload_bytes: int = 8 * 1024 * 1024

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        if "*" in origins:
            raise ValueError("CORS_ORIGINS 不允许使用 '*'（与 allow_credentials 冲突）")
        return origins

    @field_validator("jwt_secret")
    @classmethod
    def _validate_secret(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET 长度必须 >= 32")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
