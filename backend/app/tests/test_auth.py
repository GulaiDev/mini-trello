"""骨架与鉴权测试。"""

from __future__ import annotations


async def test_health(client):
    resp = await client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_openapi_contains_health(client):
    resp = await client.get("/openapi.json")
    assert resp.status_code == 200
    schema = resp.json()
    assert "/api/health" in schema["paths"]


async def test_register_sets_httponly_cookie(client):
    resp = await client.post(
        "/api/auth/register",
        json={
            "email": "alice@example.com",
            "password": "password123",
            "display_name": "Alice",
        },
    )
    assert resp.status_code == 201, resp.text
    set_cookie = resp.headers.get_list("set-cookie")
    joined = "; ".join(set_cookie)
    assert "access_token=" in joined
    assert "HttpOnly" in joined or "httponly" in joined
    # refresh cookie 的 Path 收窄
    refresh_cookie = [c for c in set_cookie if c.startswith("refresh_token=")]
    assert refresh_cookie and "Path=/api/auth/refresh" in refresh_cookie[0]


async def test_me_requires_auth(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401
    assert resp.headers.get("WWW-Authenticate") == "Bearer"
    assert resp.json()["detail"]["code"] == "unauthorized"


async def test_login_and_me(client):
    await client.post(
        "/api/auth/register",
        json={
            "email": "bob@example.com",
            "password": "password123",
            "display_name": "Bob",
        },
    )
    # 注册后已登录
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "bob@example.com"


async def test_login_wrong_password(client):
    await client.post(
        "/api/auth/register",
        json={
            "email": "carol@example.com",
            "password": "password123",
            "display_name": "Carol",
        },
    )
    client.cookies.clear()
    resp = await client.post(
        "/api/auth/login",
        json={"email": "carol@example.com", "password": "wrong-password"},
    )
    assert resp.status_code == 401


async def test_refresh_rotation_invalidates_old(client):
    await client.post(
        "/api/auth/register",
        json={
            "email": "dave@example.com",
            "password": "password123",
            "display_name": "Dave",
        },
    )
    old_refresh = client.cookies.get("refresh_token")
    assert old_refresh

    # 第一次刷新成功
    r1 = await client.post("/api/auth/refresh")
    assert r1.status_code == 200, r1.text
    new_refresh = r1.cookies.get("refresh_token")
    assert new_refresh and new_refresh != old_refresh

    # 用旧 refresh 重放应失败
    client.cookies.set("refresh_token", old_refresh)
    r2 = await client.post("/api/auth/refresh")
    assert r2.status_code == 401


async def test_logout_then_unauthorized(client):
    await client.post(
        "/api/auth/register",
        json={
            "email": "erin@example.com",
            "password": "password123",
            "display_name": "Erin",
        },
    )
    out = await client.post("/api/auth/logout")
    assert out.status_code == 204
    client.cookies.clear()
    me = await client.get("/api/auth/me")
    assert me.status_code == 401


async def test_csrf_header_required(client):
    """状态变更请求缺少 X-Requested-With 应被拒绝（豁免路径除外）。"""
    await client.post(
        "/api/auth/register",
        json={
            "email": "frank@example.com",
            "password": "password123",
            "display_name": "Frank",
        },
    )
    # 移除 CSRF 头后创建看板应 403
    headers = {k: v for k, v in client.headers.items() if k.lower() != "x-requested-with"}
    resp = await client.post(
        "/api/boards",
        json={"title": "无 CSRF 头"},
        headers=headers,
    )
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "csrf"
