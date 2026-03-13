"""Persistent trace files for canvas interpreter reasoning runs."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TRACE_DIRECTORY = (
    Path(__file__).resolve().parents[2] / "debug_traces" / "interpreter_reasoning"
)


def now_iso() -> str:
    """Return a UTC ISO timestamp for trace events."""

    return datetime.now(timezone.utc).isoformat()


def summarize_reasoning_input(
    *,
    packet: dict[str, object] | None,
    canvas_context: dict[str, object] | None,
) -> dict[str, object]:
    """Return a compact summary of the reasoning inputs for debugging."""

    packet_canvas_window = packet.get("canvas_window") if isinstance(packet, dict) else None
    aggregate_counts = (
        packet_canvas_window.get("aggregate_counts")
        if isinstance(packet_canvas_window, dict)
        else None
    )
    screenshot_data_url = (
        canvas_context.get("screenshot_data_url")
        if isinstance(canvas_context, dict)
        else None
    )

    return {
        "packet_window_id": (
            packet_canvas_window.get("id")
            if isinstance(packet_canvas_window, dict)
            else None
        ),
        "packet_trigger_source": (
            packet.get("trigger", {}).get("source")
            if isinstance(packet, dict) and isinstance(packet.get("trigger"), dict)
            else None
        ),
        "packet_recent_raw_turn_count": (
            packet.get("session_compaction", {}).get("raw_turn_count")
            if isinstance(packet, dict)
            and isinstance(packet.get("session_compaction"), dict)
            else None
        ),
        "canvas_event_count": (
            aggregate_counts.get("total_events")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "user_change_count": (
            aggregate_counts.get("user_changes")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "agent_change_count": (
            aggregate_counts.get("agent_changes")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "screenshot_included": isinstance(screenshot_data_url, str)
        and bool(screenshot_data_url),
        "screenshot_char_count": (
            len(screenshot_data_url) if isinstance(screenshot_data_url, str) else 0
        ),
        "canvas_context_without_screenshot": {
            key: value
            for key, value in canvas_context.items()
            if key != "screenshot_data_url"
        }
        if isinstance(canvas_context, dict)
        else None,
    }


def summarize_activity_window(packet: dict[str, object] | None) -> dict[str, object] | None:
    """Return a compact summary of the triggering activity window."""

    if not isinstance(packet, dict):
        return None

    canvas_window = packet.get("canvas_window")
    if not isinstance(canvas_window, dict):
        return None

    aggregate_counts = canvas_window.get("aggregate_counts")
    actor_counts = canvas_window.get("actor_counts")
    changed_shape_ids = canvas_window.get("changed_shape_ids")

    return {
        "id": canvas_window.get("id"),
        "close_reason": canvas_window.get("close_reason"),
        "started_at": canvas_window.get("started_at"),
        "closed_at": canvas_window.get("closed_at"),
        "event_count": (
            aggregate_counts.get("total_events")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "create_count": (
            aggregate_counts.get("create_count")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "update_count": (
            aggregate_counts.get("update_count")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "delete_count": (
            aggregate_counts.get("delete_count")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "user_changes": (
            aggregate_counts.get("user_changes")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "agent_changes": (
            aggregate_counts.get("agent_changes")
            if isinstance(aggregate_counts, dict)
            else None
        ),
        "changed_shape_count": (
            len(changed_shape_ids) if isinstance(changed_shape_ids, list) else 0
        ),
        "actor_counts": actor_counts if isinstance(actor_counts, dict) else None,
    }


def summarize_compacted_context(packet: dict[str, object] | None) -> dict[str, object] | None:
    """Return a compact summary of the compacted session context."""

    if not isinstance(packet, dict):
        return None

    compacted_context = packet.get("session_compaction")
    if not isinstance(compacted_context, dict):
        return None

    summary_text = compacted_context.get("summary_text")
    recent_raw_turns = compacted_context.get("recent_raw_turns")

    return {
        "topic": compacted_context.get("topic"),
        "goal": compacted_context.get("goal"),
        "summary_present": isinstance(summary_text, str) and bool(summary_text.strip()),
        "summary_text": summary_text if isinstance(summary_text, str) else None,
        "raw_turn_count": compacted_context.get("raw_turn_count"),
        "compacted_through_sequence": compacted_context.get(
            "compacted_through_sequence"
        ),
        "latest_turn_sequence": compacted_context.get("latest_turn_sequence"),
        "total_finalized_turn_count": compacted_context.get("total_finalized_turn_count"),
        "recent_raw_turn_count": (
            len(recent_raw_turns) if isinstance(recent_raw_turns, list) else 0
        ),
    }


def summarize_snapshot_reference(
    canvas_context: dict[str, object] | None,
) -> dict[str, object] | None:
    """Return a compact summary of the visual grounding reference."""

    if not isinstance(canvas_context, dict):
        return None

    screenshot_data_url = canvas_context.get("screenshot_data_url")

    return {
        "captured_at": canvas_context.get("captured_at"),
        "user_viewport_bounds": canvas_context.get("user_viewport_bounds"),
        "agent_viewport_bounds": canvas_context.get("agent_viewport_bounds"),
        "selected_shape_ids": canvas_context.get("selected_shape_ids"),
        "screenshot_included": isinstance(screenshot_data_url, str)
        and bool(screenshot_data_url),
        "screenshot_char_count": (
            len(screenshot_data_url) if isinstance(screenshot_data_url, str) else 0
        ),
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


def write_interpreter_reasoning_trace(run_id: str, trace: dict[str, object]) -> Path:
    """Write the trace file for a single interpreter reasoning run."""

    TRACE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    trace_path = TRACE_DIRECTORY / f"{run_id}.json"
    trace_payload = dict(trace)
    trace_payload["trace_file"] = str(trace_path)
    with trace_path.open("w", encoding="utf-8") as file_obj:
        json.dump(_sanitize_for_json(trace_payload), file_obj, indent=2, ensure_ascii=True)
        file_obj.write("\n")
    return trace_path


def update_interpreter_reasoning_trace(
    trace_file: str | Path,
    updates: dict[str, object],
) -> Path:
    """Patch an existing interpreter reasoning trace with delivery metadata."""

    trace_path = Path(trace_file)
    if not trace_path.exists():
        raise FileNotFoundError(trace_path)

    with trace_path.open("r", encoding="utf-8") as file_obj:
        payload = json.load(file_obj)

    payload.update(_sanitize_for_json(updates))
    payload["trace_file"] = str(trace_path)

    with trace_path.open("w", encoding="utf-8") as file_obj:
        json.dump(payload, file_obj, indent=2, ensure_ascii=True)
        file_obj.write("\n")

    return trace_path
