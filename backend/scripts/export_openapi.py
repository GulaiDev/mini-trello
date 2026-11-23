"""导出 OpenAPI 契约。

用途：
- 本地重新生成 ``backend/openapi.json``：``python scripts/export_openapi.py``
- CI 漂移检查：``python scripts/export_openapi.py --stdout`` 后与提交版本比对。

不依赖数据库/网络——仅导入应用并调用 ``app.openapi()``，因此可在无 DB 的环境执行。
输出使用稳定的排序与缩进，保证逐次生成结果可比较。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# 允许以 `python scripts/export_openapi.py` 直接运行时导入 app 包
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402


def render() -> str:
    schema = app.openapi()
    return json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    text = render()
    if "--stdout" in argv:
        sys.stdout.write(text)
        return 0
    out_path = Path(__file__).resolve().parents[1] / "openapi.json"
    # 强制 LF，保证 Windows 生成与 CI(Linux) 逐字节一致
    out_path.write_text(text, encoding="utf-8", newline="\n")
    print(f"已写入 {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
