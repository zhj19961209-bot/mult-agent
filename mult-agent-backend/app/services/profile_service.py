import asyncio
import json
import re
from pathlib import Path
from app.config import BASE_DIR, CLI_TIMEOUT, CLI_WORK_DIR

PROFILE_DIR = BASE_DIR / "profile"
USER_FILE = PROFILE_DIR / "user.md"
SOUL_FILE = PROFILE_DIR / "soul.md"

EXTRACTION_PROMPT = """从以下对话中提取用户个人信息。只提取用户明确陈述的事实，不要推测。

请判断每条信息属于 user 还是 soul 类别：
- user: 客观信息（姓名、称呼、年龄、职业、所在地、技术栈、公司等）
- soul: 主观偏好（风格喜好、工作习惯、价值观、喜欢/不喜欢的事物等）

以 JSON 数组格式返回，每条格式：
{{"category": "user"|"soul", "fact": "明确的事实描述"}}

如果没有可提取的新信息，返回空数组 []。

对话内容：
{conversation}

只输出 JSON，不要其他文字。"""

def load_profile() -> str:
    """读取 user.md 和 soul.md，拼接为 prompt 前缀。空文件返回空字符串。"""
    parts = []
    if USER_FILE.exists():
        content = USER_FILE.read_text("utf-8").strip()
        # Skip empty template
        if content and "（对话中发现的" not in content:
            parts.append(f"[用户档案]\n{content}")
    if SOUL_FILE.exists():
        content = SOUL_FILE.read_text("utf-8").strip()
        if content and "（对话中发现的" not in content:
            parts.append(f"[用户偏好]\n{content}")
    return "\n\n".join(parts) if parts else ""

def _append_facts(category: str, facts: list[str]):
    filepath = USER_FILE if category == "user" else SOUL_FILE
    current = filepath.read_text("utf-8").strip() if filepath.exists() else ""
    # Remove placeholder line if present
    current = re.sub(r"（[^）]*）\n?", "", current)
    new_lines = [f"- {f}" for f in facts]
    if current:
        # Check if fact already exists
        existing = current
        for line in new_lines:
            if line not in existing:
                existing += f"\n{line}"
        content = existing
    else:
        content = "\n".join(new_lines)
    filepath.write_text(content + "\n", "utf-8")

async def extract_and_update(conversation: str):
    """异步提取用户画像并追加到 md 文件。"""
    prompt = EXTRACTION_PROMPT.format(conversation=conversation[:4000])
    try:
        proc = await asyncio.create_subprocess_exec(
            "claude", "-p", prompt, "--bare",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=CLI_WORK_DIR,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=CLI_TIMEOUT)
        output = stdout.decode("utf-8", errors="replace").strip()

        # Extract JSON array from output
        match = re.search(r"\[.*\]", output, re.DOTALL)
        if match:
            items = json.loads(match.group(0))
            for item in items:
                cat = item.get("category", "user")
                fact = item.get("fact", "")
                if fact and cat in ("user", "soul"):
                    _append_facts(cat, [fact])
    except Exception:
        pass  # extraction is best-effort
