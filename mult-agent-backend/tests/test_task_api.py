import pytest
import time

@pytest.mark.asyncio
async def test_health(client):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

@pytest.mark.asyncio
async def test_create_task(client):
    resp = await client.post("/task", json={
        "name": "集成测试任务",
        "description": "验证创建流程",
        "mode": "parallel",
        "agents": ["codex", "claude"],
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "集成测试任务"
    assert data["status"] in ("pending", "running")
    assert data["mode"] == "parallel"
    assert "task_id" in data

@pytest.mark.asyncio
async def test_list_tasks(client):
    # Create two tasks
    await client.post("/task", json={"name": "任务A", "mode": "sequential", "agents": ["codex"]})
    await client.post("/task", json={"name": "任务B", "mode": "parallel", "agents": ["claude"]})
    resp = await client.get("/task")
    assert resp.status_code == 200
    tasks = resp.json()
    assert len(tasks) >= 2

@pytest.mark.asyncio
async def test_get_task_detail(client):
    create_resp = await client.post("/task", json={
        "name": "查询测试",
        "mode": "sequential",
        "agents": ["tli"],
        "tli_commands": ["echo test"],
    })
    task_id = create_resp.json()["task_id"]

    # Wait a moment for task to complete
    await client.get(f"/task/{task_id}")

    resp = await client.get(f"/task/{task_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "查询测试"
    assert "logs" in data
    assert "results" in data

@pytest.mark.asyncio
async def test_agent_status(client):
    resp = await client.get("/agent/status")
    assert resp.status_code == 200
    data = resp.json()
    assert "agents" in data
    assert len(data["agents"]) == 3
    names = [a["name"] for a in data["agents"]]
    assert "codex" in names
    assert "claude" in names
    assert "tli" in names

@pytest.mark.asyncio
async def test_cancel_task(client):
    create_resp = await client.post("/task", json={
        "name": "取消测试",
        "mode": "sequential",
        "agents": ["tli"],
        "tli_commands": ["sleep 10"],
    })
    task_id = create_resp.json()["task_id"]

    resp = await client.post(f"/task/{task_id}/cancel")
    assert resp.status_code == 200
    assert "已取消" in resp.json()["message"]
