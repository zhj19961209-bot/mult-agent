# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A multi-agent collaboration platform. The frontend submits task requests; the backend schedules
AI CLI tools (Codex / Claude / DeepSeek) and sandboxed terminal commands to execute them, streaming
progress back over WebSocket. Two independent projects live side by side:

- `mult-agent-backend/` — Python 3.11+ / FastAPI / SQLAlchemy async / SQLite
- `mult-agent-frontend/` — React 19 / TypeScript / Vite / Tailwind

Neither directory is a git repository. The repo root also holds a self-triage automation
(`LOOP.md`, `STATE.md`, `loop-*.md`) — see "Loop automation" below.

## Commands

### Backend (`mult-agent-backend/`)
```bash
pip install -r requirements.txt
uvicorn app.main:app --reload          # serves on :8000; docs at /docs, health at /health
pytest tests/ -v                       # all tests (asyncio_mode=auto, no decorator needed)
pytest tests/test_scheduler.py -v      # single file
pytest tests/test_scheduler.py::test_name -v   # single test
```

### Frontend (`mult-agent-frontend/`)
```bash
npm run dev        # Vite dev server (expects backend at http://localhost:8000, hardcoded in src/api.ts)
npm run build      # tsc -b && vite build
npm run lint       # eslint
```

## Architecture

### Request-to-execution flow
`POST /task` → `task_service` persists a `Task` row → `scheduler.schedule_task()` spawns an asyncio
background task (tracked in `_active_tasks` for cancellation) → the scheduler picks an execution mode
and drives the agents → results/logs/status persist to SQLite and broadcast over
`/ws/task/{task_id}`. The frontend polls REST and also subscribes to the WebSocket for live logs.

### Execution modes (`app/services/scheduler.py`)
`Task.mode` selects one of three strategies:
- **sequential** — agents run in order; each agent's `summary` is threaded into the next via `chain_context`.
- **parallel** — agents run concurrently with `asyncio.gather`.
- **collaborative** — up to `MAX_COLLAB_ROUNDS` (5) rounds. Agents exchange messages through a
  per-task `MessageBus`. An agent addresses a teammate by emitting a line `@name: message`; the
  scheduler parses these (`_MENTION_RE` / `_dispatch_mentions`) into directed bus messages and treats
  the remaining text as a broadcast. The loop stops early when a round produces zero new messages
  (convergence).

### Agents (`app/agents/`)
All agents implement `BaseAgent.execute(task_context, history, on_progress) -> AgentResult`.
`on_progress` streams incremental stdout (WebSocket push + buffered DB writes). Types:
- `GenericCLIAgent` (`cli_agent.py`) — the workhorse. Runs an external binary via a parameterized
  `args_template` with `{prompt}`, `{prompt_file}`, `{workspace}`, `{model}` placeholders (or
  `stdin_mode` to pipe the prompt). Detects human-in-the-loop approval prompts (`_APPROVAL_PATTERN`)
  and pauses via a `PendingApproval` registry until `POST /task/{id}/approve` resolves it.
- `HTTPAgent`, `MCPAgent`, `TLIAgent` — HTTP endpoints, MCP servers, and the builtin sandboxed
  command executor respectively.

### Agent registry (`app/services/agent_registry.py` + `agents_registry.json`)
Agents are **data, not code**: `agents_registry.json` is the source of truth, seeded from
`DEFAULT_AGENTS` on first run. `get_agent_cls(name)` instantiates the right `BaseAgent` subclass from
a config dict based on its `type` (`cli` / `http` / `mcp` / `builtin`). Adding an agent = adding a
JSON entry (via `POST /agent`), not writing a class. Builtin names: `codex`, `claude`, `depk`, `tli`.

### TLI sandbox (`app/services/tli_executor.py` + `app/config.py`)
The `tli` builtin executes shell commands under a security policy: a command allowlist
(`ALLOWED_COMMANDS`), blocked substring patterns (`BLOCKED_PATTERNS`, e.g. `rm -rf`, `sudo`), and a
directory allowlist (`ALLOWED_DIRECTORIES`). Changes to command safety belong here.

### Knowledge base (`app/services/knowledge_service.py`)
Past task results are mined into `KnowledgeEntry` rows with keyword/category extraction (bilingual
zh/en stopwords + `CATEGORY_RULES`). `build_knowledge_context()` retrieves relevant prior knowledge
and injects it into every agent's `task_context["knowledge"]`. Users up/down-vote entries via
`POST /knowledge/feedback`.

### Data model (`app/models/task.py`)
SQLite via async SQLAlchemy. Core tables: `tasks`, `task_logs`, `task_results`, `knowledge_entries`,
`agent_messages` (collaborative bus persistence). Note: JSON-typed fields (`agents`, `tli_commands`)
are stored as **JSON strings** in `String` columns and must be `json.loads`-ed when read. Timestamps
are ISO strings in Beijing time (`BEIJING_TZ`, UTC+8).

### Frontend (`mult-agent-frontend/src/`)
Single-page app with a hand-rolled view-state union in `App.tsx` (no router). `api.ts` wraps all REST
calls (backend base URL hardcoded to `http://localhost:8000`); `types.ts` mirrors backend schemas.
Live task updates come from the WebSocket, driven by `hooks/usePolling.ts`.

## Conventions

- Comments, docstrings, and user-facing strings are predominantly in Chinese — match the surrounding language.
- Every DB access uses a fresh `async with db_session_factory() as db:` scope; the scheduler passes
  the factory down rather than sharing a session across the background task's lifetime.
- New agents are registered as JSON config, not subclasses, unless you're adding a genuinely new
  transport `type`.

## Loop automation (repo root)

The root `*.md` files (`LOOP.md`, `STATE.md`, `loop-budget.md`, `loop-constraints.md`,
`loop-run-log.md`, `AGENTS.md`) configure a scheduled "daily triage" loop that runs tests/lint and
reports findings. It is currently **L1 report-only** (no auto-fix). Before acting autonomously here,
read `loop-constraints.md` — its rules are binding (e.g. never edit secrets/auth paths, one fix per
run, run tests before proposing fixes, no auto-merge). Append a run entry to `loop-run-log.md` and
update `STATE.md` after a triage run.
