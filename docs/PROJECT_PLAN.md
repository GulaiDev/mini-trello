# Mini Trello 项目计划书

> 版本：v1.0
> 范围：一个可多人实时协作的迷你看板（Board → List → Card），用于系统性地练习 FastAPI 与 React 的高阶能力。
> 推进方式：阶段闸门制。每个里程碑只有通过验收清单（DoD）才进入下一阶段，不以日历工期驱动。

---

## 1. 项目概述

### 1.1 背景

Todo 类项目只能覆盖 CRUD。本项目选择多人实时看板，原因是它天然要求同时解决：

- 领域建模与排序：列表内有序、可跨列表移动，且不能整列重写。
- 身份与授权：登录态、成员邀请、owner / editor / viewer 三级权限，且必须在服务端生效。
- 实时一致性：多端同时操作，事件需有序、可补发、可去重，客户端需乐观更新与回滚。
- 契约治理：后端 Schema 为唯一事实来源，前端类型从 OpenAPI 生成。

### 1.2 目标

| 编号 | 目标 | 可验证结果 |
| --- | --- | --- |
| G1 | 完成可运行的看板 CRUD 与拖拽排序 | 刷新页面顺序不变，跨列表拖拽持久化 |
| G2 | 权限在服务端强制 | viewer 直接调用写接口返回 403，非成员返回 403 |
| G3 | 双端实时同步 | 两个浏览器互不刷新即可看到对方的移动，冲突后自动收敛 |
| G4 | 断线可恢复 | 断网重连后无重复卡片、无顺序错乱、无事件空洞 |
| G5 | 契约驱动 | 前端类型由 `openapi.json` 生成，CI 校验无漂移 |
| G6 | 一键起全栈并跑测试 | `docker compose up` 后 API 与前端测试全部通过 |

### 1.3 非目标

- 不做移动端原生应用、支付、富文本协同编辑。
- 不实现完整离线优先（CRDT / 本地库同步）；断线期间仅做有限排队与重连对账。
- 不做多租户计费、SSO、企业级审计合规。
- 阶段 5 的搜索、附件、统计均为加分项，不阻塞主线验收。

### 1.4 关键约束

- 实时必须使用 WebSocket，明确禁止轮询冒充实时。
- 排序使用分数索引（两个 position 取中值）或 LexoRank，不允许每次拖拽重排整列。
- 前端乐观更新必须在失败、冲突、事件空洞时回滚或快照重建。
- 服务端数据与 UI 状态分离：TanStack Query 管服务端状态，Zustand 只放 UI 态。

---

## 2. 范围与交付物

| 交付物 | 说明 |
| --- | --- |
| `backend/` | FastAPI 应用、Alembic 迁移、pytest 套件、Dockerfile |
| `frontend/` | Vite + React + TS 应用、Vitest 套件、Dockerfile |
| `docker-compose.yml` | mysql + api + web（阶段 4） |
| `docs/PROJECT_PLAN.md` | 本计划书 |
| `README.md` | 使用说明与路线概览 |
| CI 配置 | lint、单测、类型生成漂移检查 |
| OpenAPI 快照 | `openapi.json` 作为契约基线 |

---

## 3. 系统架构

### 3.1 逻辑架构

```text
┌──────────────────────────── 浏览器 ────────────────────────────┐
│  React 19 + Vite + TS                                          │
│  ├─ react-router          路由与守卫                            │
│  ├─ TanStack Query        服务端状态、缓存、乐观更新             │
│  ├─ Zustand              拖拽态、弹窗、筛选（仅 UI）             │
│  ├─ dnd-kit              列表内 / 跨列表拖拽                     │
│  └─ lib/ws               连接管理、seq 去重、重连退避            │
└───────────────┬───────────────────────────┬────────────────────┘
                │ REST (cookie)             │ WebSocket (cookie)
                ▼                           ▼
┌──────────────────────────── FastAPI ───────────────────────────┐
│  routers/  ── deps(get_current_user, require_role)              │
│  services/ ── 位置计算、事务、事件落库                           │
│  ws/       ── 房间注册表、presence、慢消费者处理                  │
│  realtime/ ── 事件模型、按 board 分配 seq、广播                   │
│  SQLAlchemy 2.1 async  ──  MySQL 8.4 (InnoDB, utf8mb4)          │
└────────────────────────────────────────────────────────────────┘
```

### 3.2 技术选型

| 层 | 选择 | 理由 |
| --- | --- | --- |
| API | FastAPI | 依赖注入、Pydantic 校验、自动 OpenAPI |
| ORM | SQLAlchemy 2.1 async | 显式事务与锁控制，便于练并发 |
| 迁移 | Alembic | 可回溯的 schema 变更 |
| 数据库 | MySQL 8.4（InnoDB） | `DECIMAL` 精度、行锁、`FULLTEXT` ngram（阶段 5）；环境已有 `aiomysql` 驱动 |
| 实时 | Starlette WebSocket | 轻量，便于手写房间与补发逻辑 |
| 前端框架 | React 19 + TypeScript | 类型安全与生态 |
| 服务端状态 | TanStack Query v5 | 缓存、失效、乐观更新原语 |
| UI 状态 | Zustand | 只放瞬时状态，避免与 Query 重复 |
| 拖拽 | dnd-kit | 可访问性、跨容器拖拽 |
| 样式 | Tailwind | 快速布局，减少样式噪音 |
| 契约生成 | @hey-api/openapi-ts | 兼容当前 TypeScript 6（openapi-typescript 7.x 的 peer 仍限 `^5.x`），同时生成类型与可选 SDK |

> 说明：数据库选用 MySQL 8.4（InnoDB / utf8mb4）。`backend/requirements.txt` 已固定 `aiomysql` 与 `cryptography`（MySQL 8 默认 `caching_sha2_password` 认证需要后者）。PostgreSQL 的 JSONB、`tsvector`、`pg_advisory_xact_lock` 与 `INSERT ... RETURNING` 在 MySQL 中没有直接等价物，替代方案见 4.5。

### 3.3 运行时拓扑

- 开发：Vite `5173` → 代理 `/api`（含 WS）→ uvicorn `8000` → MySQL `3306`。同源代理可规避大部分 cookie 与 CORS 问题，同时保留跨域配置以便直连调试。
- 生产 / Compose：nginx 托管静态产物，反向代理 `/api` 与 `/api/ws`（需转发 `Upgrade` / `Connection` 头），API 与 DB 通过内网通信。

---

## 4. 数据模型

### 4.1 实体关系

```text
users ──< board_members >── boards ──< lists ──< cards >── card_labels ──< labels
                                 │                  │
                                 └──< board_events  └──< attachments（阶段 5）
```

### 4.2 表定义

| 表 | 关键字段 | 约束 / 索引 |
| --- | --- | --- |
| `users` | `id` UUID、`email`、`password_hash`、`display_name`、`created_at` | `email` 唯一 |
| `boards` | `id`、`title`、`description`、`owner_id`、`created_at`、`updated_at` | `owner_id` → users |
| `board_members` | `board_id`、`user_id`、`role`、`invited_by`、`created_at` | 复合主键；`role ∈ {owner, editor, viewer}` |
| `lists` | `id`、`board_id`、`title`、`position`、`archived`、`version` | `(board_id, position)` 索引 |
| `cards` | `id`、`list_id`、`title`、`description`、`position`、`assignee_id`、`due_date`、`archived`、`version`、`created_by`、`updated_at` | `(list_id, position)` 索引；`version` 用于并发校验 |
| `labels` | `id`、`board_id`、`name`、`color` | `(board_id, name)` 唯一 |
| `card_labels` | `card_id`、`label_id` | 复合主键 |
| `board_events` | `id`、`board_id`、`seq`、`type`、`actor_id`、`client_id`、`client_move_id`、`payload` JSON、`created_at` | `(board_id, seq)` 唯一；按时间清理 |
| `board_counters` | `board_id`、`last_seq` | 主键 `board_id`；行锁分配事件序号 |
| `attachments` | `id`、`card_id`、`filename`、`content_type`、`size`、`storage_path`、`thumb_path` | 阶段 5 |

时间统一存 UTC，前端本地化展示。删除采用 `archived` 软删除（卡片、列表），看板为硬删除并级联。

### 4.3 排序策略（核心）

`position` 使用 `DECIMAL(38, 18)`（MySQL 中 `NUMERIC` 是 `DECIMAL` 的同义词），每次移动只写一张卡：

```python
DEFAULT_GAP = 1024.0
EPSILON = 1e-9

def position_between(prev: Decimal | None, nxt: Decimal | None) -> Decimal:
    if prev is None and nxt is None:
        return Decimal(DEFAULT_GAP)
    if prev is None:
        return nxt / 2
    if nxt is None:
        return prev + Decimal(DEFAULT_GAP)
    return (prev + nxt) / 2
```

规则：

1. 客户端提交目标列表与前后邻居的 id，服务端查询邻居的 `position` 计算新值。
2. 在 `lists` 行上取事务级行锁（`SELECT ... FOR UPDATE`），串行化该列的移动，避免两人同时算出同一位置。MySQL 没有 `pg_advisory_xact_lock`；确需会话级锁时用 `GET_LOCK` / `RELEASE_LOCK`，必须保证同一连接并在 `finally` 释放。
3. 若 `nxt - prev < EPSILON`，在事务内按当前顺序把整列重排为 `1024, 2048, ...` 后重算，重试上限 3 次。
4. 接口返回最终 `position` 与 `version`，前端以返回值覆盖本地预演值。
5. 前端拖拽只发送「移到哪两个邻居之间」，不发送自己计算的浮点位置。

验收要点：随机插入 200 次后，`ORDER BY position` 与用户看到的一致；任意两次并发移动到同一间隙，结果位置互不相同且都能成功（或一方 409 后重试成功）。

### 4.4 并发控制

- 单卡编辑使用 `version` 乐观锁：`PATCH` 携带 `expected_version`，不匹配返回 409 与最新卡片。
- 移动操作以列表级锁串行化，返回权威位置；不做「最后写入者覆盖整列」。
- 事件序号由 `board_counters.last_seq` 在写事务内自增分配后写入 `board_events`，保证事件顺序与数据顺序一致。

### 4.5 MySQL 适配要点

- **驱动与连接串**：`mysql+aiomysql://user:pass@db:3306/mini_trello?charset=utf8mb4`。`aiomysql` 已在依赖清单中，另需 `cryptography`（MySQL 8 默认 `caching_sha2_password` 认证）。库、表、连接统一 `utf8mb4` / `utf8mb4_0900_ai_ci`。
- **数值与主键**：排序用 `DECIMAL(38,18)`；UUID 建议 `BINARY(16)`（SQLAlchemy `Uuid`），不愿引入二进制转换时用 `CHAR(36)`，但需接受索引体积。
- **锁与隔离级别**：移动事务显式使用 `READ COMMITTED`，规避 REPEATABLE READ 的间隙锁；统一「先锁 `lists` 行，再读邻居」的加锁顺序，对死锁（错误码 1213）整体重试一次。`FOR UPDATE` 需要显式事务，且必须命中索引，否则会退化为锁全表。
- **序号分配**：MySQL 不支持 `INSERT ... RETURNING`，用 `board_counters` 行：`UPDATE board_counters SET last_seq = last_seq + 1 WHERE board_id = ?`，同事务内 `SELECT last_seq`。行锁保证同一看板的 seq 唯一且连续。
- **迁移**：MySQL 的 DDL 会隐式提交，Alembic 无法回滚 DDL。只写可前进的迁移步骤，CI 每次在全新库上跑 `alembic upgrade head` 验证，破坏性变更拆成多步发布。
- **JSON 与检索**：`board_events.payload` 用 MySQL `JSON`（无 JSONB），只做整体读写，不依赖 JSON 路径索引；阶段 5 搜索用 `FULLTEXT ... WITH PARSER ngram`（`ngram_token_size=2`），数据量小时可先用 `LIKE` 过渡。
- **时间与大小写**：统一 `DATETIME(6)` 存 UTC，避免 `TIMESTAMP` 的 2038 上限与隐式时区转换；默认 ci collation 使 email 唯一索引忽略大小写，写入前统一转小写。
- **索引**：MySQL 没有部分索引，软删除过滤使用 `(list_id, archived, position)` 联合索引，排序查询仍需走索引避免 filesort。

---

## 5. 接口契约

统一前缀 `/api`，统一错误体：

```json
{ "detail": { "code": "forbidden", "message": "viewer cannot modify cards" } }
```

### 5.1 鉴权

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | 注册并直接登录，Set-Cookie |
| POST | `/api/auth/login` | 登录，下发 access + refresh |
| POST | `/api/auth/refresh` | 轮换 refresh，重发 access |
| POST | `/api/auth/logout` | 清除 cookie，refresh 失效 |
| GET | `/api/auth/me` | 当前用户与可见看板数 |

Cookie 策略：

- `access_token`：`HttpOnly`、`Path=/`、`SameSite=Lax`、`Secure`（生产）。
- `refresh_token`：`HttpOnly`、`Path=/api/auth/refresh`、`SameSite=Lax`。
- 状态变更请求要求自定义头 `X-Requested-With: fetch`（配合 SameSite 形成基础 CSRF 防线）。
- 刷新采用轮换：旧 refresh 立即失效，防重放。

### 5.2 资源接口

| 资源 | 方法与路径 | 权限 |
| --- | --- | --- |
| 看板列表 | `GET /api/boards?page=&size=&q=` | 登录用户，仅返回自己可见的 |
| 创建看板 | `POST /api/boards` | 登录用户（创建者即 owner） |
| 看板详情 | `GET /api/boards/{id}` | 成员 |
| 更新 / 删除 | `PATCH` / `DELETE /api/boards/{id}` | owner |
| 快照 | `GET /api/boards/{id}/snapshot` | 成员；返回 lists、cards、labels、我的角色、`seq` |
| 成员列表 | `GET /api/boards/{id}/members` | 成员 |
| 邀请成员 | `POST /api/boards/{id}/members`（按 email + role） | owner |
| 改角色 / 移除 | `PATCH` / `DELETE /api/boards/{id}/members/{user_id}` | owner |
| 列表创建 | `POST /api/boards/{id}/lists` | editor / owner |
| 列表更新 / 删除 | `PATCH` / `DELETE /api/lists/{id}` | editor / owner |
| 列表移动 | `PATCH /api/lists/{id}/move` | editor / owner |
| 卡片创建 | `POST /api/lists/{id}/cards` | editor / owner |
| 卡片详情 / 更新 / 删除 | `GET` / `PATCH` / `DELETE /api/cards/{id}` | 成员读；editor / owner 写 |
| 卡片移动 | `POST /api/cards/{id}/move` | editor / owner |
| 标签增删改 | `/api/boards/{id}/labels`、`/api/cards/{id}/labels` | editor / owner |

分页采用 `page` + `size`（默认 20，上限 100），响应包含 `items`、`total`、`page`、`size`。看板内 lists 与 cards 按 `position` 升序返回，卡片首次加载上限 500 张并提示截断（阶段 5 再做虚拟滚动）。

### 5.3 权限矩阵

| 操作 | viewer | editor | owner |
| --- | --- | --- | --- |
| 查看看板 / 卡片 | 允许 | 允许 | 允许 |
| 创建 / 编辑 / 删除列表 | 拒绝 | 允许 | 允许 |
| 创建 / 编辑 / 删除卡片、拖拽 | 拒绝 | 允许 | 允许 |
| 编辑标签并挂到卡片 | 拒绝 | 允许 | 允许 |
| 邀请 / 移除成员、改角色 | 拒绝 | 拒绝 | 允许 |
| 修改看板信息 | 拒绝 | 拒绝 | 允许 |
| 删除看板 | 拒绝 | 拒绝 | 允许 |

实现方式：`require_role(board_id, user, minimum)` 依赖在所有写路由上声明；WS 建连时同样校验角色，viewer 只能收事件不能发变更。**前端隐藏按钮不作为安全边界**，验收使用 curl 直调写接口。

### 5.4 契约生成

```bash
# 后端运行后，在 frontend/ 下执行
npm run gen:api
# 等价于：openapi-ts -i http://localhost:8000/openapi.json -o src/lib/api/generated
```

生成物包含 `types.gen.ts`、`sdk.gen.ts` 与 typed client。CI 中重新生成并 `git diff --exit-code`，任何后端 Schema 改动未同步前端类型都会失败。请求封装可直接使用生成的 SDK，也可只取类型接现有 fetch 封装，禁止手写响应类型。

---

## 6. 实时协议（阶段 3 核心）

### 6.1 连接与鉴权

- 地址：`GET /api/ws/boards/{board_id}`，升级为 WebSocket。
- 鉴权：读取 httpOnly cookie 中的 access token；**禁止把 token 放在 query 参数**（会进日志与历史记录）。
- 未登录以关闭码 `4401` 拒绝，无权限以 `4403` 拒绝，握手后不再接受匿名帧。
- 心跳：客户端每 25s 发送 `{"type":"ping"}`，服务端回 `pong`；60s 无消息则服务端断开，客户端进入重连。

### 6.2 首帧与补发

```json
// 客户端首帧
{ "type": "hello", "since_seq": 128, "client_id": "tab-uuid" }

// 服务端就绪
{ "type": "ready", "seq": 130, "role": "editor", "presence": ["u1", "u2"] }
```

- 服务端按 `board_events` 中 `seq > since_seq` 顺序补发（单次上限 500 条）。
- 若 `since_seq` 早于保留窗口或超出上限，返回 `{"type":"resync","seq":130}`，客户端重新拉取快照后继续消费。
- 首次连接（`since_seq = 0`）由客户端先拉快照，再建立 WS，避免重复全量。

### 6.3 事件信封与类型

```json
{
  "event_id": "01J...",
  "board_id": "b_123",
  "seq": 131,
  "type": "card.moved",
  "actor_id": "u_1",
  "client_id": "tab-uuid",
  "client_move_id": "mv-7f3a",
  "occurred_at": "2026-11-22T10:00:00Z",
  "payload": {
    "card_id": "c_9",
    "from_list_id": "l_1",
    "to_list_id": "l_2",
    "position": "3072.000000000000000000",
    "version": 8
  }
}
```

事件类型：

| 类型 | 触发 | 持久化 |
| --- | --- | --- |
| `board.updated` | 看板改名 / 描述 | 是 |
| `list.created` / `list.updated` / `list.moved` / `list.deleted` | 列表变更 | 是 |
| `card.created` / `card.updated` / `card.moved` / `card.deleted` | 卡片变更 | 是 |
| `label.*` / `card_labels.changed` | 标签变更 | 是 |
| `member.added` / `member.role_changed` / `member.removed` | 成员变更 | 是 |
| `presence.sync` / `presence.join` / `presence.leave` | 在线状态 | 否（无 seq、不补发） |

所有持久化事件必须先写业务数据与 `board_events`，同事务提交后再广播；广播失败不影响已提交数据。

### 6.4 客户端消费规则

1. 维护 `lastAppliedSeq`（内存 + sessionStorage）。收到事件时若 `seq <= lastAppliedSeq` 直接丢弃；若 `seq > lastAppliedSeq + 1` 判定空洞，立即 `invalidateQueries(snapshot)` 并丢弃后续事件直到快照返回。
2. 若 `event.client_id === 当前标签页 client_id`，说明是自己的操作回显：按 `client_move_id` 找到临时状态并替换为服务端权威数据，不重复插入。
3. 否则应用到 Query 缓存（`setQueryData`），必要时按 position 重新插入排序。
4. 无法映射的未知事件类型只更新 `lastAppliedSeq`，不报错，保证向后兼容。

### 6.5 断线重连

- 退避：`0.5s × 2^n`，上限 30s，加 ±20% 抖动，页面隐藏时暂停重连。
- 重连成功后携带 `since_seq = lastAppliedSeq`，优先走补发；收到 `resync` 则重拉快照。
- 断线期间：本地拖拽允许乐观预演，但标记为「待同步」，且禁止连续多次跨列表移动；重连补发完成后以快照对账，冲突项丢弃本地预演。
- UI 顶栏显示连接状态（在线 / 重连中 / 离线），离线时禁用「邀请成员」等强一致操作。

### 6.6 冲突语义

- 两人同时移动同一张卡：服务端串行分配位置，后到者按最新邻居重算；两端都收到两条 `card.moved`，最终以 `seq` 较大者为准，服务端位置权威。
- 编辑卡片：`expected_version` 不匹配返回 409 + 最新数据；前端提示「内容已被他人修改」，展示最新值，用户可重新编辑。
- 卡片在 A 端移动的同时被 B 端删除：删除事件 `seq` 更大时，客户端移除卡片并忽略移动事件（按 `card_id` 存在性判断）。

---

## 7. 前端设计

### 7.1 路由

| 路径 | 页面 | 守卫 |
| --- | --- | --- |
| `/login` | 登录 | 已登录跳 `/` |
| `/register` | 注册 | 已登录跳 `/` |
| `/` | 看板列表 | 登录 |
| `/boards/:boardId` | 看板主视图 | 登录 + 成员 |
| `/boards/:boardId/settings` | 成员与设置 | 登录 + owner |
| `*` | 404 | 无 |

### 7.2 状态分层

- **TanStack Query**：`['me']`、`['boards', filters]`、`['board', id, 'snapshot']`、`['board', id, 'members']`。所有服务端数据只存在这里。
- **Zustand**：拖拽中的卡片与落点、弹窗开关、筛选条件、连接状态、临时 toast。禁止缓存卡片正文。
- **WS 模块**：不持有业务数据，只负责连接、序号、去重与事件分发（通过回调写入 Query 缓存）。

### 7.3 乐观更新流程

```text
onDragEnd
  └─ 计算本地新顺序 → cancelQueries → 保存旧快照 → setQueryData 预演
       └─ POST /cards/{id}/move（client_move_id）
            ├─ 2xx：用返回的 position/version 校对，标记已同步
            ├─ 4xx/5xx：恢复旧快照 + toast「已回滚」
            └─ 超时：保持预演为待同步，等待 WS 事件或重连后快照对账
```

创建卡片同理：先插入 `temp_<uuid>` 卡片，成功后用服务端 id 替换；失败移除临时项。所有 mutation 的 `onSettled` 都按需精准失效：单卡操作只改快照缓存，不整体 `invalidateQueries(['boards'])`。

### 7.4 拖拽

- dnd-kit 的 `DndContext` 放在看板页，`SortableContext` 按列表划分。
- 只提交「目标列表 + 前一张卡 id + 后一张卡 id」，位置由服务端计算。
- 拖拽期间通过 Zustand 暴露 `isDragging` 给列表占位样式；避免把拖拽中的坐标写进 Query 缓存导致其他组件重渲染。
- 键盘拖拽（`KeyboardSensor`）与屏幕阅读器播报纳入验收，作为可访问性最低要求。

### 7.5 鉴权与 401 刷新

- 启动时 `GET /api/auth/me` 作为会话探测；401 视为未登录。
- fetch 封装：遇到 401 且非 `/api/auth/*`，单飞（single-flight）调用 `/api/auth/refresh`，成功后重放原请求一次；refresh 也失败则跳登录并清理 Query 缓存。
- 不使用 localStorage 存 token；登录态完全由 cookie 与 `me` 查询决定。
- 权限渲染：`role === 'viewer'` 时隐藏拖拽手柄与写按钮，但服务端仍会拒绝（双保险，不互为替代）。

### 7.6 类型生成

`src/lib/api/generated/` 由 `npm run gen:api` 生成并提交，封装层只依赖生成物：

```ts
import type { paths } from './generated/types.gen'

type CardMoveBody = paths['/api/cards/{card_id}/move']['post']['requestBody']['content']['application/json']
```

生成的 SDK 默认使用 fetch；接入时需要显式带上 `credentials: 'include'`，或直接使用自有封装以复用统一的 401 刷新逻辑。

Schema 变更流程：改后端 Pydantic → 跑 `npm run gen:api` → TS 编译报错推动前端适配 → CI diff 把关。

---

## 8. 测试策略

### 8.1 后端（pytest + httpx）

基础设施：

- `AsyncClient(transport=ASGITransport(app))`，不启真实端口。
- 每个测试独立事务回滚。MySQL 的 `TRUNCATE` 无法作用于被外键引用的父表，如需清库按依赖逆序 `DELETE`，或在测试库 `SET FOREIGN_KEY_CHECKS=0` 后清理再恢复。
- 固定装置：`user_factory`、`auth_client`、`board_factory`、`member_with_role`。

用例清单（按优先级）：

| 类别 | 用例 |
| --- | --- |
| 骨架 | 健康检查 200；OpenAPI 可解析 |
| 鉴权 | 注册后 Set-Cookie 含 HttpOnly / SameSite；无 cookie 访问受保护接口 401；refresh 轮换后旧 token 失效；登出后 401 |
| 权限 | viewer 对每个写接口 403（参数化覆盖）；非成员读看板 403；editor 邀请成员 403 |
| 领域 | 创建 / 更新 / 软删除；分页与过滤；position 中值插入；间隙耗尽触发重排且顺序不变 |
| 并发 | 同一间隙两次并发移动 → 位置唯一；同一卡片并发 PATCH → 一方 409；seq 严格递增 |
| 实时 | 匿名 WS 建连被 4401 拒绝；viewer 发变更被拒；广播 seq 单调；`since_seq` 正确补发；超窗口返回 resync |
| 上传（阶段 5） | 类型 / 大小限制；缩略图任务执行；越权下载 403 |

覆盖率目标：核心 `services/` 与 `deps.py` 行覆盖 ≥ 80%，不为凑数写断言。

### 8.2 前端（Vitest + Testing Library）

| 用例 | 断言 |
| --- | --- |
| 登录表单校验 | 空邮箱 / 密码过短不发请求 |
| 路由守卫 | 未登录访问 `/boards/1` 重定向 `/login` |
| 401 静默刷新 | 仅刷新一次并重放，不产生循环 |
| 乐观回滚 | 移动接口 500 后卡片回到原位，出现回滚提示 |
| 冲突回滚 | 409 后用响应中的权威数据覆盖，不残留预演 |
| 序号去重 | 重复 seq 丢弃；空洞触发快照拉取 |
| presence | 成员加入 / 离开更新在线列表 |
| 权限渲染 | viewer 不渲染拖拽手柄与编辑按钮 |

WS 用 `mock-socket` 或可注入的 `WebSocketFactory` 模拟，避免测试依赖真实服务。

### 8.3 双浏览器验收脚本（阶段 3）

1. A、B 用不同账号登录同一看板，B 为 editor。
2. A 拖动卡片到另一列表：B 不刷新即看到，延迟可感知 ≤ 300ms。
3. 两人同时拖同一张卡：双方最终顺序一致，落后一方看到一次回滚或直接对齐，无重复卡片。
4. A 打开 DevTools 断网 10 秒，期间拖动若干次；恢复网络后双方状态收敛，A 无重复项、无错位。
5. B 被降为 viewer 后，界面隐藏写操作；用 curl 直调写接口返回 403。
6. 关闭 B 标签页，A 的 presence 中 B 消失。

### 8.4 一键验证

```bash
docker compose up --build -d
docker compose exec api pytest -q
docker compose exec api alembic upgrade head --sql > /dev/null   # 迁移可生成
cd frontend; npm run test -- --run                                 # web 容器只托管静态产物，前端测试在本地或 CI 跑
```

---

## 9. 工程化与部署

### 9.1 Docker Compose

| 服务 | 镜像 / 构建 | 说明 |
| --- | --- | --- |
| `db` | mysql:8.4 | 命名卷持久化；启动参数 `--character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci`；`mysqladmin ping` healthcheck |
| `api` | `./backend` | 入口先 `alembic upgrade head` 再 `uvicorn`；`depends_on: db: condition: service_healthy` |
| `web` | `./frontend` 多阶段构建 → nginx | 托管静态资源；反向代理 `/api` 与 `/api/ws`，配置 `Upgrade` / `Connection` 头 |
| `redis` | redis:7-alpine（profile: `scale`） | 阶段 5 多实例广播 |

后端镜像使用非 root 用户；上传目录挂载卷；`.env` 不入库，提供 `.env.example`。

### 9.2 CI 流水线

| 任务 | 内容 |
| --- | --- |
| `api-lint` | ruff check + format check |
| `api-test` | 启动 mysql:8.4 service，等待 healthcheck，`alembic upgrade head`，`pytest --cov` |
| `web-lint` | eslint + `tsc --noEmit` |
| `web-test` | vitest run |
| `contract` | 启动 API → 重新生成类型 → `git diff --exit-code` |
| `build` | 两镜像构建（可仅在主分支） |

合并保护：以上任务全部通过才允许合并；`main` 分支禁止直接推送。

### 9.3 配置与安全

- `JWT_SECRET` 由环境注入，长度 ≥ 32；缺失时启动失败而非使用默认值。
- CORS：`allow_origins` 从环境读取并校验非 `*`；`allow_credentials=True`；显式列出方法与头。
- 上传（阶段 5）：校验 MIME 与扩展名白名单、限制大小、随机化存储名；下载走鉴权路由，不直接暴露静态目录。
- 日志：结构化输出，包含 `request_id`、`board_id`、`actor_id`；不记录 token、密码与文件内容。

---

## 10. 阶段计划

每个阶段包含：目标、任务、交付物、验收标准（DoD）。**未通过 DoD 不进入下一阶段。**

### 阶段 0 · 骨架（里程碑 M0）

目标：打通前后端链路，固定工程约定。

任务：

- [ ] 建立 `backend/app` 包结构与 `main.py`，注册 `/api/health`
- [ ] 配置 CORS：显式 origin、`allow_credentials=True`、预检通过
- [ ] 配置日志与统一错误处理骨架
- [ ] 前端配置 `/api` 代理（含 `ws: true`）、Tailwind、路由骨架
- [ ] 首页 Ping 调用 `/api/health`，展示 pong 与加载 / 失败态
- [ ] 补齐后端基础依赖（alembic、aiomysql、cryptography、pwdlib[argon2]、PyJWT、pytest、httpx、pytest-asyncio）
- [ ] 提交 `openapi.json` 基线脚本与 `gen:api` 脚本

交付物：可启动的前后端、健康检查、CORS 配置、类型生成脚本。

DoD：

- [ ] 浏览器点击 Ping 显示 `pong`
- [ ] `curl http://localhost:8000/api/health` 返回 `{"status":"ok"}`
- [ ] `http://localhost:8000/openapi.json` 可访问且包含健康检查路径
- [ ] 跨域预检响应含 `access-control-allow-credentials: true`，且 origin 精确匹配
- [ ] 断网 / 后端关闭时前端显示错误态而非白屏

### 阶段 1 · 领域模型（M1）

目标：完成 Board / List / Card / Label 与可靠的排序。

任务：

- [ ] 建立四张表与关联表，`position` 使用 `DECIMAL(38,18)`（`utf8mb4`、`DATETIME(6)`）
- [ ] Alembic 初始迁移与种子脚本
- [ ] 看板分页、关键词过滤；列表与卡片按 position 返回
- [ ] 位置计算服务与间隙重排（含单元测试）
- [ ] 列表 / 卡片移动接口（服务端权威）
- [ ] 前端看板页：加载、错误、空态、骨架屏
- [ ] Query hooks：列表查询、创建 / 移动 / 删除 mutation、精准失效
- [ ] 基础拖拽（先只做同列表内排序）

交付物：可持久化的看板、排序与移动接口、看板页 UI。

DoD：

- [ ] 创建 3 个列表、10 张卡，反复拖拽后刷新顺序不变
- [ ] 数据库查询 `ORDER BY position` 与界面顺序完全一致
- [ ] 200 张卡随机移动 100 次后无重复 position、无顺序漂移
- [ ] 连续在同一间隙插入 20 次触发重排，重排后顺序不变
- [ ] 列表查询失败时展示可重试的错误态
- [ ] 阶段验收后可先冻结功能扩展，做一轮复盘与补测

### 阶段 2 · 多用户与权限（M2）

目标：登录态与三级权限在服务端强制生效。

任务：

- [ ] users 表、密码哈希（bcrypt / argon2）
- [ ] 注册 / 登录 / 刷新 / 登出 / me
- [ ] JWT 签发与 cookie 属性配置（HttpOnly、SameSite、Secure、Path）
- [ ] `get_current_user` 依赖与 401 语义
- [ ] `require_role` 依赖，覆盖所有写路由（含 WS 预留）
- [ ] 成员邀请（按 email）、改角色、移除；owner 唯一性保护
- [ ] 前端登录 / 注册页、路由守卫、单飞刷新拦截器
- [ ] 按角色渲染操作入口
- [ ] 登出清理 Query 缓存与 WS 连接

交付物：完整认证链路、RBAC、成员管理页。

DoD：

- [ ] 未登录访问受保护接口返回 401，且响应头带 `WWW-Authenticate`
- [ ] viewer 用 curl 调用卡片写接口返回 403（逐接口验证）
- [ ] 非成员读看板返回 403，不泄露看板标题
- [ ] access 过期后前端自动刷新一次并重放，用户无感
- [ ] refresh 轮换后旧 refresh 重放失败
- [ ] owner 不能把自己降级为 editor，也不能移除最后一个 owner
- [ ] 登出后受保护页面立即跳登录，Query 缓存无残留

### 阶段 3 · 实时协作（M3，核心）

目标：多端不刷新同步，冲突可收敛，断线可恢复。

任务：

- [ ] `board_events` 表与 seq 分配服务（写事务内）
- [ ] WS 路由、cookie 鉴权、关闭码 4401 / 4403
- [ ] 房间注册表与连接生命周期（心跳、清理、慢消费者）
- [ ] 所有写接口在提交后发出对应事件
- [ ] 快照接口返回当前 seq；WS 支持 `since_seq` 补发与 resync
- [ ] 前端 WS 管理器：单飞连接、退避重连、序号去重、空洞重建
- [ ] 乐观更新与回滚（移动、创建、编辑、删除）
- [ ] `client_move_id` 对账，避免自己的事件被二次应用
- [ ] presence：加入 / 离开 / 在线列表
- [ ] 连接状态提示与离线降级

交付物：实时看板、WS 协议实现、presence 与重连能力。

DoD：

- [ ] 两个浏览器拖动同一卡片，双方无需刷新即可互见，延迟可感知 ≤ 300ms
- [ ] 同时拖动同一卡片，最终两端顺序一致，无重复卡片
- [ ] 断网 10 秒期间操作，恢复后状态收敛；DevTools 中 seq 无空洞或空洞被快照修复
- [ ] 服务端强制断开后客户端按退避重连，不产生连接风暴
- [ ] 未登录 WS 连接被 4401 拒绝；viewer 发送变更被拒
- [ ] presence 在标签页关闭后 10 秒内消失（心跳超时）
- [ ] 单进程 50 个并发连接下事件顺序不乱、内存无持续增长

### 阶段 4 · 工程化（M4）

目标：测试、容器与契约流水线闭环。

任务：

- [ ] pytest 基础设施与用例（鉴权、权限、并发、实时）
- [ ] Vitest + RTL：守卫、刷新、乐观回滚、去重
- [ ] 后端 / 前端 Dockerfile 与 nginx 配置（含 WS 升级头）
- [ ] `docker-compose.yml` 与 `.env.example`
- [ ] CI 流水线（lint / test / contract / build）
- [ ] 接入生成的 TS 类型，移除手写接口类型
- [ ] README 与运维说明补齐

交付物：一键启动的全栈、可重复的测试套件、CI 配置。

DoD：

- [ ] `docker compose up --build` 后三个服务健康，页面可正常操作
- [ ] 容器内 `pytest` 全绿，前端 `vitest run` 全绿
- [ ] CI 在 PR 上全绿，contract 任务能拦截未同步的类型
- [ ] 全量重跑两次结果一致（无顺序依赖）
- [ ] 镜像可重复构建，无硬编码密钥

### 阶段 5 · 可选加码（M5）

按兴趣选做，每项独立验收：

- [ ] 附件上传：体积 / 类型限制、BackgroundTasks 生成缩略图、鉴权下载
- [ ] 全文搜索：`FULLTEXT ... WITH PARSER ngram`；中文分词粒度（`ngram_token_size`）单独记录取舍
- [ ] 操作审计：事件表派生审计视图，支持按成员 / 时间过滤
- [ ] 活跃度图表：按天聚合卡片创建 / 移动，前端图表展示
- [ ] Redis pub/sub：多 API 实例下广播一致，压测两实例交叉验证

DoD：任一选做项都需有对应测试与 README 使用说明；不影响主线阶段的可用性。

---

## 11. 风险登记

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 事件乱序 / 丢失导致界面错乱 | 高 | 每看板单调 seq；空洞检测 + 快照重建；补发窗口上限 |
| 分数索引精度耗尽 | 中 | 间隙阈值检测，事务内整列重排；重试上限并记录指标 |
| 并发拖拽写冲突 | 高 | 列表级行锁串行化；服务端返回权威位置；409 明确语义 |
| 乐观更新与服务端不一致 | 高 | `client_move_id` 对账；失败回滚；重连后快照对账 |
| 跨站 cookie 失效 | 中 | 生产同源反向代理；必要时 `SameSite=None; Secure`，并补 CSRF 防护 |
| CORS 配置错误（`*` + credentials） | 中 | 启动时校验 origin 列表；预检纳入自动化测试 |
| WS 长连接泄漏 / 慢消费者拖垮服务 | 中 | 心跳超时清理；发送队列上限；超限以 1013 断开 |
| 开放重连风暴 | 中 | 指数退避 + 抖动 + 页面隐藏暂停 |
| 测试库与生产行为差异 | 中 | 测试使用同版本 MySQL 8.4；CI 使用 service container |
| MySQL 间隙锁 / 死锁 | 中 | 移动事务用 `READ COMMITTED`；固定加锁顺序；1213 重试一次并记录 |
| DDL 隐式提交导致迁移不可回滚 | 中 | 只写前进式迁移；CI 在全新库验证；发布前备份 |
| OpenAPI 与前端类型漂移 | 中 | CI 重新生成并 diff；类型错误阻断构建 |
| 范围膨胀导致阶段停滞 | 高 | 阶段闸门；阶段 5 全部可选；每阶段只做 DoD 内的事 |

---

## 12. 附录

### 12.1 状态码约定

| 码 | 语义 |
| --- | --- |
| 400 | 请求语义错误（如非法邻居组合） |
| 401 | 未认证 / token 过期 |
| 403 | 已认证但无权限（含 viewer 写、非成员访问） |
| 404 | 资源不存在或不可见（不区分，防枚举） |
| 409 | 版本冲突 / 位置冲突需重试 |
| 422 | 请求体校验失败（FastAPI 默认） |
| 1013 / 4401 / 4403 | WS：服务过载、未认证、无权限 |

### 12.2 事件 payload 示例

```json
{ "type": "card.created", "payload": { "card": { "id": "c_1", "list_id": "l_1", "title": "设计登录页", "position": "1024.0", "version": 1 } } }
{ "type": "card.updated", "payload": { "card_id": "c_1", "version": 2, "changed": { "title": "设计登录与注册页" } } }
{ "type": "card.deleted", "payload": { "card_id": "c_1", "list_id": "l_1" } }
{ "type": "member.role_changed", "payload": { "user_id": "u_2", "from": "editor", "to": "viewer" } }
```

### 12.3 关键决策记录

| 决策 | 结论 | 备选与否决理由 |
| --- | --- | --- |
| 实时方案 | 原生 WebSocket + 自建房间 | 轮询无法满足一致性与延迟；Socket.IO 隐藏了要练的细节 |
| 排序 | `DECIMAL` 分数索引 | 整列浮点重写写放大严重；纯整数相邻重排并发成本高 |
| 数据库 | MySQL 8.4（InnoDB / utf8mb4） | 环境已有 `aiomysql` 驱动栈，团队熟悉；DECIMAL + 行锁足以支撑排序与并发。放弃 PostgreSQL 的 JSONB / tsvector / advisory lock，替代方案见 4.5 |
| 令牌存放 | httpOnly cookie | localStorage 易受 XSS；query token 会进日志 |
| 前端类型 | OpenAPI 生成 | 手写类型必然漂移，无法在 CI 拦截 |
| 状态管理 | Query + Zustand 分工 | 全部塞 Zustand 会重复实现缓存、失效与重试 |

### 12.4 阶段推进原则

1. 先让阶段 1 完全稳定，再上实时；实时阶段的问题往往会被未收敛的排序逻辑放大。
2. 每个阶段结束保留一次演示脚本，验收以脚本为准，不以「看起来能用」为准。
3. 任何为赶进度绕过服务端校验、绕过序号、绕过回滚的做法都视为未完成。
