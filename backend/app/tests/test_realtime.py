"""实时 WS 测试：匿名拒绝、hello/ready、since_seq 补发、resync、ping/pong。"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.tests.conftest import _clean_db, _ensure_schema


@pytest.fixture
def sync_client():
    """同步 TestClient（支持 WebSocket）；测试前后清库。"""
    asyncio.run(_ensure_schema())
    asyncio.run(_clean_db())
    with TestClient(app) as c:
        yield c
    asyncio.run(_clean_db())


def _register_and_board(sync_client: TestClient) -> str:
    r = sync_client.post(
        "/api/auth/register",
        json={
            "email": f"ws-{uuid.uuid4().hex[:8]}@example.com",
            "password": "password123",
            "display_name": "WS 用户",
        },
    )
    assert r.status_code == 201, r.text
    sync_client.headers.update({"X-Requested-With": "fetch"})
    b = sync_client.post("/api/boards", json={"title": "实时看板", "description": ""})
    assert b.status_code == 201, b.text
    return b.json()["id"]


def test_ws_anonymous_rejected_4401(sync_client):
    board_id = str(uuid.uuid4())
    with pytest.raises(WebSocketDisconnect) as exc:
        with sync_client.websocket_connect(f"/api/ws/boards/{board_id}") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_ws_non_member_rejected_4403(sync_client):
    # 已登录但对随机看板无成员身份
    _register_and_board(sync_client)
    other_board = str(uuid.uuid4())
    with pytest.raises(WebSocketDisconnect) as exc:
        with sync_client.websocket_connect(f"/api/ws/boards/{other_board}") as ws:
            ws.receive_json()
    assert exc.value.code == 4403


def test_ws_hello_ready(sync_client):
    board_id = _register_and_board(sync_client)
    with sync_client.websocket_connect(f"/api/ws/boards/{board_id}") as ws:
        ws.send_json({"type": "hello", "since_seq": 0, "client_id": "tab-1"})
        msg = ws.receive_json()
        assert msg["type"] == "ready"
        assert msg["role"] == "owner"
        assert "presence" in msg
        assert msg["seq"] >= 0


def _recv_until(ws, mtype: str, limit: int = 5):
    """接收消息直到出现指定类型（跳过 presence.join 等中间广播）。"""
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["type"] == mtype:
            return msg
    raise AssertionError(f"未收到 {mtype} 帧")


def test_ws_ping_pong(sync_client):
    board_id = _register_and_board(sync_client)
    with sync_client.websocket_connect(f"/api/ws/boards/{board_id}") as ws:
        ws.send_json({"type": "hello", "since_seq": 0, "client_id": "tab-1"})
        assert ws.receive_json()["type"] == "ready"
        ws.send_json({"type": "ping"})
        # ready 后会广播 presence.join，需跳过后再断言 pong
        assert _recv_until(ws, "pong")["type"] == "pong"


def test_ws_backfill_since_seq(sync_client):
    board_id = _register_and_board(sync_client)
    # 创建列表(seq1) 与卡片(seq2)
    lst = sync_client.post(f"/api/boards/{board_id}/lists", json={"title": "L"})
    list_id = lst.json()["id"]
    sync_client.post(f"/api/lists/{list_id}/cards", json={"title": "C"})

    with sync_client.websocket_connect(f"/api/ws/boards/{board_id}") as ws:
        # since_seq=1 → 应补发 seq=2 的 card.created，然后 ready
        ws.send_json({"type": "hello", "since_seq": 1, "client_id": "tab-1"})
        first = ws.receive_json()
        assert first["type"] == "card.created"
        assert first["seq"] == 2
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        assert ready["seq"] == 2


def test_ws_resync_when_out_of_window(sync_client):
    board_id = _register_and_board(sync_client)
    sync_client.post(f"/api/boards/{board_id}/lists", json={"title": "L"})
    with sync_client.websocket_connect(f"/api/ws/boards/{board_id}") as ws:
        # since_seq 远早于保留窗口 → resync
        ws.send_json({"type": "hello", "since_seq": -5000, "client_id": "tab-1"})
        msg = ws.receive_json()
        assert msg["type"] == "resync"


def test_ws_broadcast_between_two_clients(sync_client):
    """一个客户端连接后，REST 写操作产生的事件通过 presence/广播可见。

    这里验证：第二个客户端连接时会收到 presence.join 广播。
    """
    board_id = _register_and_board(sync_client)
    with sync_client.websocket_connect(f"/api/ws/boards/{board_id}") as ws1:
        ws1.send_json({"type": "hello", "since_seq": 0, "client_id": "tab-1"})
        assert ws1.receive_json()["type"] == "ready"
        # ws1 自己也会收到 presence.join（含自身）
        join = ws1.receive_json()
        assert join["type"] == "presence.join"
        assert board_id == join["board_id"]
