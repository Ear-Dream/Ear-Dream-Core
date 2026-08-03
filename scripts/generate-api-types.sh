#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> exporting openapi.json from FastAPI"
(cd "$ROOT/packages/ear-dream-api" && uv run python scripts/export_openapi.py)

echo "==> generating TypeScript types into packages/core"
pnpm --filter @ear-dream/core generate

echo "==> done"
