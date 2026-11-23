"""统一错误体与业务异常。

错误体形如：{"detail": {"code": "forbidden", "message": "..."}}
"""

from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """业务异常，携带 HTTP 状态码与错误 code。"""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        extra: dict | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra or {}
        super().__init__(message)


def _body(code: str, message: str, **extra) -> dict:
    detail = {"code": code, "message": message}
    detail.update(extra)
    return {"detail": detail}


# --- 常用快捷构造 ---
def forbidden(message: str = "无权限执行该操作") -> ApiError:
    return ApiError(status.HTTP_403_FORBIDDEN, "forbidden", message)


def unauthorized(message: str = "未认证或登录已过期") -> ApiError:
    return ApiError(status.HTTP_401_UNAUTHORIZED, "unauthorized", message)


def not_found(message: str = "资源不存在或不可见") -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "not_found", message)


def conflict(message: str, **extra) -> ApiError:
    return ApiError(status.HTTP_409_CONFLICT, "conflict", message, extra=extra)


def bad_request(message: str, **extra) -> ApiError:
    return ApiError(status.HTTP_400_BAD_REQUEST, "bad_request", message, extra=extra)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
        headers = {}
        if exc.status_code == status.HTTP_401_UNAUTHORIZED:
            headers["WWW-Authenticate"] = "Bearer"
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(exc.code, exc.message, **exc.extra),
            headers=headers,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code_map = {
            400: "bad_request",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            409: "conflict",
        }
        code = code_map.get(exc.status_code, "error")
        headers = getattr(exc, "headers", None) or {}
        return JSONResponse(
            status_code=exc.status_code,
            content=_body(code, str(exc.detail)),
            headers=headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_body("validation_error", "请求体校验失败", errors=exc.errors()),
        )
