import os
import sys
import stat
import pytest
from app.agents.cli_agent import GenericCLIAgent, _clean_terminal


def _write_probe(dirpath: str) -> str:
    """写一个探测 isatty 的 fake CLI，并输出一段带 ANSI 控制序列的文本。"""
    script = os.path.join(dirpath, "probe.py")
    with open(script, "w", encoding="utf-8") as f:
        f.write(
            "#!/usr/bin/env python3\n"
            "import sys\n"
            "print('TTY' if sys.stdout.isatty() else 'PIPE')\n"
            # 带颜色 + 擦除 + \\r 原地刷新，用于验证清洗
            "sys.stdout.write('\\x1b[31mRED\\x1b[0m\\x1b[2Kx\\rDONE\\n')\n"
            "sys.stdout.flush()\n"
        )
    os.chmod(script, os.stat(script).st_mode | stat.S_IEXEC | stat.S_IRWXU)
    return script


def _make_agent(tmp_path, use_pty: bool) -> GenericCLIAgent:
    script = _write_probe(str(tmp_path))
    return GenericCLIAgent(
        name="probe",
        cli_binary=sys.executable,   # 用当前 python 解释器跑脚本，避免依赖 PATH
        args_template=script,        # 无占位符，直接把脚本作为唯一参数
        workspace_dir=str(tmp_path),
        timeout=30,
        heartbeat_interval=5,
        strip_ansi=True,
        use_pty=use_pty,
    )


def test_clean_terminal_strips_control_sequences():
    raw = "\x1b[31mRED\x1b[0m\x1b[2Kmid\rEND\r\nnext"
    cleaned = _clean_terminal(raw)
    assert "\x1b" not in cleaned
    assert "\r" not in cleaned
    assert "RED" in cleaned and "END" in cleaned and "next" in cleaned


def test_clean_terminal_strips_c0_controls_but_keeps_newline_tab():
    raw = "a\x08b\x07c\x00d\ttab\nline"
    cleaned = _clean_terminal(raw)
    # 退格/响铃/空字符等被剥离
    assert all(ch not in cleaned for ch in "\x08\x07\x00")
    # 可见的 \n 与 \t 保留
    assert "\t" in cleaned and "\n" in cleaned
    assert "abcd" in cleaned


@pytest.mark.asyncio
async def test_pty_mode_sees_a_tty(tmp_path):
    agent = _make_agent(tmp_path, use_pty=True)
    result = await agent.execute({"name": "t", "description": "d"})
    assert result.success is True
    # PTY 下子进程认为自己在终端里
    assert "TTY" in result.stdout
    # 控制序列已被清洗
    assert "\x1b" not in result.stdout
    assert "DONE" in result.stdout


@pytest.mark.asyncio
async def test_pipe_mode_is_not_a_tty(tmp_path):
    agent = _make_agent(tmp_path, use_pty=False)
    result = await agent.execute({"name": "t", "description": "d"})
    assert result.success is True
    # 管道模式（现有路径）不回归：子进程看到的是非 TTY
    assert "PIPE" in result.stdout
