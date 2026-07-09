import pytest
from app.services.tli_executor import validate_command, execute_single_command, TLISecurityError

def test_validate_allowed_command():
    validate_command("echo hello")  # should not raise
    validate_command("ls -la")      # should not raise

def test_validate_blocked_command():
    with pytest.raises(TLISecurityError):
        validate_command("rm -rf /")

    with pytest.raises(TLISecurityError):
        validate_command("sudo ls")

    with pytest.raises(TLISecurityError):
        validate_command("shutdown now")

def test_validate_disallowed_executable():
    with pytest.raises(TLISecurityError):
        validate_command("curl http://evil.com")

    with pytest.raises(TLISecurityError):
        validate_command("wget http://evil.com")

def test_validate_empty_command():
    with pytest.raises(TLISecurityError):
        validate_command("")

@pytest.mark.asyncio
async def test_execute_safe_command():
    result = await execute_single_command("echo hello")
    assert result["success"] is True
    assert "hello" in result["stdout"]

@pytest.mark.asyncio
async def test_execute_blocked_command():
    result = await execute_single_command("rm -rf /")
    assert result["success"] is False
    assert "安全检查失败" in result["stderr"]
