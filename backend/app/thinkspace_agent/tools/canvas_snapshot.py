"""Canvas viewport snapshot tool for the ThinkSpace agent."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable
from uuid import uuid4

from google.adk.tools import FunctionTool, ToolContext

from .canvas_context_requests import canvas_context_request_store

logger = logging.getLogger(__name__)

CANVAS_VIEWPORT_SNAPSHOT_TOOL = "canvas.viewport_snapshot"
CANVAS_VIEWPORT_SNAPSHOT_REQUESTED_ACTION = "canvas.viewport_snapshot_requested"
CANVAS_VIEWPORT_SNAPSHOT_TIMEOUT_S = 10.0


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


@dataclass
class CanvasSnapshotSessionBridge:
    send_frontend_action: Callable[[dict[str, object]], Awaitable[None]]
    send_screenshot_data_url: Callable[[str], Awaitable[bool]]


class CanvasSnapshotSessionBridgeStore:
    """Per-session bridge for immediate viewport snapshot interactions."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._bridges: dict[tuple[str, str], CanvasSnapshotSessionBridge] = {}

    async def set_bridge(
        self,
        *,
        user_id: str,
        session_id: str,
        bridge: CanvasSnapshotSessionBridge,
    ) -> None:
        async with self._lock:
            self._bridges[(user_id, session_id)] = bridge

    async def get_bridge(
        self, *, user_id: str, session_id: str
    ) -> CanvasSnapshotSessionBridge | None:
        async with self._lock:
            return self._bridges.get((user_id, session_id))

    async def clear_bridge(self, *, user_id: str, session_id: str) -> None:
        async with self._lock:
            self._bridges.pop((user_id, session_id), None)


canvas_snapshot_session_bridge_store = CanvasSnapshotSessionBridgeStore()


async def canvas_viewport_snapshot(
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Capture a fresh viewport screenshot for the current canvas viewport."""

    job_id = f"viewport-snapshot-{uuid4()}"
    user_id, session_id = _get_session_identity(tool_context)
    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_VIEWPORT_SNAPSHOT_TOOL,
            summary="Viewport snapshot requires an active session context",
            job_id=job_id,
        )

    bridge = await canvas_snapshot_session_bridge_store.get_bridge(
        user_id=user_id,
        session_id=session_id,
    )
    if bridge is None:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_VIEWPORT_SNAPSHOT_TOOL,
            summary="Viewport snapshot requires an active live canvas bridge",
            job_id=job_id,
        )

    canvas_context_request_store.create_request(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
    )

    try:
        await bridge.send_frontend_action(
            _build_frontend_action(
                CANVAS_VIEWPORT_SNAPSHOT_REQUESTED_ACTION,
                CANVAS_VIEWPORT_SNAPSHOT_TOOL,
                payload={
                    "title": "Refreshing canvas view",
                    "message": "Capturing a fresh viewport snapshot and context",
                },
                job_id=job_id,
            )
        )
        context = await canvas_context_request_store.wait_for_response(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            timeout_s=CANVAS_VIEWPORT_SNAPSHOT_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "Viewport snapshot timed out: user_id=%s session_id=%s job_id=%s",
            user_id,
            session_id,
            job_id,
        )
        return _build_tool_result(
            status="failed",
            tool=CANVAS_VIEWPORT_SNAPSHOT_TOOL,
            summary="Timed out while waiting for a fresh viewport snapshot",
            job_id=job_id,
        )
    except Exception as exc:  # pragma: no cover - defensive runtime boundary
        logger.exception(
            "Viewport snapshot failed: user_id=%s session_id=%s job_id=%s",
            user_id,
            session_id,
            job_id,
        )
        canvas_context_request_store.cancel_request(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
        )
        return _build_tool_result(
            status="failed",
            tool=CANVAS_VIEWPORT_SNAPSHOT_TOOL,
            summary=f"Viewport snapshot failed: {exc}",
            job_id=job_id,
        )

    screenshot_data_url = context.get("screenshot_data_url")
    if isinstance(screenshot_data_url, str) and screenshot_data_url:
        screenshot_sent = await bridge.send_screenshot_data_url(screenshot_data_url)
        if not screenshot_sent:
            return _build_tool_result(
                status="failed",
                tool=CANVAS_VIEWPORT_SNAPSHOT_TOOL,
                summary="Viewport snapshot captured, but screenshot delivery failed",
                job_id=job_id,
            )

    return _build_tool_result(
        status="completed",
        tool=CANVAS_VIEWPORT_SNAPSHOT_TOOL,
        summary=(
            "Refer to the attached screenshot for the current canvas viewport snapshot"
        ),
        job_id=job_id,
    )


def get_canvas_snapshot_tools() -> list[FunctionTool]:
    """Return the canvas snapshot tools registered for ThinkSpace."""

    return [FunctionTool(canvas_viewport_snapshot)]
