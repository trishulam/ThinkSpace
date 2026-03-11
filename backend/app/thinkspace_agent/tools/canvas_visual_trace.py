"""Persistent trace files for canvas.generate_visual runs."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TRACE_DIRECTORY = (
    Path(__file__).resolve().parents[2] / "debug_traces" / "generate_visual"
)


def now_iso() -> str:
    """Return a UTC ISO timestamp for trace events."""

    return datetime.now(timezone.utc).isoformat()


def summarize_context(context: dict[str, object] | None) -> dict[str, object] | None:
    """Return a compact summary of the placement context for debugging."""

    if not isinstance(context, dict):
        return None

    selected_shape_ids = context.get("selected_shape_ids")
    blurry_shapes = context.get("blurry_shapes")
    peripheral_clusters = context.get("peripheral_clusters")
    canvas_lints = context.get("canvas_lints")
    screenshot_data_url = context.get("screenshot_data_url")

    return {
        "captured_at": context.get("captured_at"),
        "user_viewport_bounds": context.get("user_viewport_bounds"),
        "agent_viewport_bounds": context.get("agent_viewport_bounds"),
        "selected_shape_count": (
            len(selected_shape_ids) if isinstance(selected_shape_ids, list) else 0
        ),
        "selected_shape_ids": (
            selected_shape_ids if isinstance(selected_shape_ids, list) else []
        ),
        "blurry_shape_count": len(blurry_shapes) if isinstance(blurry_shapes, list) else 0,
        "peripheral_cluster_count": (
            len(peripheral_clusters) if isinstance(peripheral_clusters, list) else 0
        ),
        "canvas_lint_count": len(canvas_lints) if isinstance(canvas_lints, list) else 0,
        "screenshot_included": isinstance(screenshot_data_url, str)
        and bool(screenshot_data_url),
        "screenshot_char_count": (
            len(screenshot_data_url) if isinstance(screenshot_data_url, str) else 0
        ),
        "context_without_screenshot": {
            key: value
            for key, value in context.items()
            if key != "screenshot_data_url"
        },
    }


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


def write_generate_visual_trace(job_id: str, trace: dict[str, object]) -> Path:
    """Write the trace file for a single generate-visual run."""

    TRACE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    trace_path = TRACE_DIRECTORY / f"{job_id}.json"
    with trace_path.open("w", encoding="utf-8") as file_obj:
        json.dump(_sanitize_for_json(trace), file_obj, indent=2, ensure_ascii=True)
        file_obj.write("\n")
    return trace_path
