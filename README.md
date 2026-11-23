# Mini Trello · 实时协作看板

一个「看板 → 列表 → 卡片」结构的多人实时协作工具。它把 FastAPI 与 React 里最难啃的部分放在同一个可验收的项目里：类型化接口契约、RBAC、WebSocket 房间广播、乐观更新与冲突回滚、分数索引排序、容器化与自动化测试。

> 仓库状态：**阶段 0–4 已全部实现并通过验收**（后端 39 项 pytest、前端 35 项 vitest、ruff/eslint/tsc 全绿，浏览器端到端流程已验证）。阶段 5 为可选加码，未实现。完整设计、接口契约与验收标准见 [项目计划书](docs/PROJECT_PLAN.md)。

## 已实现能力

- **认证与会话**：注册 / 登录 / 登出，JWT 存 httpOnly cookie，access 过期时静默刷新一次；路由守卫按登录态跳转。
- **看板 / 列表 / 卡片 / 标签 CRUD**：分页与搜索、软删除、乐观锁（`version` + `expected_version` → 409 携带 `latest`）。
- **成员与 RBAC**：`owner` / `editor` / `viewer` 三级角色，**写权限在服务端强制**（viewer 直调写接口返回 403），前端按角色隐藏写操作仅为体验。
- **拖拽排序**：dnd-kit 跨列拖拽，`position` 分数索引（`DECIMAL(38,18)` 取两邻居中值），服务端权威计算位置；乐观更新 + 失败回滚。
- **实时协作**：原生 Starlette WebSocket，按 `board_id` 分房间广播；每看板单调递增 `seq`；断线重连按 `since_seq` 补发，超出保留窗口触发 `resync` 全量重拉；presence 在线状态；25s 心跳。
- **工程化**：后端多阶段 Dockerfile（非 root）、前端 nginx 托管 + 反向代理（含 WS 升级头）、`docker-compose.yml`、GitHub Actions CI（lint / test / contract / build）。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 后端 | FastAPI、SQLAlchemy 2.x async、Alembic、MySQL 8.4（InnoDB / utf8mb4）、aiomysql、PyJWT、pwdlib[argon2] |
| 实时 | Starlette WebSocket（房间广播 + 事件序号 + 补发） |
| 前端 | Vite + React 19 + TypeScript、TanStack Query v5（服务端状态）、Zustand（UI/实时态）、react-router、dnd-kit、Tailwind v4 |
| 契约 | `backend/openapi.json` 为唯一事实来源，CI 逐字节校验漂移 |
| 测试 | pytest + httpx（ASGITransport）+ Starlette TestClient；Vitest + jsdom + Testing Library + mock-socket |
| 交付 | Docker Compose、nginx、GitHub Actions |

## 目录结构

```text
mini-trello/
├── backend/
│   ├── app/
│   │   ├── main.py            # 应用装配、CORS、CSRF 头中间件、路由注册
│   │   ├── core/              # 配置、安全(JWT/argon2)、cookie、错误、日志
│   │   ├── db/                # 引擎/会话(READ COMMITTED)、Base
│   │   ├── models/            # SQLAlchemy 模型：user/board/content/event
│   │   ├── schemas/           # Pydantic I/O 模型（OpenAPI 来源）
│   │   ├── deps.py            # get_db / 当前用户 / RBAC 依赖
│   │   ├── services/          # 位置计算、内容服务、事件落库与序号
│   │   ├── routers/           # auth / boards / lists / cards / labels / ws / health
│   │   ├── ws/                # 连接管理器、房间、presence
│   │   ├── realtime/          # 事件类型定义
│   │   └── tests/             # pytest：域模型/权限/并发/实时/认证
│   ├── alembic/               # 迁移（初始 schema）
│   ├── scripts/export_openapi.py  # 导出契约（CI 漂移校验）
│   ├── ruff.toml              # 固定的 lint/format 规则集
│   ├── requirements.txt
│   ├── Dockerfile · docker-entrypoint.sh · .dockerignore · .env.example
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # Provider + 路由 + 401 桥接
│   │   ├── lib/
│   │   │   ├── api/           # types(DTO) / client(fetch 封装) / index(端点)
│   │   │   └── ws.ts          # BoardSocket：握手/补发/心跳/重连
│   │   ├── features/
│   │   │   ├── auth/          # useAuth / AuthPage / RequireAuth
│   │   │   ├── home/          # 看板列表页
│   │   │   └── board/         # 看板页、列、卡片、抽屉、mappers/reducer/store/hooks
│   │   ├── components/        # Avatar / Toaster / icons
│   │   └── test/setup.ts
│   ├── nginx.conf             # SPA 回退 + /api 与 /api/ws 反向代理
│   ├── vite.config.ts         # 开发代理 + vitest 配置
│   └── Dockerfile · .dockerignore
├── deploy/mysql-init/         # 首次初始化建库（含测试库）
├── .github/workflows/ci.yml   # CI：api-lint/api-test/web-lint/web-test/contract/build
├── docker-compose.yml         # db + api + web (+ redis: scale profile)
├── .env.example · .gitattributes
└── docs/PROJECT_PLAN.md
```

## 快速开始

### 方式 A：Docker Compose（一键起全栈）

前置：Docker + Docker Compose。

```bash
cp .env.example .env          # 生产务必替换 JWT_SECRET / MYSQL_ROOT_PASSWORD
docker compose up --build -d
```

- 前端（nginx）：http://localhost:8080
- 后端 API：http://localhost:8000/api ，文档 http://localhost:8000/docs
- `api` 入口会先 `alembic upgrade head` 再启动 uvicorn；`web` 待 `api` 健康后启动。
- 容器内跑后端测试：`docker compose exec api pytest -q`
- 阶段 5 的 Redis：`docker compose --profile scale up -d`

### 方式 B：本地开发

前置：Node 20+、Python 3.12+、可访问的 MySQL 8.x。

**1) 准备数据库**（库名 `mini_trello`，测试库 `mini_trello_test`，`utf8mb4`）：

```sql
CREATE DATABASE mini_trello      CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE DATABASE mini_trello_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
```

**2) 后端**：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env          # 按需修改 DATABASE_URL / JWT_SECRET
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

**3) 前端**（另开一个终端）：

```powershell
cd frontend
npm install
npm run dev                     # http://localhost:5173，已把 /api 与 /api/ws 代理到 :8000
```

开发期同源代理让 httpOnly cookie 与 WebSocket 免去跨域烦恼。

### 环境变量

后端变量见 [`backend/.env.example`](backend/.env.example)，Compose 变量见 [`.env.example`](.env.example)。关键项：

| 变量 | 说明 | 本地示例 |
| --- | --- | --- |
| `DATABASE_URL` | async 连接串 | `mysql+aiomysql://root:123456@localhost:3306/mini_trello?charset=utf8mb4` |
| `JWT_SECRET` | 签名密钥，长度 ≥ 32，生产必须替换 | `dev-only-...-32+` |
| `ACCESS_TOKEN_MINUTES` / `REFRESH_TOKEN_DAYS` | 令牌有效期 | `15` / `14` |
| `CORS_ORIGINS` | 允许的前端源（逗号分隔，**禁止 `*`**） | `http://localhost:5173` |
| `COOKIE_SECURE` | 生产 https 必须为 `true` | `false`（本地） |
| `COOKIE_SAMESITE` | 跨站部署时调整 | `lax` |

## 测试与质量

```powershell
# 后端（需本地 MySQL 与 mini_trello_test 库）
cd backend
pytest -q                                   # 39 passed：域模型/权限/并发/实时/认证
ruff check . ; ruff format --check .        # lint + 格式

# 前端
cd frontend
npm run test                                # 35 passed：reducer/mappers/client/ws
npm run lint                                # eslint
npm run typecheck                           # tsc -b
```

覆盖重点：未登录 401、viewer 写操作 403、并发移动同一间隙的 position 唯一性、分数索引顺序、WS 鉴权（关闭码 4401/4403）与 `since_seq` 补发 / `resync`、前端事件增量应用与序号去重、乐观更新回滚、HTTP 客户端 401→刷新→重放。

## CI 流水线

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) 在 push / PR 上运行：

| 任务 | 内容 |
| --- | --- |
| `api-lint` | `ruff check` + `ruff format --check` |
| `api-test` | mysql:8.4 service → `alembic upgrade head` → `pytest --cov` |
| `web-lint` | `eslint` + `tsc -b` |
| `web-test` | `vitest run` |
| `contract` | 重新生成 `openapi.json` 并 `git diff --exit-code` 校验漂移 |
| `build` | 构建前后端镜像（仅 `main` 分支） |

## 接口与实时协议摘要

**REST**（前缀 `/api`，状态变更需 `X-Requested-With: fetch` 头，登录/注册/刷新/登出豁免）：
`auth/{register,login,refresh,logout,me}`、`boards`（列表/详情/快照 `snapshot`）、`boards/{id}/members`、`lists`（含 `move`）、`cards`（含 `move`、`labels`）、`labels`。完整定义见 [`backend/openapi.json`](backend/openapi.json) 与 http://localhost:8000/docs 。

**WebSocket** `/api/ws/boards/{id}`（cookie 鉴权）：

1. 客户端连接后发送首帧 `hello { since_seq, client_id }`。
2. 服务端补发 `seq > since_seq` 的事件后发 `ready { seq, role, presence }`；落后超出保留窗口则发 `resync`（客户端全量重拉快照）。
3. 持续接收事件信封（`list.*` / `card.*` / `label.*` / `member.*` / `board.updated`）与 `presence.{sync,join,leave}`。
4. 客户端每 25s 发 `ping`，服务端回 `pong`；关闭码 `4401`（未登录）/ `4403`（无权限）不再重连。

## 核心设计决策

- **服务端权威排序**：`position` 用 `DECIMAL(38,18)` 分数索引，移动只写一张卡（取两邻居中值）；间隙耗尽时在事务内重排整列。前端乐观值仅为预演，最终以服务端返回覆盖。
- **并发正确性**：写路径先对目标列表行 `SELECT ... FOR UPDATE` 串行化，并将事务隔离级别设为 **READ COMMITTED**——否则 MySQL 默认 REPEATABLE READ 会让加锁后的邻居读取停留在旧快照，导致两个并发移动算出相同 `position`。
- **事件带序号**：每看板单调 `seq` 落库，支持断线补发；客户端记录 `lastAppliedSeq`，重复事件丢弃，发现空洞立即重拉快照。
- **乐观更新与对账**：变更携带 `client_move_id`，广播回来时按 `client_id` 识别「自己发起的」做对账而非二次应用；失败 / 409 / 序号空洞时回滚并重拉。
- **权限在服务端**：viewer 的写请求由依赖直接返回 403，前端隐藏按钮只是体验，不是安全边界。
- **状态分层**：服务端数据归 TanStack Query（快照缓存 + 增量应用），presence / socket 连接态归 Zustand，两边不互相复制。

## 三个必须正面处理的问题（本项目如何应对）

1. **实时不用轮询**：全程 WebSocket，自行处理乱序、重复与断线补发（`since_seq` / `resync`）。
2. **拖拽以服务端为准**：乐观更新提体验，冲突时以服务端 `position`/`version` 覆盖并回滚。
3. **排序不整列重写**：分数索引 + 间隙耗尽才重排，配合行锁与 READ COMMITTED 保证并发写正确。

配套的坑也已规避：WS 鉴权用 cookie + 首帧而非把长期 token 放 query；带 cookie 的 CORS 显式列 origin 且 `allow_credentials=True`（拒绝 `*`）；TanStack Query 只放服务端状态，UI 态归 Zustand。

## 文档

- [项目计划书](docs/PROJECT_PLAN.md)：范围、数据模型、接口与 WS 协议、阶段计划、验收标准、风险登记。
