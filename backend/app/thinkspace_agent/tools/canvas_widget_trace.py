"""Persistent trace files for widget-generation runs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .canvas_visual_trace import now_iso, summarize_context

TRACE_DIRECTORY = (
    Path(__file__).resolve().parents[2] / "debug_traces" / "generate_widget"
)


def _sanitize_for_json(value: Any) -> Any:
    """Convert nested values into JSON-serializable forms."""

    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {
            str(key): _sanitize_for_json(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple, set)):
        return [_sanitize_for_json(item) for item in value]
    return str(value)


def write_generate_widget_trace(job_id: str, trace: dict[str, object]) -> Path:
    """Write the trace file for a single generate-widget run."""

    TRACE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    trace_path = TRACE_DIRECTORY / f"{job_id}.json"
    with trace_path.open("w", encoding="utf-8") as file_obj:
        json.dump(_sanitize_for_json(trace), file_obj, indent=2, ensure_ascii=True)
        file_obj.write("\n")
    return trace_path


__all__ = [
    "now_iso",
    "summarize_context",
    "write_generate_widget_trace",
]
