# Mini Trello · 实时协作看板

一个「看板 → 列表 → 卡片」结构的多人实时协作工具。它不是为了再练一遍 CRUD，而是把 FastAPI 与 React 里最难啃的部分放在同一个可验收的项目里：类型化接口、RBAC、WebSocket 房间广播、乐观更新与冲突回滚、分数索引排序、容器化与自动化测试。

> 当前仓库状态：`frontend/` 是 Vite + React + TS 模板，`backend/` 只有依赖清单，业务代码从阶段 0 开始搭建。详细任务拆解、接口契约与验收标准见 [项目计划书](docs/PROJECT_PLAN.md)。

## 为什么是它

一个实时看板能同时压住两端的核心能力：

| 功能点 | FastAPI 侧 | React 侧 |
| --- | --- | --- |
| 看板 / 列表 / 卡片 CRUD | Pydantic schema、路由分层、依赖注入、async SQLAlchemy、Alembic 迁移 | React Router、TanStack Query、加载 / 错误 / 空态、表单校验 |
| 登录 + 成员邀请 | JWT（httpOnly cookie）、`get_current_user` 依赖、RBAC、401 / 403 语义 | 路由守卫、token 刷新、按权限渲染 |
| 拖拽 + 多人同步 | WebSocket 房间广播、事件序号、并发冲突处理 | 乐观更新与回滚、dnd-kit、跨组件状态 |
| 附件 / 统计 | `UploadFile`、后台任务、受保护的文件访问 | 上传进度、图表、缓存失效 |
| 交付 | pytest + httpx、Docker Compose、OpenAPI | Vitest、从 `openapi.json` 生成 TS 类型 |

最后一项是加分点：**接口契约只写一次**。后端 Pydantic 模型是唯一事实来源，前端类型由 OpenAPI 生成，不再两边手抄一遍。

## 技术栈

- 后端：FastAPI、SQLAlchemy 2.1 async、Alembic、MySQL 8.4（InnoDB / utf8mb4）、pytest + httpx、uvicorn
- 前端：Vite + React + TypeScript、TanStack Query（服务端状态）、Zustand（仅 UI 态）、react-router、dnd-kit、Tailwind
- 实时：原生 WebSocket（Starlette），按 `board_id` 划分房间；阶段 5 可加 Redis pub/sub 支持多实例
- 工程：Docker Compose、GitHub Actions、@hey-api/openapi-ts（生成 TS 类型与 SDK）

## 目标目录结构

```text
mini-trello/
├── backend/
│   ├── app/
│   │   ├── main.py            # 应用装配、CORS、路由注册
│   │   ├── core/              # 配置、安全、日志
│   │   ├── models/            # SQLAlchemy 模型
│   │   ├── schemas/           # Pydantic I/O 模型（OpenAPI 来源）
│   │   ├── deps.py            # get_db / get_current_user / RBAC
│   │   ├── services/          # 位置计算、事件落库、权限校验
│   │   ├── routers/           # auth / boards / lists / cards / labels
│   │   ├── ws/                # 连接管理、房间、presence
│   │   ├── realtime/          # 事件定义、序号分配、广播
│   │   └── tests/             # pytest
│   ├── alembic/
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── app/               # 路由与 Provider
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── boards/
│   │   │   └── members/
│   │   ├── lib/
│   │   │   ├── api/           # fetch 封装 + generated/（OpenAPI 生成物）
│   │   │   └── ws/            # 重连、序号、去重
│   │   ├── stores/            # Zustand：拖拽态、弹窗、筛选
│   │   └── components/
│   ├── vite.config.ts
│   └── Dockerfile
├── docs/
│   └── PROJECT_PLAN.md
└── docker-compose.yml
```

## 快速开始（阶段 0 完成后可用）

前置：Node 20+、Python 3.11+、Docker（阶段 4 起）。

后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

访问 `http://localhost:5173`，页面上的 Ping 按钮应显示后端返回的 `pong`；`http://localhost:8000/openapi.json` 可查看接口契约。

推荐在 `vite.config.ts` 中把 `/api` 代理到后端，开发期同源，cookie 与 WebSocket 都少一层跨域问题：

```ts
server: {
  proxy: {
    '/api': { target: 'http://localhost:8000', changeOrigin: true, ws: true },
  },
},
```

### 环境变量

| 变量 | 说明 | 示例 |
| --- | --- | --- |
| `DATABASE_URL` | async 驱动连接串 | `mysql+aiomysql://root:root@db:3306/mini_trello?charset=utf8mb4` |
| `JWT_SECRET` | 签名密钥，生产必须注入 | `change-me` |
| `ACCESS_TOKEN_MINUTES` | 访问令牌有效期 | `15` |
| `REFRESH_TOKEN_DAYS` | 刷新令牌有效期 | `14` |
| `CORS_ORIGINS` | 允许的前端源（逗号分隔，禁止 `*`） | `http://localhost:5173` |
| `COOKIE_SECURE` | 生产必须为 `true` | `false`（本地） |
| `COOKIE_SAMESITE` | 跨站部署时调整 | `lax` |

## 阶段路线

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 0 · 骨架 | 单仓双目录、CORS（带 credentials）、健康检查、OpenAPI 可达 | 未开始 |
| 1 · 领域模型 | Board / List / Card / Label、position 排序、分页过滤、Query 失效 | 未开始 |
| 2 · 多用户与权限 | 注册登录、JWT cookie、RBAC、路由守卫、401 静默刷新 | 未开始 |
| 3 · 实时协作 | WS 房间、乐观更新与回滚、断线重连、事件去重、presence | 未开始 |
| 4 · 工程化 | pytest + httpx、Vitest、Compose、CI、OpenAPI 生成类型 | 未开始 |
| 5 · 可选加码 | 附件与缩略图、全文搜索、审计日志、活跃度图表、Redis 广播 | 未开始 |

每个阶段的入口条件、任务清单与验收标准（DoD）见 [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md)。原则是**阶段闸门制**：上一阶段验收不通过，不进入下一阶段。

## 核心设计摘要

- **服务端权威排序**：`position` 用 `DECIMAL(38,18)` 分数索引，在相邻两张卡之间取中值；间隙耗尽时在事务内重排整列。前端乐观更新只是预演，最终位置以服务端返回为准。
- **事件带序号**：每个看板一条单调递增的 `seq`，服务端落库后可补发。客户端记录 `lastAppliedSeq`，重复事件丢弃，发现空洞立即拉快照重建。
- **乐观更新与对账**：变更携带 `client_move_id`，广播回来时按 `client_id` 识别「这是我自己发起的」，做对账而不是二次应用；失败、冲突（409）或序号空洞时回滚并重新拉取。
- **权限在服务端**：viewer 的写请求由依赖直接返回 403，前端隐藏按钮只是体验，不是安全边界。
- **状态分层**：服务端数据归 TanStack Query，拖拽过程、弹窗、筛选等瞬时 UI 态归 Zustand，两边不互相复制。

## 测试

```powershell
# 后端
cd backend; pytest -q

# 前端
cd frontend; npm run test -- --run; npm run lint

# 全栈
docker compose up --build
```

重点覆盖：未登录 401、viewer 写操作 403、并发移动同一张卡的冲突语义、分数索引顺序、WS 鉴权与 `since_seq` 补发、前端乐观更新回滚、序号去重。

## 三个必须正面处理的问题

1. **实时不许用轮询糊弄**。必须走 WebSocket，并亲自处理乱序、重复与断线补发。这是「会写接口」和「会写系统」的分水岭。
2. **拖拽以服务端为准**。前端乐观更新提体验，冲突时以服务端 `position` 覆盖并回滚，否则两人同时拖必然错乱。
3. **排序不要整列重写**。用分数索引或 LexoRank，顺便练一次数据库并发写与间隙重排。

配套的三个坑：WebSocket 鉴权不要把长期 token 放 query（用 cookie 或首帧认证）；带 cookie 的 CORS 必须 `allow_credentials=True` 且显式 origin，不能写 `*`；TanStack Query 不是全局 store，别把 UI 状态塞进去。

## 文档

- [项目计划书](docs/PROJECT_PLAN.md)：范围、数据模型、接口与 WS 协议、阶段计划、验收标准、风险登记
