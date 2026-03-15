"""Canvas visual tools for the ThinkSpace agent."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime
from typing import Literal
from uuid import uuid4

from google.adk.tools import LongRunningFunctionTool, ToolContext

from .canvas_context_requests import canvas_context_request_store
from .canvas_visual_trace import now_iso, summarize_context, write_generate_visual_trace
from .canvas_visual_jobs import (
    generate_canvas_visual_artifact,
    publish_canvas_visual_job_result,
)

logger = logging.getLogger(__name__)

CANVAS_GENERATE_VISUAL_TOOL = "canvas.generate_visual"
CANVAS_JOB_STARTED_ACTION = "canvas.job_started"
CANVAS_CONTEXT_REQUESTED_ACTION = "canvas.context_requested"
CANVAS_INSERT_VISUAL_ACTION = "canvas.insert_visual"
CANVAS_CONTEXT_REQUEST_TIMEOUT_S = 10.0
SUPPORTED_ASPECT_RATIO_HINTS = ("1:1", "4:3", "3:4", "16:9", "9:16")
SUPPORTED_GENERATION_MODES = ("quality", "fast")
AspectRatioHint = Literal["1:1", "4:3", "3:4", "16:9", "9:16"]
GenerationMode = Literal["quality", "fast"]


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


async def _run_canvas_visual_job(
    *,
    user_id: str,
    session_id: str,
    job_id: str,
    prompt: str,
    aspect_ratio_hint: str,
    generation_mode: str,
    placement_hint: str,
    title_hint: str,
    visual_style_hint: str,
) -> None:
    job_started_perf = time.perf_counter()
    trace: dict[str, object] = {
        "job_id": job_id,
        "tool": CANVAS_GENERATE_VISUAL_TOOL,
        "started_at": now_iso(),
        "status": "running",
        "inputs": {
            "prompt": prompt,
            "aspect_ratio_hint": aspect_ratio_hint,
            "generation_mode": generation_mode,
            "placement_hint": placement_hint,
            "title_hint": title_hint,
            "visual_style_hint": visual_style_hint,
        },
        "context_summary": None,
        "context_wait": None,
        "artifact_generation": None,
        "placement_planner": None,
        "image_generator": None,
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

        artifact_generation_started_at = now_iso()
        artifact_payload = await generate_canvas_visual_artifact(
            prompt,
            title_hint=title_hint,
            visual_style_hint=visual_style_hint,
            aspect_ratio_hint=aspect_ratio_hint,
            generation_mode=generation_mode,
            placement_hint=placement_hint,
            placement_context=placement_context,
        )
        artifact_generation_timing = artifact_payload.get("artifact_timing")
        if isinstance(artifact_generation_timing, dict):
            trace["artifact_generation"] = artifact_generation_timing
        else:
            artifact_generation_completed_at = now_iso()
            trace["artifact_generation"] = {
                "started_at": artifact_generation_started_at,
                "completed_at": artifact_generation_completed_at,
                "duration_ms": None,
            }
        trace["placement_planner"] = artifact_payload.get("planner_trace")
        trace["image_generator"] = artifact_payload.get("image_trace")
        result = _build_tool_result(
            status="completed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary=(
                "Generated the requested visual and prepared it for canvas insertion. "
                "Once it is visible, explain what the visual shows and how it "
                "supports the current topic. Do not ask a new question or start a "
                "new topic."
            ),
            payload={
                "artifact_id": artifact_payload["artifact_id"],
                "title": artifact_payload["title"],
                "placement": {
                    "x": artifact_payload["x"],
                    "y": artifact_payload["y"],
                    "w": artifact_payload["w"],
                    "h": artifact_payload["h"],
                },
                "planner_trace": artifact_payload.get("planner_trace"),
            },
            frontend_action=_build_frontend_action(
                CANVAS_INSERT_VISUAL_ACTION,
                CANVAS_GENERATE_VISUAL_TOOL,
                payload=artifact_payload,
                job_id=job_id,
            ),
            job_id=job_id,
        )
        trace["status"] = "completed"
        trace["final_result"] = {
            "artifact_id": artifact_payload["artifact_id"],
            "title": artifact_payload["title"],
            "placement": {
                "x": artifact_payload["x"],
                "y": artifact_payload["y"],
                "w": artifact_payload["w"],
                "h": artifact_payload["h"],
            },
            "mime_type": artifact_payload.get("mime_type"),
            "frontend_payload_summary": {
                "title": artifact_payload["title"],
                "has_caption": bool(artifact_payload.get("caption")),
                "has_image_url": bool(artifact_payload.get("image_url")),
            },
        }
    except Exception as exc:  # pragma: no cover - defensive async boundary
        logger.exception(
            "Canvas visual generation failed: user_id=%s session_id=%s job_id=%s",
            user_id,
            session_id,
            job_id,
        )
        trace["status"] = "failed"
        trace["errors"] = {
            "message": str(exc),
            "type": exc.__class__.__name__,
        }
        result = _build_tool_result(
            status="failed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary=f"Visual generation failed: {exc}",
            job_id=job_id,
        )
    finally:
        trace["completed_at"] = now_iso()
        trace["total_duration_ms"] = max(
            0, int((time.perf_counter() - job_started_perf) * 1000)
        )
        trace_path = write_generate_visual_trace(job_id, trace)
        logger.info("Wrote canvas.generate_visual trace: %s", trace_path)

    if result.get("payload") is None:
        result["payload"] = {}
    if isinstance(result.get("payload"), dict):
        result["payload"]["trace_file"] = str(trace_path)

    await publish_canvas_visual_job_result(
        user_id=user_id,
        session_id=session_id,
        result=result,
    )


def canvas_generate_visual(
    prompt: str,
    aspect_ratio_hint: AspectRatioHint,
    generation_mode: GenerationMode = "quality",
    placement_hint: str = "auto",
    title_hint: str = "",
    visual_style_hint: str = "",
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Generate a static teaching visual and insert it into the canvas.

    `prompt` should be a full, self-sufficient visual brief. `aspect_ratio_hint`
    must be one of: `1:1`, `4:3`, `3:4`, `16:9`, or `9:16`. `generation_mode`
    must be either `quality` or `fast`.
    """

    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary="Visual generation requires a non-empty prompt",
        )

    normalized_aspect_ratio_hint = aspect_ratio_hint.strip()
    if not normalized_aspect_ratio_hint:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary="Visual generation requires an aspect_ratio_hint",
        )
    if normalized_aspect_ratio_hint not in SUPPORTED_ASPECT_RATIO_HINTS:
        supported = ", ".join(SUPPORTED_ASPECT_RATIO_HINTS)
        return _build_tool_result(
            status="failed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary=(
                "Visual generation aspect_ratio_hint must be one of: "
                f"{supported}"
            ),
        )

    normalized_generation_mode = generation_mode.strip().lower()
    if normalized_generation_mode not in SUPPORTED_GENERATION_MODES:
        supported_modes = ", ".join(SUPPORTED_GENERATION_MODES)
        return _build_tool_result(
            status="failed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary=(
                "Visual generation generation_mode must be one of: "
                f"{supported_modes}"
            ),
        )

    normalized_placement_hint = placement_hint.strip() or "auto"
    normalized_title_hint = title_hint.strip()
    normalized_style_hint = visual_style_hint.strip()
    job_id = f"visual-{uuid4()}"
    user_id, session_id = _get_session_identity(tool_context)

    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary="Visual generation requires an active session context",
            job_id=job_id,
        )

    canvas_context_request_store.create_request(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
    )
    asyncio.get_running_loop().create_task(
        _run_canvas_visual_job(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            prompt=normalized_prompt,
            aspect_ratio_hint=normalized_aspect_ratio_hint,
            generation_mode=normalized_generation_mode,
            placement_hint=normalized_placement_hint,
            title_hint=normalized_title_hint,
            visual_style_hint=normalized_style_hint,
        ),
        name=f"canvas-generate-visual-{job_id}",
    )

    payload = {
        "prompt": normalized_prompt,
        "aspect_ratio_hint": normalized_aspect_ratio_hint,
        "generation_mode": normalized_generation_mode,
        "placement_hint": normalized_placement_hint,
    }
    if normalized_title_hint:
        payload["title_hint"] = normalized_title_hint
    if normalized_style_hint:
        payload["visual_style_hint"] = normalized_style_hint

    return _build_tool_result(
        status="accepted",
        tool=CANVAS_GENERATE_VISUAL_TOOL,
        summary=(
            "Started visual generation. Hold the conversation on the same topic "
            "while the visual is being prepared. Do not ask a new question or "
            "introduce a new topic unless the user asks. Casual small talk is "
            "fine only to avoid dead air."
        ),
        payload=payload,
        frontend_action=_build_frontend_action(
            CANVAS_CONTEXT_REQUESTED_ACTION,
            CANVAS_GENERATE_VISUAL_TOOL,
            payload={
                "title": "Creating visual",
                "message": "Capturing the latest canvas context before generating the visual",
            },
            job_id=job_id,
        ),
        job_id=job_id,
    )


def get_canvas_visual_tools() -> list[LongRunningFunctionTool]:
    """Return the canvas visual tools registered for ThinkSpace."""

    return [LongRunningFunctionTool(canvas_generate_visual)]
