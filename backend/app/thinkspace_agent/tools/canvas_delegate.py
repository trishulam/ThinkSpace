"""Canvas delegation tool for the ThinkSpace agent."""

from __future__ import annotations

from uuid import uuid4

from google.adk.tools import LongRunningFunctionTool, ToolContext

from .canvas_delegate_jobs import canvas_delegate_job_store

CANVAS_DELEGATE_TASK_TOOL = "canvas.delegate_task"
CANVAS_DELEGATE_REQUESTED_ACTION = "canvas.delegate_requested"


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


async def _store_delegate_job(
    *,
    user_id: str,
    session_id: str,
    job_id: str,
    goal: str,
    target_scope: str,
    constraints: str,
    teaching_intent: str,
) -> None:
    await canvas_delegate_job_store.create_job(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
        goal=goal,
        target_scope=target_scope,
        constraints=constraints,
        teaching_intent=teaching_intent,
    )


def canvas_delegate_task(
    goal: str,
    target_scope: str = "viewport",
    constraints: str = "",
    teaching_intent: str = "",
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Delegate open-ended canvas editing to the frontend tldraw canvas agent."""

    normalized_goal = goal.strip()
    if not normalized_goal:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_DELEGATE_TASK_TOOL,
            summary="Canvas delegation requires a non-empty goal",
        )

    normalized_target_scope = target_scope.strip() or "viewport"
    if normalized_target_scope not in {"viewport", "selection"}:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_DELEGATE_TASK_TOOL,
            summary="Canvas delegation target_scope must be viewport or selection",
        )

    normalized_constraints = constraints.strip()
    normalized_teaching_intent = teaching_intent.strip()
    job_id = f"delegate-{uuid4()}"
    user_id, session_id = _get_session_identity(tool_context)

    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            tool=CANVAS_DELEGATE_TASK_TOOL,
            summary="Canvas delegation requires an active session context",
            job_id=job_id,
        )

    import asyncio

    asyncio.get_running_loop().create_task(
        _store_delegate_job(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            goal=normalized_goal,
            target_scope=normalized_target_scope,
            constraints=normalized_constraints,
            teaching_intent=normalized_teaching_intent,
        ),
        name=f"canvas-delegate-store-{job_id}",
    )

    payload: dict[str, object] = {
        "goal": normalized_goal,
        "target_scope": normalized_target_scope,
        "title": "Editing canvas",
        "message": "Handing this canvas task to the canvas agent",
    }
    if normalized_constraints:
        payload["constraints"] = normalized_constraints
    if normalized_teaching_intent:
        payload["teaching_intent"] = normalized_teaching_intent

    return _build_tool_result(
        status="accepted",
        tool=CANVAS_DELEGATE_TASK_TOOL,
        summary=(
            "Started delegated canvas work. Stay on the same topic for a longer "
            "stretch while the canvas worker is working. Do not ask a new "
            "question or introduce a new topic unless the user asks. Casual "
            "small talk is fine only to avoid dead air."
        ),
        payload={
            "goal": normalized_goal,
            "target_scope": normalized_target_scope,
            "constraints": normalized_constraints or None,
            "teaching_intent": normalized_teaching_intent or None,
        },
        frontend_action=_build_frontend_action(
            CANVAS_DELEGATE_REQUESTED_ACTION,
            CANVAS_DELEGATE_TASK_TOOL,
            payload=payload,
            job_id=job_id,
        ),
        job_id=job_id,
    )


def get_canvas_delegate_tools() -> list[LongRunningFunctionTool]:
    """Return the canvas delegation tools registered for ThinkSpace."""

    return [LongRunningFunctionTool(canvas_delegate_task)]
