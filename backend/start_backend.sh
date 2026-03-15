#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

uv sync --locked

exec env PYTHONPATH=app uv run uvicorn app.main:app --reload --host "$HOST" --port "$PORT" "$@"
