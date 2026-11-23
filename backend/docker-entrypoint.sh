#!/bin/sh
# 容器入口：先应用数据库迁移，再启动 ASGI 服务。
# MySQL DDL 隐式提交，迁移只前进不回滚；depends_on 保证 db 已健康。
set -e

echo "[entrypoint] applying database migrations (alembic upgrade head)..."
alembic upgrade head

echo "[entrypoint] starting uvicorn on 0.0.0.0:8000..."
exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers "${UVICORN_WORKERS:-1}" \
    --proxy-headers \
    --forwarded-allow-ips "*"
