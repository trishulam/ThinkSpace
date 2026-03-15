"""Canvas widget tools for the ThinkSpace agent."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Literal
from uuid import uuid4

from google.adk.tools import LongRunningFunctionTool, ToolContext

from thinkspace_agent.widgets.models import WidgetKind

from .canvas_context_requests import canvas_context_request_store
from .canvas_widget_jobs import (
    generate_canvas_widget_artifact,
    publish_canvas_widget_job_result,
)
from .canvas_widget_trace import now_iso, summarize_context, write_generate_widget_trace

logger = logging.getLogger(__name__)

CANVAS_GENERATE_GRAPH_TOOL = "canvas.generate_graph"
CANVAS_GENERATE_NOTATION_TOOL = "canvas.generate_notation"
CANVAS_CONTEXT_REQUESTED_ACTION = "canvas.context_requested"
CANVAS_INSERT_WIDGET_ACTION = "canvas.insert_widget"
CANVAS_CONTEXT_REQUEST_TIMEOUT_S = 10.0
SUPPORTED_PLACEMENT_HINTS = (
    "auto",
    "viewport_right",
    "viewport_left",
    "viewport_top",
    "viewport_bottom",
)
PlacementHint = Literal[
    "auto",
    "viewport_right",
    "viewport_left",
    "viewport_top",
    "viewport_bottom",
]


def _build_frontend_action(
    action_type: str,
    source_tool: str,
    payload: object,
    *,
    job_id: str | None = None,
) -> dict[str, object]:
    action: dict[str, object] = {
        "type": action_type,
        "source_tool": source_tool,
        "payload": payload,
    }
    if job_id:
        action["job_id"] = job_id
    return action


def _build_tool_result(
    *,
    status: str,
    tool: str,
    summary: str,
    payload: object | None = None,
    frontend_action: dict[str, object] | None = None,
    job_id: str | None = None,
) -> dict[str, object]:
    result: dict[str, object] = {
        "status": status,
        "tool": tool,
        "summary": summary,
    }
    if payload is not None:
        result["payload"] = payload
    if frontend_action is not None:
        result["frontend_action"] = frontend_action
    if job_id is not None:
        result["job"] = {"id": job_id}
    return result


def _get_session_identity(
    tool_context: ToolContext | None,
) -> tuple[str | None, str | None]:
    session = tool_context.session if tool_context else None
    user_id = tool_context.user_id if tool_context else None
    session_id = session.id if session else None
    return user_id, session_id


def _get_context_request_message(widget_kind: WidgetKind) -> dict[str, str]:
    if widget_kind == "graph":
        return {
            "title": "Creating graph",
            "message": "Capturing the latest canvas context before plotting the graph",
        }
    return {
        "title": "Creating notation",
        "message": "Capturing the latest canvas context before rendering the notation card",
    }


async def _run_canvas_widget_job(
    *,
    user_id: str,
    session_id: str,
    job_id: str,
    tool_name: str,
    widget_kind: WidgetKind,
    prompt: str,
    placement_hint: str,
) -> None:
    job_started_perf = time.perf_counter()
    trace: dict[str, object] = {
        "job_id": job_id,
        "tool": tool_name,
        "widget_kind": widget_kind,
        "started_at": now_iso(),
        "status": "running",
        "inputs": {
            "prompt": prompt,
            "placement_hint": placement_hint,
        },
        "context_summary": None,
        "context_wait": None,
        "artifact_generation": None,
        "placement_planner": None,
        "reasoner": None,
        "final_result": None,
        "errors": None,
    }
    try:
        context_wait_started_perf = time.perf_counter()
        context_request_started_at = now_iso()
        trace["context_request_started_at"] = context_request_started_at
        placement_context = await canvas_context_request_store.wait_for_response(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            timeout_s=CANVAS_CONTEXT_REQUEST_TIMEOUT_S,
        )
        context_response_received_at = now_iso()
        trace["context_response_received_at"] = context_response_received_at
        trace["context_wait"] = {
            "started_at": context_request_started_at,
            "completed_at": context_response_received_at,
            "duration_ms": max(
                0, int((time.perf_counter() - context_wait_started_perf) * 1000)
            ),
        }
        context_summary = summarize_context(placement_context) or {}
        context_summary["request_started_at"] = context_request_started_at
        context_summary["response_received_at"] = context_response_received_at
        captured_at = context_summary.get("captured_at")
        if isinstance(captured_at, str):
            try:
                captured_dt = datetime.fromisoformat(
                    captured_at.replace("Z", "+00:00")
                )
                response_dt = datetime.fromisoformat(context_response_received_at)
                context_summary["context_age_ms_at_response"] = max(
                    0,
                    int((response_dt - captured_dt).total_seconds() * 1000),
                )
            except Exception:  # pragma: no cover
                pass
        trace["context_summary"] = context_summary

        artifact_payload = await generate_canvas_widget_artifact(
            widget_kind=widget_kind,
            prompt=prompt,
            placement_hint=placement_hint,
            placement_context=placement_context,
        )
        trace["artifact_generation"] = artifact_payload.get("artifact_timing")
        trace["placement_planner"] = artifact_payload.get("planner_trace")
        trace["reasoner"] = artifact_payload.get("reasoner_trace")
        result = _build_tool_result(
            status="completed",
            tool=tool_name,
            summary=(
                "Generated the requested widget and prepared it for canvas insertion. "
                "Once it is visible, explain what the widget shows and how it "
                "supports the current topic. Do not ask a new question or start a "
                "new topic."
            ),
            payload={
                "artifact_id": artifact_payload["artifact_id"],
                "widget_kind": artifact_payload["widget_kind"],
                "title": artifact_payload["title"],
                "placement": {
                    "x": artifact_payload["x"],
                    "y": artifact_payload["y"],
                    "w": artifact_payload.get("w"),
                    "h": artifact_payload.get("h"),
                },
                "planner_trace": artifact_payload.get("planner_trace"),
            },
            frontend_action=_build_frontend_action(
                CANVAS_INSERT_WIDGET_ACTION,
                tool_name,
                payload=artifact_payload,
                job_id=job_id,
            ),
            job_id=job_id,
        )
        trace["status"] = "completed"
        trace["final_result"] = {
            "artifact_id": artifact_payload["artifact_id"],
            "widget_kind": artifact_payload["widget_kind"],
            "title": artifact_payload["title"],
            "placement": {
                "x": artifact_payload["x"],
                "y": artifact_payload["y"],
                "w": artifact_payload.get("w"),
                "h": artifact_payload.get("h"),
            },
            "frontend_payload_summary": {
                "title": artifact_payload["title"],
                "widget_kind": artifact_payload["widget_kind"],
                "spec_keys": sorted(artifact_payload["spec"].keys()),
            },
        }
    except Exception as exc:  # pragma: no cover - defensive async boundary
        logger.exception(
            "Canvas widget generation failed: user_id=%s session_id=%s job_id=%s tool=%s",
            user_id,
            session_id,
            job_id,
            tool_name,
        )
        trace["status"] = "failed"
        trace["errors"] = {
            "message": str(exc),
            "type": exc.__class__.__name__,
        }
        result = _build_tool_result(
            status="failed",
            tool=tool_name,
            summary=f"Widget generation failed: {exc}",
            job_id=job_id,
        )
    finally:
        trace["completed_at"] = now_iso()
        trace["total_duration_ms"] = max(
            0, int((time.perf_counter() - job_started_perf) * 1000)
        )
        trace_path = write_generate_widget_trace(job_id, trace)
        logger.info("Wrote widget generation trace: %s", trace_path)

    if result.get("payload") is None:
        result["payload"] = {}
    if isinstance(result.get("payload"), dict):
        result["payload"]["trace_file"] = str(trace_path)

    await publish_canvas_widget_job_result(
        user_id=user_id,
        session_id=session_id,
        result=result,
    )


def _start_widget_job(
    *,
    tool_name: str,
    widget_kind: WidgetKind,
    prompt: str,
    placement_hint: str,
    tool_context: ToolContext | None,
) -> dict[str, object]:
    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        return _build_tool_result(
            status="failed",
            tool=tool_name,
            summary="Widget generation requires a non-empty prompt",
        )

    normalized_placement_hint = placement_hint.strip() or "auto"
    if normalized_placement_hint not in SUPPORTED_PLACEMENT_HINTS:
        supported = ", ".join(SUPPORTED_PLACEMENT_HINTS)
        return _build_tool_result(
            status="failed",
            tool=tool_name,
            summary=f"Widget placement_hint must be one of: {supported}",
        )

    job_id = f"widget-{uuid4()}"
    user_id, session_id = _get_session_identity(tool_context)

    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            tool=tool_name,
            summary="Widget generation requires an active session context",
            job_id=job_id,
        )

    canvas_context_request_store.create_request(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
    )
    asyncio.get_running_loop().create_task(
        _run_canvas_widget_job(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            tool_name=tool_name,
            widget_kind=widget_kind,
            prompt=normalized_prompt,
            placement_hint=normalized_placement_hint,
        ),
        name=f"{tool_name.replace('.', '-')}-{job_id}",
    )

    return _build_tool_result(
        status="accepted",
        tool=tool_name,
        summary=(
            "Started widget generation. Hold the conversation on the same topic "
            "while the widget is being prepared. Do not ask a new question or "
            "introduce a new topic unless the user asks. Casual small talk is "
            "fine only to avoid dead air."
        ),
        payload={
            "widget_kind": widget_kind,
            "prompt": normalized_prompt,
            "placement_hint": normalized_placement_hint,
        },
        frontend_action=_build_frontend_action(
            CANVAS_CONTEXT_REQUESTED_ACTION,
            tool_name,
            payload=_get_context_request_message(widget_kind),
            job_id=job_id,
        ),
        job_id=job_id,
    )


def canvas_generate_graph(
    prompt: str,
    placement_hint: PlacementHint = "auto",
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Generate a plotted 2D graph widget and insert it into the canvas."""

    return _start_widget_job(
        tool_name=CANVAS_GENERATE_GRAPH_TOOL,
        widget_kind="graph",
        prompt=prompt,
        placement_hint=placement_hint,
        tool_context=tool_context,
    )


def canvas_generate_notation(
    prompt: str,
    placement_hint: PlacementHint = "auto",
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Generate a rendered notation card and insert it into the canvas."""

    return _start_widget_job(
        tool_name=CANVAS_GENERATE_NOTATION_TOOL,
        widget_kind="notation",
        prompt=prompt,
        placement_hint=placement_hint,
        tool_context=tool_context,
    )


def get_canvas_widget_tools() -> list[LongRunningFunctionTool]:
    """Return the canvas widget tools registered for ThinkSpace."""

    return [
        LongRunningFunctionTool(canvas_generate_graph),
        LongRunningFunctionTool(canvas_generate_notation),
    ]
