# syntax=docker/dockerfile:1
# Mini Trello 前端镜像：Node 构建静态产物 → nginx 托管并反向代理 API/WS。

# --- 构建阶段 ---
FROM node:22-alpine AS build

WORKDIR /app

# 先装依赖以利用缓存层
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# --- 运行阶段 ---
FROM nginx:1.27-alpine AS runtime

# SPA + /api 与 /api/ws 反向代理配置
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1

CMD ["nginx", "-g", "daemon off;"]
