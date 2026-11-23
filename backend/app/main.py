"""应用装配：CORS、错误处理、路由注册、CSRF 头校验中间件。"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, get_logger
from app.routers import auth, boards, cards, health, labels, lists, ws

logger = get_logger(__name__)

# 需要 X-Requested-With 头的状态变更方法（配合 SameSite 形成基础 CSRF 防线）
_UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
# 豁免 CSRF 头校验的路径前缀（登录/注册/刷新/登出由 cookie + SameSite 保护）
_CSRF_EXEMPT = (
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/refresh",
    "/api/auth/logout",
)


class CsrfHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in _UNSAFE_METHODS and request.url.path.startswith("/api"):
            if not any(request.url.path.startswith(p) for p in _CSRF_EXEMPT):
                if request.headers.get("X-Requested-With") != "fetch":
                    return JSONResponse(
                        status_code=403,
                        content={
                            "detail": {
                                "code": "csrf",
                                "message": "缺少 X-Requested-With: fetch 头",
                            }
                        },
                    )
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    logger.info("application startup", extra={"context": {"env": settings.environment}})
    yield
    logger.info("application shutdown")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        openapi_url="/openapi.json",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Requested-With", "X-Client-Id"],
        expose_headers=["Content-Type"],
    )
    app.add_middleware(CsrfHeaderMiddleware)

    register_error_handlers(app)

    # 健康检查（不带 /api 前缀也可访问 /api/health）
    app.include_router(health.router, prefix=settings.api_prefix)
    app.include_router(auth.router, prefix=settings.api_prefix)
    app.include_router(boards.router, prefix=settings.api_prefix)
    app.include_router(boards.members_router, prefix=settings.api_prefix)
    app.include_router(lists.router, prefix=settings.api_prefix)
    app.include_router(cards.router, prefix=settings.api_prefix)
    app.include_router(labels.router, prefix=settings.api_prefix)
    app.include_router(ws.router, prefix=settings.api_prefix)

    return app


app = create_app()
