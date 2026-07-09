# 多 Agent 协作平台

一个多 Agent 协作平台：前端提交任务 → 后端调度多个 AI CLI 工具（Codex / Claude / DeepSeek）与沙箱化终端命令去执行 → 通过 WebSocket 把进度实时流式返回。多个 Agent 可以**顺序、并行或协作**完成同一个任务，协作模式下它们通过消息总线互相 @ 对话、多轮讨论直至收敛。

## 架构

仓库里并列着两个独立子项目：

| 目录 | 技术栈 |
|------|--------|
| `mult-agent-backend/` | Python 3.11+ / FastAPI / SQLAlchemy (async) / SQLite |
| `mult-agent-frontend/` | React 19 / TypeScript / Vite / Tailwind |

**请求到执行的链路：**

```
POST /task → 持久化 Task 行 → scheduler 起一个 asyncio 后台任务
  → 按 mode 选择执行策略，驱动各 Agent
  → 结果/日志/状态写入 SQLite，并通过 /ws/task/{id} 广播
前端订阅 WebSocket 看实时日志，同时轮询 REST 拿最新状态
```

## 快速开始

### 后端（默认 :8000）

```bash
cd mult-agent-backend
pip install -r requirements.txt
uvicorn app.main:app --reload
```

- Swagger 文档：http://127.0.0.1:8000/docs
- 健康检查：http://127.0.0.1:8000/health

被调度的 AI CLI（`codex` / `claude` / `depk`）需要预先安装并在 `PATH` 中，且各自完成登录 / API Key 配置。

### 前端（Vite dev server :5173）

```bash
cd mult-agent-frontend
npm install
npm run dev        # 开发；npm run build 构建；npm run lint 检查
```

> **端口说明**：后端地址硬编码在前端 `src/api.ts`（REST）和 `src/components/TaskDetail.tsx`（WebSocket）。默认应指向后端所在端口，若本机 8000 被占用而后端改了端口，需同步改这两处。

## 执行模式

`Task.mode` 决定调度策略（`app/services/scheduler.py`）：

- **sequential** — Agent 依次执行，前一个的 `summary` 通过 `chain_context` 传给下一个。
- **parallel** — 多个 Agent 用 `asyncio.gather` 并发执行。
- **collaborative** — 最多 `MAX_COLLAB_ROUNDS`（5）轮。Agent 通过**消息总线**（`MessageBus`）交换消息：单独成行写 `@队友名: 内容` 即为**定向私聊**（中英文冒号、行首列表/引用符号都识别），其余文本作为**广播**。发给某 Agent 的定向问题会被单独放进它下一轮上下文的 `[待回复]` 区，提示其优先应答。某一轮无新消息即提前收敛。

## Agent 体系

Agent 是**数据而非代码**：`agents_registry.json` 是唯一事实来源，首次运行从 `DEFAULT_AGENTS` 播种。新增一个 Agent = 加一条 JSON（或 `POST /agent`），而不是写类。

按 `type` 区分实现（都实现 `BaseAgent.execute`）：

- **cli**（`GenericCLIAgent`）— 主力。用参数化 `args_template`（占位符 `{prompt}` / `{prompt_file}` / `{workspace}` / `{model}`，或 `stdin_mode` 管道喂入）调用外部二进制。支持 `use_pty`：为交互式 CLI 分配伪终端（如 `depk`，非 TTY 下不正常输出时需要）。能检测人工审批提示（human-in-the-loop）并暂停，等 `POST /task/{id}/approve` 放行。
- **http** / **mcp** — HTTP 端点、MCP server。
- **builtin** — 目前是 `tli`，内置沙箱命令执行器。

内置 Agent：`codex`、`claude`、`depk`、`tli`。

## 安全：TLI 沙箱

`tli` 在安全策略下执行 shell 命令（`app/config.py` + `app/services/tli_executor.py`）：命令白名单 `ALLOWED_COMMANDS`、危险模式黑名单 `BLOCKED_PATTERNS`（如 `rm -rf`、`sudo`）、目录白名单 `ALLOWED_DIRECTORIES`。命令安全相关的改动都应放在这里。

## 知识库

历史任务结果会被挖掘成 `KnowledgeEntry`（双语关键词 + 分类）。`build_knowledge_context()` 检索相关先验知识并注入到每个 Agent 的 `task_context["knowledge"]`。用户通过 `POST /knowledge/feedback` 对条目点赞 / 点踩。

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/task` | 创建任务 |
| GET | `/task` | 任务列表（支持 `?status=`） |
| GET | `/task/{id}` | 任务详情（含日志、结果） |
| GET | `/task/{id}/messages` | 协作消息记录 |
| POST | `/task/{id}/cancel` / `/retry` / `/approve` / `/continue` | 取消 / 重试 / 审批 / 追问 |
| WS | `/ws/task/{id}` | 实时日志与消息推送 |
| GET/POST/DELETE | `/agent` … | Agent 增删查、启停、工具发现 |
| GET | `/knowledge`，POST `/knowledge/feedback` | 知识库 |

**创建任务请求体：**

```json
{
  "name": "任务名称",
  "description": "任务描述",
  "mode": "collaborative",
  "agents": ["claude", "depk"],
  "tli_commands": []
}
```

## 测试

```bash
cd mult-agent-backend
pytest tests/ -v                              # 全部
pytest tests/test_cli_agent.py -v             # 单个文件
pytest tests/test_cli_agent.py::test_name -v  # 单个用例
```

`pytest.ini` 已开 `asyncio_mode = auto`，异步用例无需装饰器。

## 数据模型说明

SQLite（async SQLAlchemy）。核心表：`tasks`、`task_logs`、`task_results`、`knowledge_entries`、`agent_messages`。注意：JSON 型字段（`agents`、`tli_commands`）以 **JSON 字符串**存在 `String` 列里，读出后需 `json.loads`。时间戳为北京时间（UTC+8）ISO 字符串。
