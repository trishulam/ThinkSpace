"""Canvas visual tools for the ThinkSpace agent."""

from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from google.adk.tools import LongRunningFunctionTool, ToolContext

from .canvas_visual_jobs import (
    generate_canvas_visual_artifact,
    publish_canvas_visual_job_result,
)

logger = logging.getLogger(__name__)

CANVAS_GENERATE_VISUAL_TOOL = "canvas.generate_visual"
CANVAS_JOB_STARTED_ACTION = "canvas.job_started"
CANVAS_INSERT_VISUAL_ACTION = "canvas.insert_visual"


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
    title_hint: str,
    visual_style_hint: str,
) -> None:
    try:
        artifact_payload = await generate_canvas_visual_artifact(
            prompt,
            title_hint=title_hint,
            visual_style_hint=visual_style_hint,
        )
        result = _build_tool_result(
            status="completed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary=(
                "Generated the requested visual and prepared it for canvas insertion"
            ),
            payload={
                "artifact_id": artifact_payload["artifact_id"],
                "title": artifact_payload["title"],
            },
            frontend_action=_build_frontend_action(
                CANVAS_INSERT_VISUAL_ACTION,
                CANVAS_GENERATE_VISUAL_TOOL,
                payload=artifact_payload,
                job_id=job_id,
            ),
            job_id=job_id,
        )
    except Exception as exc:  # pragma: no cover - defensive async boundary
        logger.exception(
            "Canvas visual generation failed: user_id=%s session_id=%s job_id=%s",
            user_id,
            session_id,
            job_id,
        )
        result = _build_tool_result(
            status="failed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary=f"Visual generation failed: {exc}",
            job_id=job_id,
        )

    await publish_canvas_visual_job_result(
        user_id=user_id,
        session_id=session_id,
        result=result,
    )


def canvas_generate_visual(
    prompt: str,
    title_hint: str = "",
    visual_style_hint: str = "",
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Generate a static teaching visual and insert it into the canvas."""

    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_GENERATE_VISUAL_TOOL,
            summary="Visual generation requires a non-empty prompt",
        )

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

    asyncio.get_running_loop().create_task(
        _run_canvas_visual_job(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            prompt=normalized_prompt,
            title_hint=normalized_title_hint,
            visual_style_hint=normalized_style_hint,
        ),
        name=f"canvas-generate-visual-{job_id}",
    )

    payload = {
        "prompt": normalized_prompt,
    }
    if normalized_title_hint:
        payload["title_hint"] = normalized_title_hint
    if normalized_style_hint:
        payload["visual_style_hint"] = normalized_style_hint

    return _build_tool_result(
        status="accepted",
        tool=CANVAS_GENERATE_VISUAL_TOOL,
        summary="Starting visual generation for the requested teaching artifact",
        payload=payload,
        frontend_action=_build_frontend_action(
            CANVAS_JOB_STARTED_ACTION,
            CANVAS_GENERATE_VISUAL_TOOL,
            payload={
                "title": "Creating visual",
                "message": "Generating a teaching visual for the canvas",
            },
            job_id=job_id,
        ),
        job_id=job_id,
    )


def get_canvas_visual_tools() -> list[LongRunningFunctionTool]:
    """Return the canvas visual tools registered for ThinkSpace."""

    return [LongRunningFunctionTool(canvas_generate_visual)]
