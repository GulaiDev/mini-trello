"""权限矩阵测试：viewer 写操作 403、非成员 403、editor 越权 403。"""

from __future__ import annotations

from app.models.board import BoardRole
from app.tests.conftest import _auth_headers


async def _register(client, email: str) -> None:
    resp = await client.post(
        "/api/auth/register",
        json={"email": email, "password": "password123", "display_name": email},
    )
    assert resp.status_code == 201, resp.text


async def test_non_member_cannot_read_board(client, make_user, board_factory):
    owner_id, _ = await make_user()
    board_id = await board_factory(owner_id)
    outsider_id, _ = await make_user()

    client.headers.update(_auth_headers(outsider_id))
    resp = await client.get(f"/api/boards/{board_id}")
    assert resp.status_code == 403
    # 不泄露看板标题
    assert "测试看板" not in resp.text


async def test_viewer_forbidden_on_all_writes(client, make_user, board_factory, member_with_role):
    owner_id, _ = await make_user()
    board_id = await board_factory(owner_id)
    viewer_id, _ = await make_user()
    await member_with_role(board_id, viewer_id, BoardRole.viewer)

    client.headers.update(_auth_headers(viewer_id))

    # 创建列表
    r = await client.post(f"/api/boards/{board_id}/lists", json={"title": "列"})
    assert r.status_code == 403

    # 创建看板（viewer 仍可创建自己的看板，这里验证的是 board 作用域写）
    r = await client.patch(f"/api/boards/{board_id}", json={"title": "改名"})
    assert r.status_code == 403

    # 邀请成员
    r = await client.post(
        f"/api/boards/{board_id}/members",
        json={"email": "x@y.com", "role": "editor"},
    )
    assert r.status_code == 403

    # 创建标签
    r = await client.post(f"/api/boards/{board_id}/labels", json={"name": "标签", "color": "clay"})
    assert r.status_code == 403


async def test_viewer_can_read_snapshot(client, make_user, board_factory, member_with_role):
    owner_id, _ = await make_user()
    board_id = await board_factory(owner_id)
    viewer_id, _ = await make_user()
    await member_with_role(board_id, viewer_id, BoardRole.viewer)

    client.headers.update(_auth_headers(viewer_id))
    resp = await client.get(f"/api/boards/{board_id}/snapshot")
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"


async def test_editor_cannot_invite_member(client, make_user, board_factory, member_with_role):
    owner_id, _ = await make_user()
    board_id = await board_factory(owner_id)
    editor_id, _ = await make_user()
    await member_with_role(board_id, editor_id, BoardRole.editor)
    other_id, other_email = await make_user(email="other@example.com")

    client.headers.update(_auth_headers(editor_id))
    resp = await client.post(
        f"/api/boards/{board_id}/members",
        json={"email": "other@example.com", "role": "viewer"},
    )
    assert resp.status_code == 403


async def test_editor_can_create_list_and_card(client, make_user, board_factory, member_with_role):
    owner_id, _ = await make_user()
    board_id = await board_factory(owner_id)
    editor_id, _ = await make_user()
    await member_with_role(board_id, editor_id, BoardRole.editor)

    client.headers.update(_auth_headers(editor_id))
    r = await client.post(f"/api/boards/{board_id}/lists", json={"title": "待办"})
    assert r.status_code == 201, r.text
    list_id = r.json()["id"]

    r2 = await client.post(f"/api/lists/{list_id}/cards", json={"title": "卡片A"})
    assert r2.status_code == 201, r2.text


async def test_owner_cannot_demote_last_owner(client, make_user, board_factory):
    owner_id, _ = await make_user()
    board_id = await board_factory(owner_id)

    client.headers.update(_auth_headers(owner_id))
    resp = await client.patch(
        f"/api/boards/{board_id}/members/{owner_id}",
        json={"role": "editor"},
    )
    assert resp.status_code == 403


async def test_owner_cannot_remove_owner(client, make_user, board_factory):
    owner_id, _ = await make_user()
    board_id = await board_factory(owner_id)

    client.headers.update(_auth_headers(owner_id))
    resp = await client.delete(f"/api/boards/{board_id}/members/{owner_id}")
    assert resp.status_code == 403
