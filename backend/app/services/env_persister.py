"""P1: ima 凭据持久化到 .env 文件。

之前只改内存 settings，重启即失效。这里把 IMA_API_KEY 和 IMA_CLIENT_ID
写回服务器 .env 文件，保证重启后保留。

PRD §3.3.3: 凭据管理应存 .env，不入 Git，不写日志，不回前端。
"""
import os
import re
from pathlib import Path


_ENV_PATH = os.environ.get("AGENTCUT_ENV_PATH", "/opt/agentcut-v2/backend/.env")


def _escape(value: str) -> str:
    """转义 .env 特殊字符：保留单引号内字面值，原文带 + 等号不需要特殊处理。"""
    # 如果包含 #、空格、$、'、"，用单引号包裹
    if any(c in value for c in [" ", "#", "$", '"', "'"]):
        # 单引号包裹时内部单引号转义为 '\''
        escaped = value.replace("'", "'\\''")
        return f"'{escaped}'"
    return value


def update_env_value(key: str, value: str, env_path: str | None = None) -> bool:
    """更新 .env 文件中的某个 key。value 为空字符串则删除该行。"""
    path = Path(env_path or _ENV_PATH)
    if not path.exists():
        return False

    content = path.read_text(encoding="utf-8")
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)

    if value == "" or value is None:
        # 删除该行
        new_content = pattern.sub("", content).rstrip() + "\n"
    else:
        new_line = f"{key}={_escape(value)}\n"
        if pattern.search(content):
            new_content = pattern.sub(lambda m: new_line.rstrip(), content)
        else:
            new_content = content.rstrip() + "\n" + new_line

    path.write_text(new_content, encoding="utf-8")
    return True


def get_env_path() -> str:
    return _ENV_PATH