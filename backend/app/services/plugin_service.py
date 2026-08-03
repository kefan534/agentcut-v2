import os
import sys
import json
import tempfile
import subprocess
import re
from typing import Dict, Any
from fastapi import HTTPException


# WARNING: Python builtins-restriction is NOT a real sandbox.
# For production, run plugin code inside gVisor/Firecracker or a dedicated ephemeral container.
ALLOWED_BUILTINS = {
    "True", "False", "None", "abs", "all", "any", "bool", "bytes", "chr",
    "dict", "divmod", "enumerate", "filter", "float", "format", "frozenset",
    "hasattr", "hash", "hex", "int", "isinstance", "issubclass", "iter",
    "len", "list", "map", "max", "min", "next", "oct", "ord", "pow",
    "range", "repr", "reversed", "round", "set", "slice", "sorted", "str",
    "sum", "tuple", "type", "zip",
}

# Block obvious escape hatches; this is a last-line heuristic, not a guarantee.
_FORBIDDEN_PATTERNS = [
    r"__\s*subclasses__\s*\(",
    r"__\s*globals__\s*",
    r"__\s*import__\s*\(",
    r"import\s+os",
    r"import\s+sys",
    r"import\s+subprocess",
    r"import\s+socket",
    r"import\s+requests",
    r"import\s+urllib",
    r"os\.system",
    r"subprocess\.run",
    r"subprocess\.call",
    r"subprocess\.Popen",
    r"eval\s*\(",
    r"exec\s*\(",
    r"open\s*\(",
    r"compile\s*\(",
]


def _build_runner_script(user_script: str, inputs: Dict[str, Any]) -> str:
    return f'''
import json
import sys
import builtins

_allowed = {sorted(ALLOWED_BUILTINS)}

def _guard(name):
    if name in _allowed:
        return getattr(builtins, name)
    raise NameError(f"{{name}} is not allowed")

_globals = {{"__builtins__": {{name: _guard(name) for name in _allowed}}}}

user_code = """
{user_script}
"""

inputs = json.loads({json.dumps(json.dumps(inputs))})

try:
    exec(user_code, _globals)
    transform = _globals.get("transform")
    if not callable(transform):
        raise ValueError("Plugin must define a transform(inputs) function")
    result = transform(inputs)
    print("__RESULT__" + json.dumps(result, ensure_ascii=False))
except Exception as e:
    print("__ERROR__" + repr(e))
    sys.exit(1)
'''


def _validate_script(user_script: str):
    for pattern in _FORBIDDEN_PATTERNS:
        if re.search(pattern, user_script):
            raise HTTPException(status_code=400, detail=f"Plugin script contains forbidden pattern: {pattern}")


async def execute_plugin(user_script: str, inputs: Dict[str, Any], timeout: int = 10) -> Dict[str, Any]:
    _validate_script(user_script)
    runner = _build_runner_script(user_script, inputs)
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(runner)
        path = f.name

    try:
        proc = subprocess.run(
            [sys.executable, path],
            capture_output=True,
            text=True,
            timeout=timeout,
            env={"PATH": "/usr/bin:/bin"},
        )
        output = proc.stdout.strip()
        if proc.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Plugin error: {proc.stderr or output}")

        for line in reversed(output.splitlines()):
            if line.startswith("__RESULT__"):
                return json.loads(line[len("__RESULT__"):])
            if line.startswith("__ERROR__"):
                raise HTTPException(status_code=500, detail=f"Plugin error: {line[len('__ERROR__'):]}")

        raise HTTPException(status_code=500, detail=f"Plugin did not return result: {output}")
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
