import json
import sys
from pathlib import Path

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from app.main import app


def find_workspace_root(start: Path) -> Path:
    """pnpm-workspace.yaml 이 있는 최초의 상위 디렉토리를 찾는다.

    디렉토리를 옮겨도 깨지지 않도록 깊이(parents[N])에 의존하지 않는다.
    """
    for directory in [start, *start.parents]:
        if (directory / "pnpm-workspace.yaml").exists():
            return directory
    raise RuntimeError("워크스페이스 루트(pnpm-workspace.yaml)를 찾을 수 없습니다")


def main() -> None:
    output_path = find_workspace_root(API_ROOT) / "packages" / "core" / "openapi.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"wrote {output_path}")


if __name__ == "__main__":
    main()
