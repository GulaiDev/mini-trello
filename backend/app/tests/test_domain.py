"""领域测试：CRUD、分页、position 中值插入、间隙重排、快照一致性。"""

from __future__ import annotations

from decimal import Decimal

from app.services.position import (
    EPSILON,
    gap_exhausted,
    position_between,
    rebalance_positions,
)
from app.tests.conftest import _auth_headers


# --- 纯函数：位置计算 ---
def test_position_between_both_none():
    assert position_between(None, None) == Decimal(1024)


def test_position_between_prev_none():
    assert position_between(None, Decimal(1024)) == Decimal(512)


def test_position_between_next_none():
    assert position_between(Decimal(1024), None) == Decimal(2048)


def test_position_between_midpoint():
    assert position_between(Decimal(1024), Decimal(2048)) == Decimal(1536)


def test_gap_exhausted_detection():
    assert gap_exhausted(Decimal(100), Decimal(100) + EPSILON / 2) is True
    assert gap_exhausted(Decimal(100), Decimal(200)) is False
    assert gap_exhausted(None, Decimal(100)) is False


def test_rebalance_positions():
    assert rebalance_positions(3) == [Decimal(1024), Decimal(2048), Decimal(3072)]


# --- 接口：看板与快照 ---
async def _make_board_with_list(client, owner_id, title="看板"):
    client.headers.update(_auth_headers(owner_id))
    r = await client.post("/api/boards", json={"title": title, "description": ""})
    assert r.status_code == 201, r.text
    board_id = r.json()["id"]
    r2 = await client.post(f"/api/boards/{board_id}/lists", json={"title": "待办"})
    assert r2.status_code == 201, r2.text
    return board_id, r2.json()["id"]


async def test_create_board_and_list_snapshot(client, make_user):
    owner_id, _ = await make_user()
    board_id, list_id = await _make_board_with_list(client, owner_id)

    # 建两张卡
    c1 = await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡1"})
    c2 = await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡2"})
    assert c1.status_code == 201 and c2.status_code == 201

    snap = await client.get(f"/api/boards/{board_id}/snapshot")
    assert snap.status_code == 200
    data = snap.json()
    assert len(data["lists"]) == 1
    assert len(data["cards"]) == 2
    assert data["role"] == "owner"
    # 卡片按 position 升序
    positions = [Decimal(c["position"]) for c in data["cards"]]
    assert positions == sorted(positions)
    assert data["seq"] >= 3  # list.created + 2 card.created


async def test_board_pagination_and_filter(client, make_user):
    owner_id, _ = await make_user()
    client.headers.update(_auth_headers(owner_id))
    for i in range(5):
        await client.post("/api/boards", json={"title": f"看板-{i}", "description": ""})

    page = await client.get("/api/boards", params={"page": 1, "size": 2})
    assert page.status_code == 200
    data = page.json()
    assert data["total"] == 5
    assert len(data["items"]) == 2

    filtered = await client.get("/api/boards", params={"q": "看板-3"})
    assert filtered.json()["total"] == 1


async def test_card_move_recomputes_position(client, make_user):
    owner_id, _ = await make_user()
    board_id, list_id = await _make_board_with_list(client, owner_id)
    # 第二个列表
    r = await client.post(f"/api/boards/{board_id}/lists", json={"title": "进行中"})
    list2_id = r.json()["id"]

    await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡1"})
    c2 = (await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡2"})).json()

    # 把卡2 移到 list2 开头
    mv = await client.post(
        f"/api/cards/{c2['id']}/move",
        json={"to_list_id": list2_id, "prev_card_id": None, "next_card_id": None},
    )
    assert mv.status_code == 200, mv.text
    result = mv.json()
    assert result["card"]["list_id"] == list2_id
    assert Decimal(result["position"]) == Decimal(1024)
    assert result["version"] == c2["version"] + 1


async def test_move_between_neighbors_midpoint(client, make_user):
    owner_id, _ = await make_user()
    board_id, list_id = await _make_board_with_list(client, owner_id)
    c1 = (await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡1"})).json()
    c3 = (await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡3"})).json()
    # 新建卡插入 c1 与 c3 之间
    c2 = (
        await client.post(
            f"/api/lists/{list_id}/cards",
            json={"title": "卡2", "prev_card_id": c1["id"], "next_card_id": c3["id"]},
        )
    ).json()
    p1, p2, p3 = Decimal(c1["position"]), Decimal(c2["position"]), Decimal(c3["position"])
    assert p1 < p2 < p3
    assert p2 == (p1 + p3) / 2


async def test_gap_exhausted_triggers_rebalance_keeps_order(client, make_user):
    """在同一间隙连续插入多次，触发重排后顺序不变。"""
    owner_id, _ = await make_user()
    board_id, list_id = await _make_board_with_list(client, owner_id)
    a = (await client.post(f"/api/lists/{list_id}/cards", json={"title": "A"})).json()
    b = (await client.post(f"/api/lists/{list_id}/cards", json={"title": "B"})).json()

    # 反复在 A 与 B 之间插入，制造间隙收敛
    prev_id = a["id"]
    next_id = b["id"]
    inserted = []
    for i in range(25):
        r = await client.post(
            f"/api/lists/{list_id}/cards",
            json={"title": f"M{i}", "prev_card_id": prev_id, "next_card_id": next_id},
        )
        assert r.status_code == 201, r.text
        card = r.json()
        inserted.append(card["title"])
        # 下一次插入到刚建的卡与 B 之间
        prev_id = card["id"]

    snap = (await client.get(f"/api/boards/{board_id}/snapshot")).json()
    titles = [c["title"] for c in snap["cards"]]
    positions = [Decimal(c["position"]) for c in snap["cards"]]
    # 位置严格递增、无重复
    assert positions == sorted(positions)
    assert len(set(positions)) == len(positions)
    # A 在最前，B 在最后，中间插入项按插入顺序排列
    assert titles[0] == "A"
    assert titles[-1] == "B"


async def test_card_update_version_conflict(client, make_user):
    owner_id, _ = await make_user()
    board_id, list_id = await _make_board_with_list(client, owner_id)
    card = (await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡"})).json()

    # 正确版本可更新
    ok = await client.patch(
        f"/api/cards/{card['id']}",
        json={"title": "改名", "expected_version": card["version"]},
    )
    assert ok.status_code == 200, ok.text

    # 过期版本 409
    conflict_resp = await client.patch(
        f"/api/cards/{card['id']}",
        json={"title": "再改", "expected_version": card["version"]},
    )
    assert conflict_resp.status_code == 409
    body = conflict_resp.json()["detail"]
    assert body["code"] == "conflict"
    assert "latest" in body


async def test_soft_delete_card_removes_from_snapshot(client, make_user):
    owner_id, _ = await make_user()
    board_id, list_id = await _make_board_with_list(client, owner_id)
    card = (await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡"})).json()

    d = await client.delete(f"/api/cards/{card['id']}")
    assert d.status_code == 204

    snap = (await client.get(f"/api/boards/{board_id}/snapshot")).json()
    assert all(c["id"] != card["id"] for c in snap["cards"])
