# 多 Agent 协作平台

接收前端任务请求 → 调度 Codex/Claude 执行 → 返回结果。

## 快速启动

```bash
pip install -r requirements.txt
uvicorn app.main:app --reload
```

启动后访问：
- Swagger 文档: http://127.0.0.1:8000/docs
- 健康检查: http://127.0.0.1:8000/health

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /task | 创建任务 |
| GET | /task | 任务列表（支持 ?status=pending） |
| GET | /task/{task_id} | 任务详情（含日志和结果） |
| POST | /task/{task_id}/cancel | 取消任务 |
| GET | /agent/status | Agent 在线状态 |

### 创建任务请求体

```json
{
  "name": "任务名称",
  "description": "任务描述",
  "mode": "parallel",
  "agents": ["codex", "claude"],
  "tli_commands": []
}
```

- `mode`: `sequential`（顺序执行）/ `parallel`（并行执行）
- `agents`: 可选 `codex`, `claude`, `tli`
- `tli_commands`: TLI 模式下待执行的命令列表

## 项目结构

```
app/
├── main.py            # FastAPI 入口
├── config.py          # 配置
├── database/setup.py  # 数据库初始化
├── models/task.py     # 数据模型
├── schemas/           # Pydantic 请求/响应
├── api/               # REST 路由
├── services/          # 业务逻辑（调度器 + TLI 执行器）
└── agents/            # Agent 抽象 + 具体实现
tests/                 # 测试
```

## 运行测试

```bash
pytest tests/ -v
```

## 技术栈

- Python 3.11+ / FastAPI / SQLAlchemy (async) / SQLite
- asyncio 异步并发调度
