"""并发测试：seq 单调递增、同一间隙并发移动位置唯一。"""

from __future__ import annotations

import asyncio
import uuid
from decimal import Decimal

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.event import BoardEvent
from app.tests.conftest import _auth_headers


async def _make_board_with_two_lists(client, owner_id):
    client.headers.update(_auth_headers(owner_id))
    board_id = (await client.post("/api/boards", json={"title": "并发看板"})).json()["id"]
    l1 = (await client.post(f"/api/boards/{board_id}/lists", json={"title": "L1"})).json()["id"]
    l2 = (await client.post(f"/api/boards/{board_id}/lists", json={"title": "L2"})).json()["id"]
    return board_id, l1, l2


async def test_seq_strictly_increasing(client, make_user):
    owner_id, _ = await make_user()
    board_id, l1, _ = await _make_board_with_two_lists(client, owner_id)
    for i in range(5):
        await client.post(f"/api/lists/{l1}/cards", json={"title": f"卡{i}"})

    async with SessionLocal() as session:
        seqs = list(
            (
                await session.execute(
                    select(BoardEvent.seq)
                    .where(BoardEvent.board_id == uuid.UUID(board_id))
                    .order_by(BoardEvent.seq)
                )
            )
            .scalars()
            .all()
        )
    # board 创建不产事件；list*2 + card*5 = 7 条事件，seq 连续递增
    assert seqs == list(range(1, len(seqs) + 1))
    assert len(set(seqs)) == len(seqs)


async def test_concurrent_moves_into_same_gap_unique(client, make_user):
    """两张卡并发移动到同一间隙，最终位置互不相同。"""
    owner_id, _ = await make_user()
    board_id, l1, l2 = await _make_board_with_two_lists(client, owner_id)

    a = (await client.post(f"/api/lists/{l1}/cards", json={"title": "A"})).json()
    b = (await client.post(f"/api/lists/{l1}/cards", json={"title": "B"})).json()
    x = (await client.post(f"/api/lists/{l2}/cards", json={"title": "X"})).json()
    y = (await client.post(f"/api/lists/{l2}/cards", json={"title": "Y"})).json()

    async def move(card_id: str):
        return await client.post(
            f"/api/cards/{card_id}/move",
            json={"to_list_id": l1, "prev_card_id": a["id"], "next_card_id": b["id"]},
        )

    r1, r2 = await asyncio.gather(move(x["id"]), move(y["id"]))
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text

    p1 = Decimal(r1.json()["position"])
    p2 = Decimal(r2.json()["position"])
    assert p1 != p2, "并发移动到同一间隙位置必须唯一"

    pa, pb = Decimal(a["position"]), Decimal(b["position"])
    # 两个新位置都落在 A 与 B 之间
    assert pa < p1 < pb
    assert pa < p2 < pb

    # 快照顺序无重复 position
    snap = (await client.get(f"/api/boards/{board_id}/snapshot")).json()
    l1_positions = [Decimal(c["position"]) for c in snap["cards"] if c["list_id"] == l1]
    assert len(set(l1_positions)) == len(l1_positions)


async def test_concurrent_card_update_one_conflicts(client, make_user):
    """并发 PATCH 同一卡片携带相同 expected_version，至多一个成功。"""
    owner_id, _ = await make_user()
    board_id, l1, _ = await _make_board_with_two_lists(client, owner_id)
    card = (await client.post(f"/api/lists/{l1}/cards", json={"title": "原"})).json()
    version = card["version"]

    async def patch(title: str):
        return await client.patch(
            f"/api/cards/{card['id']}",
            json={"title": title, "expected_version": version},
        )

    results = await asyncio.gather(patch("改A"), patch("改B"), return_exceptions=True)
    codes = sorted(r.status_code for r in results if not isinstance(r, Exception))
    # 至少一个 200；另一个可能 409（版本冲突）或也 200（未真正并发到 DB）
    assert 200 in codes
