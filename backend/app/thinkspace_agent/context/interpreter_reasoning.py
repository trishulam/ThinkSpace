"""Phase 8 canvas interpreter reasoning helpers for Story I."""

from __future__ import annotations

import asyncio
import base64
import copy
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Literal
from uuid import uuid4

from google.genai import Client
from google.genai import types as genai_types
from pydantic import BaseModel, Field

from thinkspace_agent.config import get_canvas_interpreter_model
from thinkspace_agent.context.interpreter_packet import ApiModel, InterpreterInputPacket
from thinkspace_agent.context.interpreter_reasoning_trace import (
    now_iso,
    summarize_activity_window,
    summarize_compacted_context,
    summarize_reasoning_input,
    summarize_snapshot_reference,
    write_interpreter_reasoning_trace,
)

logger = logging.getLogger(__name__)


def _build_client() -> Client:
    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def _parse_data_url(data_url: str) -> tuple[str, bytes] | None:
    if not data_url or not data_url.startswith("data:"):
        return None

    header, _, encoded = data_url.partition(",")
    if not header or not encoded:
        return None

    mime_type = header[5:].split(";", maxsplit=1)[0] or "image/jpeg"
    try:
        return mime_type, base64.b64decode(encoded)
    except (ValueError, TypeError):
        return None


class InterpreterCanvasChangeSummary(ApiModel):
    current_canvas_state_summary: str | None = None
    meaningful_user_changes: list[str] = Field(default_factory=list)
    meaningful_tutor_changes: list[str] = Field(default_factory=list)


class InterpreterLearnerState(ApiModel):
    progress_signals: list[str] = Field(default_factory=list)
    confusion_signals: list[str] = Field(default_factory=list)
    omission_signals: list[str] = Field(default_factory=list)


class InterpreterPedagogicalInterpretation(ApiModel):
    what_the_learner_is_doing: str | None = None
    what_the_learner_likely_understands: str | None = None
    what_the_learner_may_be_missing: str | None = None


class InterpreterProactivity(ApiModel):
    is_candidate: bool = False
    reason: str | None = None
    urgency: Literal["low", "medium", "high"] = "low"


class InterpreterSteering(ApiModel):
    recommended_next_tutor_move: str | None = None
    recommended_goal: str | None = None
    recommended_canvas_focus: str | None = None
    recommended_question: str | None = None


class InterpreterConfidence(ApiModel):
    overall: Literal["low", "medium", "high"] = "low"
    why: str | None = None


class InterpreterSafetyFlags(ApiModel):
    needs_fresh_viewport: bool = False
    insufficient_context: bool = False


class InterpreterReasoningModelOutput(ApiModel):
    canvas_change_summary: InterpreterCanvasChangeSummary
    learner_state: InterpreterLearnerState
    pedagogical_interpretation: InterpreterPedagogicalInterpretation
    proactivity: InterpreterProactivity
    steering: InterpreterSteering
    confidence: InterpreterConfidence
    safety_flags: InterpreterSafetyFlags


class InterpreterReasoningResult(ApiModel):
    status: Literal["completed", "stale", "failed"]
    run_id: str
    packet_window_id: str
    reasoning_model: str
    canvas_change_summary: InterpreterCanvasChangeSummary
    learner_state: InterpreterLearnerState
    pedagogical_interpretation: InterpreterPedagogicalInterpretation
    proactivity: InterpreterProactivity
    steering: InterpreterSteering
    confidence: InterpreterConfidence
    safety_flags: InterpreterSafetyFlags
    started_at: str
    finished_at: str
    superseded_by_window_id: str | None = None
    error: str | None = None
    trace_file: str | None = None


class InterpreterLifecycleEvent(ApiModel):
    state: Literal["started", "completed", "failed"]
    run_id: str
    packet_window_id: str
    started_at: str
    finished_at: str | None = None
    trace_file: str | None = None
    error: str | None = None


@dataclass
class _StoredInterpreterReasoningState:
    latest_request_sequence: int = 0
    latest_requested_window_id: str | None = None
    latest_completed_window_id: str | None = None
    latest_run_id: str | None = None
    latest_status: str | None = None
    latest_started_at: str | None = None
    latest_finished_at: str | None = None
    latest_result: dict[str, object] | None = None
    latest_trace_file: str | None = None
    active_tasks: dict[int, asyncio.Task[None]] = field(default_factory=dict)


InterpreterLifecycleCallback = Callable[
    [dict[str, object]],
    Awaitable[None],
]


def _empty_reasoning_output(
    *,
    needs_fresh_viewport: bool = False,
    insufficient_context: bool = False,
) -> InterpreterReasoningModelOutput:
    return InterpreterReasoningModelOutput(
        canvas_change_summary=InterpreterCanvasChangeSummary(
            current_canvas_state_summary=None,
            meaningful_user_changes=[],
            meaningful_tutor_changes=[],
        ),
        learner_state=InterpreterLearnerState(
            progress_signals=[],
            confusion_signals=[],
            omission_signals=[],
        ),
        pedagogical_interpretation=InterpreterPedagogicalInterpretation(
            what_the_learner_is_doing=None,
            what_the_learner_likely_understands=None,
            what_the_learner_may_be_missing=None,
        ),
        proactivity=InterpreterProactivity(
            is_candidate=False,
            reason=None,
            urgency="low",
        ),
        steering=InterpreterSteering(
            recommended_next_tutor_move=None,
            recommended_goal=None,
            recommended_canvas_focus=None,
            recommended_question=None,
        ),
        confidence=InterpreterConfidence(
            overall="low",
            why=None,
        ),
        safety_flags=InterpreterSafetyFlags(
            needs_fresh_viewport=needs_fresh_viewport,
            insufficient_context=insufficient_context,
        ),
    )


def _build_result(
    *,
    status: Literal["completed", "stale", "failed"],
    run_id: str,
    packet_window_id: str,
    reasoning_model: str,
    output: InterpreterReasoningModelOutput,
    started_at: str,
    finished_at: str,
    superseded_by_window_id: str | None = None,
    error: str | None = None,
    trace_file: str | None = None,
) -> InterpreterReasoningResult:
    return InterpreterReasoningResult(
        status=status,
        run_id=run_id,
        packet_window_id=packet_window_id,
        reasoning_model=reasoning_model,
        canvas_change_summary=output.canvas_change_summary,
        learner_state=output.learner_state,
        pedagogical_interpretation=output.pedagogical_interpretation,
        proactivity=output.proactivity,
        steering=output.steering,
        confidence=output.confidence,
        safety_flags=output.safety_flags,
        started_at=started_at,
        finished_at=finished_at,
        superseded_by_window_id=superseded_by_window_id,
        error=error,
        trace_file=trace_file,
    )


def _build_reasoning_prompt(packet: InterpreterInputPacket) -> str:
    payload = packet.model_dump(mode="json", by_alias=True)
    return "\n".join(
        [
            "You are the ThinkSpace canvas interpreter.",
            "Analyze the latest canvas activity window in educational context.",
            "You are not speaking to the learner and you are not the main tutor.",
            "Use both the structured packet and the accompanying screenshot.",
            "The screenshot is mandatory grounding for this reasoning step.",
            "Return only JSON matching the provided schema.",
            "Requirements:",
            "- Focus on pedagogical interpretation, not generic summarization.",
            "- Identify meaningful user changes and meaningful tutor changes.",
            "- Infer likely learner understanding, confusion, and omissions conservatively.",
            "- Decide whether this is a proactive candidate for the tutor.",
            "- Recommend exactly one best next tutor move and steering direction.",
            "- If the context is weak, lower confidence and use safety flags.",
            "- Do not invent details that are not grounded in the packet or screenshot.",
            "",
            "Input JSON:",
            json.dumps(payload, ensure_ascii=True, indent=2),
        ]
    )


def _build_raw_response_payload(response: object) -> dict[str, object]:
    parsed = getattr(response, "parsed", None)
    text = getattr(response, "text", None)
    return {
        "text": text if isinstance(text, str) else None,
        "parsed": (
            parsed.model_dump()
            if isinstance(parsed, BaseModel)
            else parsed
        ),
    }


def _build_trace_payload(
    *,
    run_id: str,
    started_at: str,
    finished_at: str,
    status: str,
    reasoning_model: str,
    packet: dict[str, object],
    canvas_context: dict[str, object] | None,
    prompt_text: str | None,
    raw_model_response: dict[str, object] | None,
    parsed_output: dict[str, object],
    error: str | None,
    superseded_by_window_id: str | None = None,
) -> dict[str, object]:
    session = packet.get("session") if isinstance(packet, dict) else None
    canvas_window = packet.get("canvas_window") if isinstance(packet, dict) else None
    return {
        "run_id": run_id,
        "session_id": (
            session.get("session_id")
            if isinstance(session, dict)
            else None
        ),
        "packet_window_id": (
            canvas_window.get("id")
            if isinstance(canvas_window, dict)
            else None
        ),
        "started_at": started_at,
        "finished_at": finished_at,
        "status": status,
        "reasoning_model": reasoning_model,
        "input_summary": summarize_reasoning_input(
            packet=packet,
            canvas_context=canvas_context,
        ),
        "activity_window_summary": summarize_activity_window(packet),
        "compacted_context_summary": summarize_compacted_context(packet),
        "snapshot_reference": summarize_snapshot_reference(canvas_context),
        "packet_without_screenshot": packet,
        "prompt_text": prompt_text,
        "raw_model_response": raw_model_response,
        "parsed_output": parsed_output,
        "superseded_by_window_id": superseded_by_window_id,
        "send_content_status": "not_applicable",
        "send_realtime_status": "not_applicable",
        "error": error,
    }


def _execute_reasoning_call(
    *,
    reasoning_model: str,
    packet: dict[str, object],
    canvas_context: dict[str, object] | None,
    run_id: str,
    started_at: str,
) -> tuple[InterpreterReasoningResult, dict[str, object]]:
    packet_model = InterpreterInputPacket.model_validate(packet)
    packet_window_id = packet_model.canvas_window.id
    prompt_text = _build_reasoning_prompt(packet_model)
    packet_without_screenshot = packet_model.model_dump(mode="python", by_alias=False)
    screenshot_data_url = (
        canvas_context.get("screenshot_data_url")
        if isinstance(canvas_context, dict)
        else None
    )

    if not isinstance(screenshot_data_url, str) or not screenshot_data_url:
        finished_at = now_iso()
        output = _empty_reasoning_output(
            needs_fresh_viewport=True,
            insufficient_context=True,
        )
        result = _build_result(
            status="failed",
            run_id=run_id,
            packet_window_id=packet_window_id,
            reasoning_model=reasoning_model,
            output=output,
            started_at=started_at,
            finished_at=finished_at,
            error="Missing screenshot_data_url in cached canvas context",
        )
        return result, _build_trace_payload(
            run_id=run_id,
            started_at=started_at,
            finished_at=finished_at,
            status=result.status,
            reasoning_model=reasoning_model,
            packet=packet_without_screenshot,
            canvas_context=canvas_context,
            prompt_text=prompt_text,
            raw_model_response=None,
            parsed_output=output.model_dump(mode="python", by_alias=False),
            error=result.error,
        )

    parsed_data_url = _parse_data_url(screenshot_data_url)
    if parsed_data_url is None:
        finished_at = now_iso()
        output = _empty_reasoning_output(
            needs_fresh_viewport=True,
            insufficient_context=True,
        )
        result = _build_result(
            status="failed",
            run_id=run_id,
            packet_window_id=packet_window_id,
            reasoning_model=reasoning_model,
            output=output,
            started_at=started_at,
            finished_at=finished_at,
            error="Invalid screenshot_data_url in cached canvas context",
        )
        return result, _build_trace_payload(
            run_id=run_id,
            started_at=started_at,
            finished_at=finished_at,
            status=result.status,
            reasoning_model=reasoning_model,
            packet=packet_without_screenshot,
            canvas_context=canvas_context,
            prompt_text=prompt_text,
            raw_model_response=None,
            parsed_output=output.model_dump(mode="python", by_alias=False),
            error=result.error,
        )

    mime_type, image_bytes = parsed_data_url
    screenshot_part = genai_types.Part(
        inlineData=genai_types.Blob(
            data=image_bytes,
            mimeType=mime_type,
        )
    )

    client = _build_client()
    response = client.models.generate_content(
        model=reasoning_model,
        contents=[prompt_text, screenshot_part],
        config=genai_types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=InterpreterReasoningModelOutput,
        ),
    )

    if response.parsed is None:
        raise ValueError("Canvas interpreter reasoning returned no structured payload")

    output = InterpreterReasoningModelOutput.model_validate(response.parsed)
    finished_at = now_iso()
    result = _build_result(
        status="completed",
        run_id=run_id,
        packet_window_id=packet_window_id,
        reasoning_model=reasoning_model,
        output=output,
        started_at=started_at,
        finished_at=finished_at,
    )
    return result, _build_trace_payload(
        run_id=run_id,
        started_at=started_at,
        finished_at=finished_at,
        status=result.status,
        reasoning_model=reasoning_model,
        packet=packet_without_screenshot,
        canvas_context=canvas_context,
        prompt_text=prompt_text,
        raw_model_response=_build_raw_response_payload(response),
        parsed_output=output.model_dump(mode="python", by_alias=False),
        error=None,
    )


class InterpreterReasoningStore:
    """Per-session latest-wins interpreter reasoning runner and result store."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._states: dict[tuple[str, str], _StoredInterpreterReasoningState] = {}

    async def schedule_reasoning(
        self,
        *,
        user_id: str,
        session_id: str,
        packet: dict[str, object],
        canvas_context: dict[str, object] | None,
        lifecycle_callback: InterpreterLifecycleCallback | None = None,
    ) -> None:
        packet_copy = copy.deepcopy(packet)
        canvas_context_copy = copy.deepcopy(canvas_context)
        packet_window = packet_copy.get("canvas_window")
        packet_window_id = (
            packet_window.get("id")
            if isinstance(packet_window, dict)
            else None
        )
        state_key = (user_id, session_id)
        run_id = f"interpreter-{uuid4()}"
        started_at = now_iso()

        async with self._lock:
            state = self._states.setdefault(state_key, _StoredInterpreterReasoningState())
            state.latest_request_sequence += 1
            request_sequence = state.latest_request_sequence
            state.latest_requested_window_id = (
                packet_window_id if isinstance(packet_window_id, str) else None
            )
            state.latest_run_id = run_id
            state.latest_status = "running"
            state.latest_started_at = started_at
            state.latest_finished_at = None
            task = asyncio.create_task(
                self._run_reasoning_task(
                    user_id=user_id,
                    session_id=session_id,
                    request_sequence=request_sequence,
                    run_id=run_id,
                    started_at=started_at,
                    packet=packet_copy,
                    canvas_context=canvas_context_copy,
                    lifecycle_callback=lifecycle_callback,
                )
            )
            state.active_tasks[request_sequence] = task

    async def get_snapshot(
        self,
        *,
        user_id: str,
        session_id: str,
    ) -> dict[str, object] | None:
        async with self._lock:
            state = self._states.get((user_id, session_id))
            if state is None:
                return None
            return {
                "latestRequestedWindowId": state.latest_requested_window_id,
                "latestCompletedWindowId": state.latest_completed_window_id,
                "latestRunId": state.latest_run_id,
                "currentStatus": state.latest_status,
                "latestStartedAt": state.latest_started_at,
                "latestFinishedAt": state.latest_finished_at,
                "latestResult": copy.deepcopy(state.latest_result),
                "latestTraceFile": state.latest_trace_file,
                "activeRunCount": len(state.active_tasks),
            }

    async def clear_session(self, *, user_id: str, session_id: str) -> None:
        async with self._lock:
            state = self._states.pop((user_id, session_id), None)
        if state is None:
            return
        for task in state.active_tasks.values():
            if not task.done():
                task.cancel()

    async def _get_latest_request_info(
        self,
        *,
        user_id: str,
        session_id: str,
    ) -> tuple[int | None, str | None]:
        async with self._lock:
            state = self._states.get((user_id, session_id))
            if state is None:
                return None, None
            return state.latest_request_sequence, state.latest_requested_window_id

    async def _finalize_task(
        self,
        *,
        user_id: str,
        session_id: str,
        request_sequence: int,
        latest_result: dict[str, object] | None = None,
        latest_trace_file: str | None = None,
        latest_completed_window_id: str | None = None,
        latest_status: str | None = None,
        latest_finished_at: str | None = None,
    ) -> None:
        async with self._lock:
            state = self._states.get((user_id, session_id))
            if state is None:
                return
            state.active_tasks.pop(request_sequence, None)
            if latest_status is not None:
                state.latest_status = latest_status
            if latest_finished_at is not None:
                state.latest_finished_at = latest_finished_at
            if latest_result is not None:
                state.latest_result = latest_result
                state.latest_trace_file = latest_trace_file
                state.latest_completed_window_id = latest_completed_window_id

    async def _emit_lifecycle_event(
        self,
        *,
        lifecycle_callback: InterpreterLifecycleCallback | None,
        event: InterpreterLifecycleEvent,
    ) -> None:
        if lifecycle_callback is None:
            return
        try:
            await lifecycle_callback(event.model_dump(mode="python", by_alias=False))
        except Exception:  # pragma: no cover - defensive runtime boundary
            logger.exception(
                "Failed to emit interpreter lifecycle event: run_id=%s state=%s",
                event.run_id,
                event.state,
            )

    async def _run_reasoning_task(
        self,
        *,
        user_id: str,
        session_id: str,
        request_sequence: int,
        run_id: str,
        started_at: str,
        packet: dict[str, object],
        canvas_context: dict[str, object] | None,
        lifecycle_callback: InterpreterLifecycleCallback | None = None,
    ) -> None:
        reasoning_model = get_canvas_interpreter_model()
        packet_window = packet.get("canvas_window")
        packet_window_id = (
            packet_window.get("id")
            if isinstance(packet_window, dict)
            else "unknown"
        )

        await self._emit_lifecycle_event(
            lifecycle_callback=lifecycle_callback,
            event=InterpreterLifecycleEvent(
                state="started",
                run_id=run_id,
                packet_window_id=packet_window_id,
                started_at=started_at,
            ),
        )

        try:
            result, trace = await asyncio.to_thread(
                _execute_reasoning_call,
                reasoning_model=reasoning_model,
                packet=packet,
                canvas_context=canvas_context,
                run_id=run_id,
                started_at=started_at,
            )
        except asyncio.CancelledError:
            await self._finalize_task(
                user_id=user_id,
                session_id=session_id,
                request_sequence=request_sequence,
                latest_status="cancelled",
            )
            raise
        except Exception as exc:  # pragma: no cover - defensive runtime boundary
            logger.exception(
                "Canvas interpreter reasoning failed: user_id=%s session_id=%s",
                user_id,
                session_id,
            )
            output = _empty_reasoning_output()
            finished_at = now_iso()
            result = _build_result(
                status="failed",
                run_id=run_id,
                packet_window_id=packet_window_id,
                reasoning_model=reasoning_model,
                output=output,
                started_at=started_at,
                finished_at=finished_at,
                error=str(exc),
            )
            trace = _build_trace_payload(
                run_id=run_id,
                started_at=started_at,
                finished_at=finished_at,
                status=result.status,
                reasoning_model=reasoning_model,
                packet=packet,
                canvas_context=canvas_context,
                prompt_text=None,
                raw_model_response=None,
                parsed_output=output.model_dump(mode="python", by_alias=False),
                error=str(exc),
            )

        latest_request_sequence, latest_window_id = await self._get_latest_request_info(
            user_id=user_id,
            session_id=session_id,
        )
        is_latest_request = latest_request_sequence == request_sequence
        if not is_latest_request:
            result.status = "stale"
            result.superseded_by_window_id = latest_window_id

        trace["status"] = result.status
        trace["superseded_by_window_id"] = result.superseded_by_window_id
        trace["error"] = result.error
        trace_path = write_interpreter_reasoning_trace(run_id, trace)
        result.trace_file = str(trace_path)

        await self._finalize_task(
            user_id=user_id,
            session_id=session_id,
            request_sequence=request_sequence,
            latest_result=(
                result.model_dump(mode="python", by_alias=False)
                if is_latest_request
                else None
            ),
            latest_trace_file=str(trace_path) if is_latest_request else None,
            latest_completed_window_id=(
                result.packet_window_id if is_latest_request else None
            ),
            latest_status=result.status if is_latest_request else None,
            latest_finished_at=result.finished_at if is_latest_request else None,
        )

        if is_latest_request:
            if result.status == "failed":
                await self._emit_lifecycle_event(
                    lifecycle_callback=lifecycle_callback,
                    event=InterpreterLifecycleEvent(
                        state="failed",
                        run_id=run_id,
                        packet_window_id=result.packet_window_id,
                        started_at=result.started_at,
                        finished_at=result.finished_at,
                        trace_file=result.trace_file,
                        error=result.error,
                    ),
                )
            elif result.status == "completed":
                await self._emit_lifecycle_event(
                    lifecycle_callback=lifecycle_callback,
                    event=InterpreterLifecycleEvent(
                        state="completed",
                        run_id=run_id,
                        packet_window_id=result.packet_window_id,
                        started_at=result.started_at,
                        finished_at=result.finished_at,
                        trace_file=result.trace_file,
                    ),
                )


interpreter_reasoning_store = InterpreterReasoningStore()
