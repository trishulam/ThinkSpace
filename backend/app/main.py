"""FastAPI application demonstrating ADK Gemini Live API Toolkit with WebSocket."""

import asyncio
import base64
import json
import logging
import os
import warnings
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from google.adk.events import Event, EventActions
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.genai import errors as genai_errors
from google.genai import types
from adk_session_service import create_adk_session_service
from session_key_moments import (
    KeyMomentGenerationResponse,
    SessionKeyMomentArtifact,
    create_key_moment_store,
    generate_key_moment_response,
)
from session_notes import (
    SessionNotesArtifact,
    create_notes_store,
    generate_session_notes_artifact,
)
from session_replay_status import (
    SessionReplayStatusBatchRequest,
    SessionReplayStatusBatchResponse,
    SessionReplayStatus,
    compute_replay_status,
    create_replay_status_store,
    default_replay_status,
)
from session_recordings import SessionRecordingManifest, SessionRecordingStore
from session_store import (
    AdkSessionSummary,
    CheckpointCreateRequest,
    CheckpointRecord,
    SessionCreateRequest,
    SessionListResponse,
    SessionRecord,
    SessionResumeResponse,
    TranscriptEntryRecord,
    TranscriptTurnRecord,
    create_session_store,
)

# Load environment variables from .env file BEFORE importing agent
load_dotenv(Path(__file__).parent / ".env")

# Import agent after loading environment variables
# pylint: disable=wrong-import-position
from thinkspace_agent.agent import agent  # noqa: E402
from thinkspace_agent.tools.canvas_visual_jobs import (  # noqa: E402
    canvas_visual_job_outbox,
)
from thinkspace_agent.tools.canvas_visuals import (  # noqa: E402
    CANVAS_GENERATE_VISUAL_TOOL,
)
from thinkspace_agent.tools.canvas_widget_jobs import (  # noqa: E402
    canvas_widget_job_outbox,
)
from thinkspace_agent.tools.canvas_widgets import (  # noqa: E402
    CANVAS_GENERATE_GRAPH_TOOL,
    CANVAS_GENERATE_NOTATION_TOOL,
)
from thinkspace_agent.tools.canvas_delegate import (  # noqa: E402
    CANVAS_DELEGATE_TASK_TOOL,
)
from thinkspace_agent.tools.canvas_delegate_jobs import (  # noqa: E402
    canvas_delegate_job_outbox,
    canvas_delegate_job_store,
    publish_canvas_delegate_job_result,
)
from thinkspace_agent.tools.canvas_snapshot import (  # noqa: E402
    CANVAS_VIEWPORT_SNAPSHOT_REQUESTED_ACTION,
    CanvasSnapshotSessionBridge,
    canvas_snapshot_session_bridge_store,
)
from thinkspace_agent.tools.canvas_context_requests import (  # noqa: E402
    canvas_context_request_store,
)
from thinkspace_agent.tools.canvas_context_store import (  # noqa: E402
    canvas_placement_context_store,
)
from thinkspace_agent.tools.flashcard_jobs import (  # noqa: E402
    flashcard_job_outbox,
    flashcard_session_store,
)
from thinkspace_agent.tools.flashcards import (  # noqa: E402
    FLASHCARDS_CREATE_TOOL,
)
from thinkspace_agent.context.session_compaction import (  # noqa: E402
    build_compacted_session_context,
)
from thinkspace_agent.context.interpreter_packet import (  # noqa: E402
    InterpreterCanvasWindow,
    build_interpreter_input_packet,
    interpreter_packet_store,
)
from thinkspace_agent.context.interpreter_reasoning import (  # noqa: E402
    interpreter_reasoning_store,
)
from thinkspace_agent.context.interpreter_snapshot_jobs import (  # noqa: E402
    PendingInterpreterSnapshotJob,
    interpreter_snapshot_job_store,
)
from thinkspace_agent.context.interpreter_reasoning_trace import (  # noqa: E402
    now_iso as interpreter_trace_now_iso,
    update_interpreter_reasoning_trace,
)
from thinkspace_agent.instructions.assembly import (  # noqa: E402
    build_instruction_text,
    get_static_instruction_text,
)
from thinkspace_agent.widgets.models import (  # noqa: E402
    WidgetReasonerRequest,
    WidgetReasonerResponse,
)
from thinkspace_agent.widgets.reasoner import reason_widget  # noqa: E402

def _configure_logging() -> None:
    """Configure console and rotating file logging for the backend."""
    log_level_name = os.getenv("THINKSPACE_LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, log_level_name, logging.DEBUG)
    log_file_path = Path(
        os.getenv(
            "THINKSPACE_LOG_FILE",
            str(Path(__file__).parent / "data" / "logs" / "thinkspace-backend.log"),
        )
    )
    log_file_path.parent.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter(
        "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    )
    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)

    file_handler = RotatingFileHandler(
        log_file_path,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)

    logging.basicConfig(
        level=log_level,
        handlers=[stream_handler, file_handler],
        force=True,
    )

    # Keep third-party internals from flooding logs during realtime audio sessions.
    logging.getLogger("aiosqlite").setLevel(logging.WARNING)
    logging.getLogger("google.auth._default").setLevel(logging.INFO)
    logging.getLogger("urllib3.connectionpool").setLevel(logging.INFO)
    logging.getLogger(
        "google_adk.google.adk.flows.llm_flows.base_llm_flow"
    ).setLevel(logging.INFO)
    logging.getLogger(
        "google_adk.google.adk.flows.llm_flows.audio_cache_manager"
    ).setLevel(logging.INFO)
    logging.getLogger(
        "google_adk.google.adk.models.gemini_llm_connection"
    ).setLevel(logging.INFO)


_configure_logging()
logger = logging.getLogger(__name__)

# Avoid verbose websocket transport logs leaking sensitive headers like API keys.
logging.getLogger("websockets.client").setLevel(logging.INFO)

# Suppress Pydantic serialization warnings
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

# Application name constant
APP_NAME = "bidi-demo"
CONVERSATION_MEMORY_STATE_KEY = "conversation_memory"
LAST_USER_MESSAGE_STATE_KEY = "last_user_message"
LAST_AGENT_MESSAGE_STATE_KEY = "last_agent_message"
MAX_CONVERSATION_MEMORY_CHARS = 24_000
INTERPRETER_LIFECYCLE_ACTION = "interpreter.lifecycle"
INTERPRETER_REASONING_SOURCE_TOOL = "canvas.interpreter_reasoning"
INTERPRETER_DELIVERY_USER_SPEECH_STALE_S = 1.0
INTERPRETER_DELIVERY_COOLDOWN_S = 15.0


def _get_latest_invocation_id(events: list[object]) -> str | None:
    for event in reversed(events):
        invocation_id = getattr(event, "invocation_id", None)
        if isinstance(invocation_id, str) and invocation_id.strip():
            return invocation_id
    return None


def _summarize_adk_session(adk_session: object) -> AdkSessionSummary | None:
    session_id = getattr(adk_session, "id", None)
    user_id = getattr(adk_session, "user_id", None)
    if not isinstance(session_id, str) or not isinstance(user_id, str):
        return None

    events = getattr(adk_session, "events", []) or []
    state = getattr(adk_session, "state", {}) or {}
    last_update_time = getattr(adk_session, "last_update_time", None)

    return AdkSessionSummary(
        session_id=session_id,
        user_id=user_id,
        event_count=len(events),
        state_key_count=len(state),
        last_update_time=last_update_time if isinstance(last_update_time, (int, float)) else None,
        latest_invocation_id=_get_latest_invocation_id(events),
    )


def _serialize_adk_event_for_debug(event: object) -> dict[str, object]:
    content = getattr(event, "content", None)
    parts_summary: list[str] = []
    part_kinds: list[str] = []
    if content is not None:
        parts = getattr(content, "parts", None)
        if isinstance(parts, list):
            for part in parts[:4]:
                part_kind_names: list[str] = []
                text = getattr(part, "text", None)
                if isinstance(text, str) and text.strip():
                    trimmed = text.strip()
                    parts_summary.append(
                        trimmed if len(trimmed) <= 240 else trimmed[:237] + "..."
                    )
                    part_kind_names.append("text")
                if getattr(part, "function_call", None) is not None:
                    part_kind_names.append("function_call")
                if getattr(part, "function_response", None) is not None:
                    part_kind_names.append("function_response")
                if getattr(part, "inline_data", None) is not None:
                    part_kind_names.append("inline_data")
                if getattr(part, "executable_code", None) is not None:
                    part_kind_names.append("executable_code")
                if getattr(part, "code_execution_result", None) is not None:
                    part_kind_names.append("code_execution_result")
                for kind_name in part_kind_names:
                    if kind_name not in part_kinds:
                        part_kinds.append(kind_name)

    actions = getattr(event, "actions", None)
    state_delta = getattr(actions, "state_delta", None) if actions is not None else None
    state_delta_keys = (
        sorted(state_delta.keys())[:20]
        if isinstance(state_delta, dict)
        else []
    )

    invocation_id = getattr(event, "invocation_id", None)
    if not isinstance(invocation_id, str):
        invocation_id = None

    input_transcription = getattr(event, "input_transcription", None)
    output_transcription = getattr(event, "output_transcription", None)

    def _serialize_transcription_payload(transcription: object) -> dict[str, object] | None:
        if transcription is None:
            return None

        text = getattr(transcription, "text", None)
        finished = getattr(transcription, "finished", None)
        if not isinstance(text, str) or not text.strip():
            return None

        return {
            "text": text,
            "finished": finished if isinstance(finished, bool) else None,
        }

    return {
        "id": getattr(event, "id", None),
        "author": getattr(event, "author", None),
        "timestamp": getattr(event, "timestamp", None),
        "invocationId": invocation_id,
        "partial": getattr(event, "partial", None),
        "turnComplete": getattr(event, "turn_complete", None),
        "interrupted": getattr(event, "interrupted", None),
        "hasContent": content is not None,
        "partKinds": part_kinds,
        "partsSummary": parts_summary,
        "stateDeltaKeys": state_delta_keys,
        "inputTranscription": _serialize_transcription_payload(input_transcription),
        "outputTranscription": _serialize_transcription_payload(output_transcription),
    }


def _summarize_latest_invocation_for_debug(
    events: list[object], latest_invocation_id: str | None
) -> dict[str, object] | None:
    if not isinstance(latest_invocation_id, str) or not latest_invocation_id.strip():
        return None

    matching_events = [
        event
        for event in events
        if getattr(event, "invocation_id", None) == latest_invocation_id
    ]
    if not matching_events:
        return None

    authors: list[str] = []
    part_kinds: list[str] = []
    turn_complete_count = 0
    user_content_after_turn_complete = False
    saw_turn_complete = False
    events_after_first_turn_complete = 0

    for event in matching_events:
        author = getattr(event, "author", None)
        if isinstance(author, str) and author not in authors:
            authors.append(author)

        serialized = _serialize_adk_event_for_debug(event)
        for kind_name in serialized.get("partKinds", []):
            if isinstance(kind_name, str) and kind_name not in part_kinds:
                part_kinds.append(kind_name)

        if getattr(event, "turn_complete", None):
            turn_complete_count += 1
            saw_turn_complete = True
            continue

        if saw_turn_complete:
            events_after_first_turn_complete += 1
            if author == "user" and serialized.get("hasContent") is True:
                user_content_after_turn_complete = True

    return {
        "latest_invocation_id": latest_invocation_id,
        "event_count": len(matching_events),
        "authors": authors,
        "part_kinds": part_kinds,
        "turn_complete_count": turn_complete_count,
        "events_after_first_turn_complete": events_after_first_turn_complete,
        "user_content_after_turn_complete": user_content_after_turn_complete,
    }


def _summarize_recent_non_memory_invocations_for_debug(
    events: list[object], *, limit: int = 3
) -> list[dict[str, object]]:
    invocation_order: list[str] = []
    grouped_events: dict[str, list[object]] = {}

    for event in events:
        invocation_id = getattr(event, "invocation_id", None)
        if not isinstance(invocation_id, str) or not invocation_id.strip():
            continue
        if invocation_id.startswith("memory-sync-") or invocation_id.startswith(
            "memory-backfill-"
        ):
            continue
        if invocation_id not in grouped_events:
            invocation_order.append(invocation_id)
            grouped_events[invocation_id] = []
        grouped_events[invocation_id].append(event)

    summaries: list[dict[str, object]] = []
    for invocation_id in invocation_order[-limit:]:
        summary = _summarize_latest_invocation_for_debug(
            grouped_events[invocation_id], invocation_id
        )
        if summary is not None:
            summaries.append(summary)
    return summaries


def _has_unsafe_resumable_invocation(
    recent_invocations: list[dict[str, object]],
) -> tuple[bool, dict[str, object] | None]:
    for summary in reversed(recent_invocations):
        part_kinds = summary.get("part_kinds")
        has_tool_parts = isinstance(part_kinds, list) and (
            "function_call" in part_kinds or "function_response" in part_kinds
        )
        turn_complete_count = summary.get("turn_complete_count")
        events_after_first_turn_complete = summary.get("events_after_first_turn_complete")
        user_content_after_turn_complete = summary.get("user_content_after_turn_complete")
        if (
            has_tool_parts
            and isinstance(turn_complete_count, int)
            and turn_complete_count > 1
        ):
            return True, summary
        if (
            has_tool_parts
            and isinstance(events_after_first_turn_complete, int)
            and events_after_first_turn_complete > 0
        ):
            return True, summary
        if has_tool_parts and user_content_after_turn_complete is True:
            return True, summary
    return False, None


async def _reset_adk_session_for_reconnect(
    *, session_record: SessionRecord
) -> AdkSessionSummary | None:
    await session_service.delete_session(
        app_name=APP_NAME,
        user_id=session_record.user_id,
        session_id=session_record.session_id,
    )
    await session_service.create_session(
        app_name=APP_NAME,
        user_id=session_record.user_id,
        session_id=session_record.session_id,
    )
    await _backfill_adk_conversation_memory_from_transcript(
        user_id=session_record.user_id,
        session_id=session_record.session_id,
    )
    return await _load_adk_session_summary(session_record, ensure_exists=False)


async def _load_adk_session_summary(
    session_record: SessionRecord, *, ensure_exists: bool
) -> AdkSessionSummary | None:
    adk_session = await session_service.get_session(
        app_name=APP_NAME,
        user_id=session_record.user_id,
        session_id=session_record.session_id,
    )
    if adk_session is None and ensure_exists:
        try:
            await session_service.create_session(
                app_name=APP_NAME,
                user_id=session_record.user_id,
                session_id=session_record.session_id,
            )
        except ValueError:
            logger.debug(
                "ADK session already existed during create race: %s",
                session_record.session_id,
            )
        adk_session = await session_service.get_session(
            app_name=APP_NAME,
            user_id=session_record.user_id,
            session_id=session_record.session_id,
        )

    summary = _summarize_adk_session(adk_session) if adk_session is not None else None
    try:
        session_store.update_adk_session_summary(session_record.session_id, summary)
    except KeyError:
        logger.warning(
            "Failed to sync ADK summary for missing session %s",
            session_record.session_id,
        )
    return summary


async def _warm_adk_session_summary(session_record: SessionRecord) -> None:
    try:
        await _load_adk_session_summary(session_record, ensure_exists=True)
    except Exception:  # pylint: disable=broad-except
        logger.exception(
            "Failed to warm ADK session summary for session_id=%s",
            session_record.session_id,
        )


def _is_record(value: object) -> bool:
    return isinstance(value, dict)


def _parse_json_candidate(value: str) -> object | None:
    stripped = value.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def _trim_conversation_memory(memory: str) -> str:
    normalized = memory.strip()
    if len(normalized) <= MAX_CONVERSATION_MEMORY_CHARS:
        return normalized
    tail = normalized[-(MAX_CONVERSATION_MEMORY_CHARS - 64) :].lstrip()
    return "[Older conversation truncated]\n\n" + tail


def _extract_turn_memory(entries: list[TranscriptEntryRecord]) -> tuple[str | None, str | None]:
    user_transcripts = [
        entry.content.strip()
        for entry in entries
        if entry.type == "user-transcription" and not entry.is_partial and entry.content.strip()
    ]
    user_texts = [
        entry.content.strip()
        for entry in entries
        if entry.type == "user-text" and not entry.is_partial and entry.content.strip()
    ]
    agent_transcripts = [
        entry.content.strip()
        for entry in entries
        if entry.type == "agent-transcription" and not entry.is_partial and entry.content.strip()
    ]
    agent_texts = [
        entry.content.strip()
        for entry in entries
        if entry.type == "agent-text" and not entry.is_partial and entry.content.strip()
    ]

    user_message = user_transcripts[-1] if user_transcripts else None
    if user_message is None and user_texts:
        user_message = "\n".join(user_texts)

    agent_message = agent_transcripts[-1] if agent_transcripts else None
    if agent_message is None and agent_texts:
        agent_message = "\n".join(agent_texts)

    return user_message, agent_message


def _build_memory_turn_block(entries: list[TranscriptEntryRecord]) -> str | None:
    user_message, agent_message = _extract_turn_memory(entries)
    turn_lines: list[str] = []
    if user_message:
        turn_lines.append(f"User: {user_message}")
    if agent_message:
        turn_lines.append(f"Agent: {agent_message}")
    turn_block = "\n".join(turn_lines).strip()
    return turn_block or None


async def _update_adk_conversation_memory(
    *,
    user_id: str,
    session_id: str,
    entries: list[TranscriptEntryRecord],
) -> None:
    user_message, agent_message = _extract_turn_memory(entries)
    turn_block = _build_memory_turn_block(entries)
    if not turn_block:
        return

    adk_session = await session_service.get_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
    )
    if adk_session is None:
        logger.warning(
            "Cannot update ADK conversation memory for missing session %s",
            session_id,
        )
        return

    existing_memory = adk_session.state.get(CONVERSATION_MEMORY_STATE_KEY)
    if not isinstance(existing_memory, str):
        existing_memory = ""

    updated_memory = turn_block if not existing_memory else f"{existing_memory}\n\n{turn_block}"
    updated_memory = _trim_conversation_memory(updated_memory)

    memory_event = Event(
        author="system",
        invocationId=f"memory-sync-{uuid4().hex}",
        actions=EventActions(
            stateDelta={
                CONVERSATION_MEMORY_STATE_KEY: updated_memory,
                LAST_USER_MESSAGE_STATE_KEY: user_message or "",
                LAST_AGENT_MESSAGE_STATE_KEY: agent_message or "",
            }
        ),
    )
    await session_service.append_event(adk_session, memory_event)


async def _backfill_adk_conversation_memory_from_transcript(
    *, user_id: str, session_id: str
) -> None:
    adk_session = await session_service.get_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
    )
    if adk_session is None:
        return

    existing_memory = adk_session.state.get(CONVERSATION_MEMORY_STATE_KEY)
    if isinstance(existing_memory, str) and existing_memory.strip():
        return

    turns = session_store.list_turns(session_id)
    turn_blocks = [
        turn_block
        for turn in turns
        if (turn_block := _build_memory_turn_block(turn.entries)) is not None
    ]
    if not turn_blocks:
        return

    memory_event = Event(
        author="system",
        invocationId=f"memory-backfill-{uuid4().hex}",
        actions=EventActions(
            stateDelta={
                CONVERSATION_MEMORY_STATE_KEY: _trim_conversation_memory(
                    "\n\n".join(turn_blocks)
                ),
                LAST_USER_MESSAGE_STATE_KEY: _extract_turn_memory(turns[-1].entries)[0] or "",
                LAST_AGENT_MESSAGE_STATE_KEY: _extract_turn_memory(turns[-1].entries)[1] or "",
            }
        ),
    )
    await session_service.append_event(adk_session, memory_event)


def _normalize_frontend_action(
    candidate: object,
    fallback_tool: str | None = None,
    fallback_job_id: str | None = None,
) -> dict[str, object] | None:
    if not _is_record(candidate):
        return None

    action_type = candidate.get("type")
    payload = candidate.get("payload")
    if not isinstance(action_type, str) or payload is None:
        return None

    source_tool = candidate.get("source_tool") or fallback_tool
    if not isinstance(source_tool, str) or not source_tool.strip():
        return None

    action: dict[str, object] = {
        "type": action_type,
        "source_tool": source_tool,
        "payload": payload,
    }

    job_id = candidate.get("job_id") or fallback_job_id
    if isinstance(job_id, str) and job_id.strip():
        action["job_id"] = job_id

    return action


def extract_frontend_action(raw_event: object) -> dict[str, object] | None:
    queue: list[tuple[object, str | None, str | None]] = [(raw_event, None, None)]
    seen: set[int] = set()

    while queue:
        current, fallback_tool, fallback_job_id = queue.pop(0)
        current_id = id(current)
        if current is None or current_id in seen:
            continue
        seen.add(current_id)

        if isinstance(current, str):
            parsed = _parse_json_candidate(current)
            if parsed is not None:
                queue.append((parsed, fallback_tool, fallback_job_id))
            continue

        action = _normalize_frontend_action(current, fallback_tool, fallback_job_id)
        if action is not None:
            return action

        if not _is_record(current):
            continue

        next_fallback_tool = fallback_tool
        tool_name = current.get("tool")
        if isinstance(tool_name, str) and tool_name.strip():
            next_fallback_tool = tool_name

        next_fallback_job_id = fallback_job_id
        job = current.get("job")
        if _is_record(job):
            job_id = job.get("id")
            if isinstance(job_id, str) and job_id.strip():
                next_fallback_job_id = job_id

        for key in (
            "frontend_action",
            "frontendAction",
            "payload",
            "data",
            "result",
            "output",
            "action",
            "content",
            "response",
        ):
            if key in current:
                queue.append(
                    (current[key], next_fallback_tool, next_fallback_job_id)
                )

        parts = current.get("parts")
        if isinstance(parts, list):
            for part in parts:
                queue.append((part, next_fallback_tool, next_fallback_job_id))

        code_execution_result = current.get("codeExecutionResult")
        if _is_record(code_execution_result):
            queue.append(
                (
                    code_execution_result,
                    next_fallback_tool,
                    next_fallback_job_id,
                )
            )
            output = code_execution_result.get("output")
            if isinstance(output, str):
                queue.append((output, next_fallback_tool, next_fallback_job_id))

        function_response = current.get("functionResponse")
        if _is_record(function_response):
            response_name = function_response.get("name")
            response_tool = (
                response_name if isinstance(response_name, str) and response_name.strip() else None
            )
            queue.append(
                (
                    function_response,
                    response_tool or next_fallback_tool,
                    next_fallback_job_id,
                )
            )

    return None


def _build_tool_result_message(result: dict[str, object]) -> dict[str, object]:
    return {
        "type": "tool_result",
        "result": result,
    }


def _summarize_live_tool_declarations() -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []
    for tool in getattr(agent, "tools", []) or []:
        tool_name = getattr(tool, "name", type(tool).__name__)
        declaration_getter = getattr(tool, "_get_declaration", None)
        if not callable(declaration_getter):
            summaries.append(
                {
                    "name": tool_name,
                    "declaration_available": False,
                }
            )
            continue
        try:
            declaration = declaration_getter()
            parameters = getattr(declaration, "parameters", None)
            properties = getattr(parameters, "properties", None)
            required = getattr(parameters, "required", None)
            summaries.append(
                {
                    "name": tool_name,
                    "declaration_available": True,
                    "property_names": sorted(list((properties or {}).keys())),
                    "required": list(required or []),
                }
            )
        except Exception as exc:  # pragma: no cover - debug aid
            summaries.append(
                {
                    "name": tool_name,
                    "declaration_available": False,
                    "declaration_error": f"{exc.__class__.__name__}: {exc}",
                }
            )
    return summaries


def _build_interpreter_lifecycle_action(
    lifecycle_event: dict[str, object],
) -> dict[str, object] | None:
    state = lifecycle_event.get("state")
    run_id = lifecycle_event.get("run_id")
    packet_window_id = lifecycle_event.get("packet_window_id")
    trace_file = lifecycle_event.get("trace_file")
    error = lifecycle_event.get("error")

    if (
        not isinstance(state, str)
        or not isinstance(run_id, str)
        or not run_id.strip()
        or not isinstance(packet_window_id, str)
        or not packet_window_id.strip()
    ):
        return None

    payload: dict[str, object] = {
        "state": state,
        "run_id": run_id,
        "packet_window_id": packet_window_id,
    }
    if isinstance(trace_file, str) and trace_file.strip():
        payload["trace_file"] = trace_file
    if isinstance(error, str) and error.strip():
        payload["error"] = error.strip()

    if state == "started":
        payload["title"] = "Understanding your progress"
        payload["message"] = "Using your latest canvas work to guide the lesson"
    elif state == "failed":
        payload["title"] = "Couldn't read the latest canvas change"
        payload["message"] = "The tutor could not interpret the latest update just now"

    return {
        "type": INTERPRETER_LIFECYCLE_ACTION,
        "source_tool": INTERPRETER_REASONING_SOURCE_TOOL,
        "job_id": run_id,
        "payload": payload,
    }


def _normalize_frontend_ack(candidate: object) -> dict[str, str] | None:
    if not _is_record(candidate):
        return None

    status = candidate.get("status")
    action_type = candidate.get("action_type")
    source_tool = candidate.get("source_tool")
    summary = candidate.get("summary")

    if not isinstance(status, str) or not isinstance(action_type, str):
        return None
    if not isinstance(source_tool, str) or not source_tool.strip():
        return None

    normalized: dict[str, str] = {
        "status": status,
        "action_type": action_type,
        "source_tool": source_tool,
    }
    if isinstance(summary, str) and summary.strip():
        normalized["summary"] = summary.strip()

    job_id = candidate.get("job_id")
    if isinstance(job_id, str) and job_id.strip():
        normalized["job_id"] = job_id.strip()

    return normalized


def _normalize_canvas_activity_window(
    candidate: object,
) -> InterpreterCanvasWindow | None:
    if not _is_record(candidate):
        return None
    try:
        return InterpreterCanvasWindow.model_validate(candidate)
    except Exception:
        logger.exception("Failed to parse canvas activity window payload")
        return None


def _extract_flashcard_grounding(snapshot: dict[str, object] | None) -> dict[str, str | None]:
    current_card = snapshot.get("current_card") if isinstance(snapshot, dict) else None
    next_card = snapshot.get("next_card") if isinstance(snapshot, dict) else None

    current_question = (
        current_card.get("front")
        if isinstance(current_card, dict) and isinstance(current_card.get("front"), str)
        else None
    )
    current_answer = (
        current_card.get("back")
        if isinstance(current_card, dict) and isinstance(current_card.get("back"), str)
        else None
    )
    next_question = (
        next_card.get("front")
        if isinstance(next_card, dict) and isinstance(next_card.get("front"), str)
        else None
    )

    return {
        "current_question": current_question.strip() if current_question else None,
        "current_answer": current_answer.strip() if current_answer else None,
        "next_question": next_question.strip() if next_question else None,
    }


def _build_flashcard_show_grounding_suffix(snapshot: dict[str, object] | None) -> str:
    grounding = _extract_flashcard_grounding(snapshot)
    parts: list[str] = []

    current_question = grounding["current_question"]
    if current_question:
        parts.append(f"Current question: {current_question}.")

    current_answer = grounding["current_answer"]
    if current_answer:
        parts.append(f"Current answer: {current_answer}.")

    next_question = grounding["next_question"]
    if next_question:
        parts.append(f"Following question: {next_question}.")

    return " ".join(parts)


def _apply_flashcard_ack_state(
    ack: dict[str, str], user_id: str, session_id: str
) -> str | None:
    action_type = ack["action_type"]
    status = ack["status"]

    if not action_type.startswith("flashcards."):
        return None

    if status == "failed":
        return None

    if status != "applied":
        return None

    if action_type == "flashcards.show":
        snapshot = flashcard_session_store.mark_deck_rendered(
            user_id=user_id,
            session_id=session_id,
        )
        grounding_suffix = _build_flashcard_show_grounding_suffix(snapshot)
        if grounding_suffix:
            return (
                "The flashcards are now visible in the UI. "
                f"{grounding_suffix} "
                "Ask the learner exactly the current visible question, and do not "
                "reveal the answer or following card yet."
            )
        return "The flashcards are now visible in the UI."

    if action_type == "flashcards.reveal_answer":
        flashcard_session_store.mark_answer_rendered(
            user_id=user_id,
            session_id=session_id,
        )
        return None

    if action_type == "flashcards.next":
        flashcard_session_store.mark_next_rendered(
            user_id=user_id,
            session_id=session_id,
        )
        return None

    if action_type == "flashcards.clear":
        return None

    return None


def _apply_canvas_ack_state(ack: dict[str, str]) -> str | None:
    action_type = ack["action_type"]
    status = ack["status"]
    source_tool = ack.get("source_tool")

    if status != "applied":
        return None

    if (
        action_type == "canvas.context_requested"
        and source_tool == CANVAS_GENERATE_VISUAL_TOOL
    ):
        return None

    if (
        action_type == "canvas.context_requested"
        and source_tool in {CANVAS_GENERATE_GRAPH_TOOL, CANVAS_GENERATE_NOTATION_TOOL}
    ):
        return None

    if (
        action_type == "canvas.delegate_requested"
        and source_tool == CANVAS_DELEGATE_TASK_TOOL
    ):
        return None

    if action_type == "canvas.insert_widget":
        summary = ack.get("summary")
        if summary:
            return (
                "The widget is now inserted on the canvas. "
                f"{summary} "
                "Explain what the generated widget shows and how it relates to the "
                "current topic. Do not ask a new question or introduce a new topic."
            )
        return (
            "The widget is now inserted on the canvas. "
            "Explain what the generated widget shows and how it relates to the "
            "current topic. Do not ask a new question or introduce a new topic."
        )

    if action_type != "canvas.insert_visual":
        return None

    summary = ack.get("summary")
    if summary:
        return (
            "The visual is now inserted on the canvas. "
            f"{summary} "
            "Explain what the generated visual shows and how it relates to the "
            "current topic. Do not ask a new question or introduce a new topic."
        )
    return (
        "The visual is now inserted on the canvas. "
        "Explain what the generated visual shows and how it relates to the "
        "current topic. Do not ask a new question or introduce a new topic."
    )


def _build_background_tool_semantic_update(result: dict[str, object]) -> str | None:
    status = result.get("status")
    tool = result.get("tool")
    summary = result.get("summary")

    if status != "failed" or not isinstance(tool, str):
        return None

    normalized_summary = (
        summary.strip() if isinstance(summary, str) and summary.strip() else None
    )

    if tool == CANVAS_GENERATE_VISUAL_TOOL:
        reason = normalized_summary or "The visual could not be generated."
        return (
            "The `canvas.generate_visual` job failed. "
            f"Reason: {reason} "
            "Decide whether to retry with a clearer brief, ask a clarifying "
            "question, or use another teaching strategy."
        )

    if tool in {CANVAS_GENERATE_GRAPH_TOOL, CANVAS_GENERATE_NOTATION_TOOL}:
        reason = normalized_summary or "The widget could not be generated."
        return (
            f"The `{tool}` job failed. "
            f"Reason: {reason} "
            "Decide whether to retry with a clearer prompt, ask a clarifying "
            "question, or continue teaching without the widget."
        )

    if tool == CANVAS_DELEGATE_TASK_TOOL:
        reason = normalized_summary or "The delegated canvas task did not complete."
        return (
            "The `canvas.delegate_task` job failed. "
            f"Reason: {reason} "
            "Choose the next best tutoring step instead of assuming the canvas was updated."
        )

    if tool == FLASHCARDS_CREATE_TOOL:
        reason = normalized_summary or "The flashcards could not be created."
        return (
            "The `flashcards.create` job failed. "
            f"Reason: {reason} "
            "Decide whether to retry, ask a clarifying question, or continue "
            "teaching without a flashcard deck."
        )

    return None


def _build_canvas_delegate_result(
    *,
    status: str,
    job_id: str,
    summary: str,
    payload: dict[str, object] | None = None,
) -> dict[str, object]:
    result: dict[str, object] = {
        "status": status,
        "tool": CANVAS_DELEGATE_TASK_TOOL,
        "summary": summary,
        "job": {"id": job_id},
    }
    if payload is not None:
        result["payload"] = payload
    return result

# ========================================
# Phase 1: Application Initialization (once at startup)
# ========================================

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static files
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Define your session services
session_service = create_adk_session_service()
session_store = create_session_store()
recording_store = SessionRecordingStore(Path(__file__).parent / "data" / "session_recordings")
key_moment_store = create_key_moment_store(
    Path(__file__).parent / "data" / "session_key_moments"
)
notes_store = create_notes_store(Path(__file__).parent / "data" / "session_notes")
replay_status_store = create_replay_status_store(
    Path(__file__).parent / "data" / "session_replay_status"
)
pending_replay_jobs: set[tuple[str, str]] = set()
replay_job_tasks: set[asyncio.Task[None]] = set()

# Define your runner
runner = Runner(app_name=APP_NAME, agent=agent, session_service=session_service)


def _parse_range_header(range_header: str, content_size: int) -> tuple[int, int]:
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Invalid range unit")

    ranges = range_header[len("bytes=") :].split(",", maxsplit=1)
    range_value = ranges[0].strip()
    if "-" not in range_value:
        raise HTTPException(status_code=416, detail="Invalid byte range")

    start_str, end_str = range_value.split("-", maxsplit=1)
    if not start_str and not end_str:
        raise HTTPException(status_code=416, detail="Invalid byte range")

    if not start_str:
        suffix_length = int(end_str)
        if suffix_length <= 0:
            raise HTTPException(status_code=416, detail="Invalid byte range")
        start = max(content_size - suffix_length, 0)
        end = content_size - 1
        return start, end

    start = int(start_str)
    if start < 0 or start >= content_size:
        raise HTTPException(status_code=416, detail="Requested range not satisfiable")

    if end_str:
        end = min(int(end_str), content_size - 1)
        if end < start:
            raise HTTPException(status_code=416, detail="Requested range not satisfiable")
        return start, end

    return start, content_size - 1


def _build_session_replay_status(
    session: SessionRecord, *, persist: bool
) -> SessionReplayStatus:
    transcript = session_store.list_turns(session.session_id)
    manifest = recording_store.get_manifest(session.session_id)
    key_moment_artifact = key_moment_store.get_artifact(session.session_id)
    notes_artifact = notes_store.get_artifact(session.session_id)
    status = replay_status_store.get_status(session.session_id) or default_replay_status(
        session.session_id
    )

    status.transcript_turn_count = len(transcript)
    status.transcript_status = "ready" if session.status == "completed" else "idle"
    status.video_segment_count = len(manifest.segments)

    if manifest.final_relative_path:
        status.video_status = "ready"
        status.video_error = None
    elif manifest.status == "processing":
        status.video_status = "processing"
        status.video_error = None
    elif manifest.status == "failed" or manifest.error:
        status.video_status = "failed"
        status.video_error = manifest.error
    elif session.status == "completed" and manifest.segments:
        if status.video_status not in {"failed", "processing"}:
            status.video_status = "pending"
            status.video_error = None
    elif session.status == "completed":
        status.video_status = "unavailable"
        status.video_error = None
    else:
        status.video_status = "idle"
        status.video_error = None

    if key_moment_artifact is not None:
        status.key_moments_status = "ready"
        status.key_moment_count = len(key_moment_artifact.key_moments)
        status.key_moments_error = None
    elif session.status == "completed" and transcript:
        if status.key_moments_status not in {"failed", "processing"}:
            status.key_moments_status = "pending"
            status.key_moment_count = 0
            status.key_moments_error = None
    elif session.status == "completed":
        status.key_moments_status = "unavailable"
        status.key_moment_count = 0
        status.key_moments_error = None
    else:
        status.key_moments_status = "idle"
        status.key_moment_count = 0
        status.key_moments_error = None

    if notes_artifact is not None:
        status.notes_status = "ready"
        status.notes_error = None
    elif session.status == "completed" and transcript:
        if status.notes_status not in {"failed", "processing"}:
            status.notes_status = "pending"
            status.notes_error = None
    elif session.status == "completed":
        status.notes_status = "unavailable"
        status.notes_error = None
    else:
        status.notes_status = "idle"
        status.notes_error = None

    if persist and status.requested_at is None and session.status == "completed":
        status.requested_at = datetime.now(timezone.utc).isoformat()

    status.replay_status = compute_replay_status(status)
    if persist:
        return replay_status_store.save_status(status)
    return status


def _refresh_session_replay_status(session: SessionRecord) -> SessionReplayStatus:
    return _build_session_replay_status(session, persist=True)


def _read_session_replay_status(session: SessionRecord) -> SessionReplayStatus:
    return _build_session_replay_status(session, persist=False)


async def _delete_session_everywhere(session: SessionRecord) -> None:
    key_moment_store.delete_artifact(session.session_id)
    notes_store.delete_artifact(session.session_id)
    replay_status_store.delete_status(session.session_id)
    recording_store.delete_session(session.session_id)
    session_store.delete_session(session.session_id)
    flashcard_session_store.clear(user_id=session.user_id, session_id=session.session_id)
    await canvas_delegate_job_store.clear_session(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    await canvas_snapshot_session_bridge_store.clear_bridge(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    canvas_context_request_store.clear_session(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    await canvas_placement_context_store.clear_context(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    await interpreter_packet_store.clear_session(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    await interpreter_reasoning_store.clear_session(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    await interpreter_snapshot_job_store.clear_session(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    try:
        await session_service.delete_session(
            app_name=APP_NAME,
            user_id=session.user_id,
            session_id=session.session_id,
        )
    except Exception:
        logger.exception("Failed to delete ADK session state for session_id=%s", session.session_id)


def _enqueue_replay_job(
    session_id: str,
    job_name: str,
    coroutine_factory,
) -> None:
    job_key = (session_id, job_name)
    if job_key in pending_replay_jobs:
        return

    pending_replay_jobs.add(job_key)

    async def runner_wrapper() -> None:
        try:
            await coroutine_factory()
        finally:
            pending_replay_jobs.discard(job_key)

    task = asyncio.create_task(
        runner_wrapper(),
        name=f"replay-{job_name}-{session_id}",
    )
    replay_job_tasks.add(task)
    task.add_done_callback(replay_job_tasks.discard)


async def _run_recording_finalize_job(session_id: str) -> None:
    replay_status_store.merge_status(
        session_id,
        requested_at=datetime.now(timezone.utc).isoformat(),
        video_status="processing",
        video_error=None,
    )
    try:
        manifest = await asyncio.to_thread(recording_store.finalize_session, session_id)
    except ValueError:
        replay_status_store.merge_status(
            session_id,
            video_status="unavailable",
            video_error=None,
            video_segment_count=0,
        )
        return
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Replay video finalize job failed for session_id=%s", session_id)
        replay_status_store.merge_status(
            session_id,
            video_status="failed",
            video_error=str(exc),
        )
        return

    replay_status_store.merge_status(
        session_id,
        video_status="ready",
        video_error=None,
        video_segment_count=len(manifest.segments),
    )


async def _run_key_moment_job(session_id: str) -> None:
    replay_status_store.merge_status(
        session_id,
        requested_at=datetime.now(timezone.utc).isoformat(),
        key_moments_status="processing",
        key_moments_error=None,
    )

    session = session_store.get_session(session_id)
    if session is None:
        replay_status_store.merge_status(
            session_id,
            key_moments_status="failed",
            key_moments_error="Session not found",
        )
        return

    transcript = session_store.list_turns(session_id)
    if not transcript:
        replay_status_store.merge_status(
            session_id,
            key_moments_status="unavailable",
            key_moments_error=None,
            key_moment_count=0,
        )
        return

    try:
        response = await generate_key_moment_response(
            session=session,
            transcript=transcript,
        )
        key_moment_store.save_artifact(response.artifact)
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Key moment job failed for session_id=%s", session_id)
        replay_status_store.merge_status(
            session_id,
            key_moments_status="failed",
            key_moments_error=str(exc),
            key_moment_count=0,
        )
        return

    replay_status_store.merge_status(
        session_id,
        key_moments_status="ready",
        key_moments_error=None,
        key_moment_count=len(response.artifact.key_moments),
    )


async def _run_notes_job(session_id: str) -> None:
    replay_status_store.merge_status(
        session_id,
        requested_at=datetime.now(timezone.utc).isoformat(),
        notes_status="processing",
        notes_error=None,
    )

    session = session_store.get_session(session_id)
    if session is None:
        replay_status_store.merge_status(
            session_id,
            notes_status="failed",
            notes_error="Session not found",
        )
        return

    transcript = session_store.list_turns(session_id)
    if not transcript:
        replay_status_store.merge_status(
            session_id,
            notes_status="unavailable",
            notes_error=None,
        )
        return

    try:
        artifact = await generate_session_notes_artifact(
            session=session,
            transcript=transcript,
        )
        notes_store.save_artifact(artifact)
    except Exception as exc:  # pylint: disable=broad-except
        logger.exception("Notes job failed for session_id=%s", session_id)
        replay_status_store.merge_status(
            session_id,
            notes_status="failed",
            notes_error=str(exc),
        )
        return

    replay_status_store.merge_status(
        session_id,
        notes_status="ready",
        notes_error=None,
    )


def _trigger_session_replay_jobs(session: SessionRecord) -> SessionReplayStatus:
    transcript = session_store.list_turns(session.session_id)
    manifest = recording_store.get_manifest(session.session_id)
    replay_status_store.merge_status(
        session.session_id,
        requested_at=datetime.now(timezone.utc).isoformat(),
        transcript_status="ready",
        transcript_turn_count=len(transcript),
        video_status="pending" if manifest.segments else "unavailable",
        video_segment_count=len(manifest.segments),
        video_error=None,
        key_moments_status="pending" if transcript else "unavailable",
        key_moment_count=0,
        key_moments_error=None,
        notes_status="pending" if transcript else "unavailable",
        notes_error=None,
    )

    if manifest.segments:
        _enqueue_replay_job(
            session.session_id,
            "video",
            lambda: _run_recording_finalize_job(session.session_id),
        )
    if transcript:
        _enqueue_replay_job(
            session.session_id,
            "key-moments",
            lambda: _run_key_moment_job(session.session_id),
        )
        _enqueue_replay_job(
            session.session_id,
            "notes",
            lambda: _run_notes_job(session.session_id),
        )

    return _refresh_session_replay_status(session)

# ========================================
# HTTP Endpoints
# ========================================


@app.get("/")
async def root():
    """Serve the index.html page."""
    return FileResponse(Path(__file__).parent / "static" / "index.html")


@app.get("/v1/sessions", response_model=SessionListResponse)
async def list_sessions(user_id: str | None = Query(default=None, alias="userId")):
    """List session metadata for the dashboard."""
    return SessionListResponse(sessions=session_store.list_sessions(user_id))


@app.post("/v1/sessions", response_model=SessionRecord, status_code=201)
async def create_session(request: SessionCreateRequest):
    """Create a new session record and initialize ADK session state."""
    try:
        session = session_store.create_session(request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    asyncio.create_task(_warm_adk_session_summary(session))
    return session


@app.get("/v1/sessions/{session_id}", response_model=SessionRecord)
async def get_session(session_id: str):
    """Return session metadata without replay/adk hydration."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.delete("/v1/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete one session and all persisted artifacts tied to it."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    await _delete_session_everywhere(session)
    return {
        "deleted": True,
        "sessionId": session_id,
    }


@app.delete("/v1/sessions")
async def delete_sessions_for_user(
    user_id: str = Query(alias="userId"),
    confirm: bool = Query(default=False),
):
    """Delete every session for a user and all persisted artifacts tied to them."""
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Pass confirm=true to delete all sessions for this user",
        )

    sessions = session_store.list_sessions(user_id)
    for session in sessions:
        await _delete_session_everywhere(session)

    return {
        "deleted": True,
        "userId": user_id,
        "deletedCount": len(sessions),
        "sessionIds": [session.session_id for session in sessions],
    }


@app.get("/v1/sessions/{session_id}/resume", response_model=SessionResumeResponse)
async def resume_session(session_id: str):
    """Return session metadata, latest checkpoint, transcript, and ADK memory summary."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    await _backfill_adk_conversation_memory_from_transcript(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    adk_session = await _load_adk_session_summary(session, ensure_exists=False)
    refreshed_session = session_store.get_session(session_id) or session
    transcript = session_store.list_turns(session_id)
    return SessionResumeResponse(
        session=refreshed_session,
        latest_checkpoint=session_store.get_latest_checkpoint(session_id),
        transcript=transcript,
        adk_session=adk_session,
    )


@app.get("/v1/sessions/{session_id}/transcript", response_model=list[TranscriptTurnRecord])
async def get_session_transcript(session_id: str):
    """Return the persisted transcript turns for a ThinkSpace session."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return session_store.list_turns(session_id)


@app.get("/v1/sessions/{session_id}/transcript-export")
async def export_session_transcript(session_id: str):
    """Return a downloadable JSON export of the persisted session transcript."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    transcript = session_store.list_turns(session_id)
    payload = {
        "sessionId": session.session_id,
        "userId": session.user_id,
        "topic": session.topic,
        "goal": session.goal,
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "transcript": [turn.model_dump(mode="json", by_alias=True) for turn in transcript],
    }
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": (
                f'attachment; filename="session-{session.session_id}-transcript.json"'
            )
        },
    )


@app.get(
    "/v1/sessions/{session_id}/key-moments",
    response_model=SessionKeyMomentArtifact,
)
async def get_session_key_moments(session_id: str):
    """Return the generated key moment artifact for a session."""

    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    artifact = key_moment_store.get_artifact(session_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Key moments not found")

    return artifact


@app.get(
    "/v1/sessions/{session_id}/notes",
    response_model=SessionNotesArtifact,
)
async def get_session_notes(session_id: str):
    """Return the generated session notes artifact for a session."""

    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    artifact = notes_store.get_artifact(session_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="Session notes not found")

    return artifact


@app.get(
    "/v1/sessions/{session_id}/replay-status",
    response_model=SessionReplayStatus,
)
async def get_session_replay_status(session_id: str):
    """Return replay artifact readiness for a session."""

    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return _read_session_replay_status(session)


@app.post(
    "/v1/sessions/replay-status:batch",
    response_model=SessionReplayStatusBatchResponse,
)
async def get_session_replay_status_batch(request: SessionReplayStatusBatchRequest):
    """Return replay artifact readiness for multiple sessions."""
    statuses: list[SessionReplayStatus] = []
    seen_session_ids: set[str] = set()
    for session_id in request.session_ids:
        normalized_session_id = session_id.strip()
        if not normalized_session_id or normalized_session_id in seen_session_ids:
            continue
        seen_session_ids.add(normalized_session_id)
        session = session_store.get_session(normalized_session_id)
        if session is None:
            continue
        statuses.append(_read_session_replay_status(session))
    return SessionReplayStatusBatchResponse(statuses=statuses)


@app.post(
    "/v1/sessions/{session_id}/notes:generate",
    response_model=SessionNotesArtifact,
)
async def generate_session_notes(session_id: str):
    """Generate and persist markdown notes from the session transcript."""

    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    transcript = session_store.list_turns(session_id)
    if not transcript:
        raise HTTPException(status_code=422, detail="Transcript not found for this session")

    try:
        artifact = await generate_session_notes_artifact(
            session=session,
            transcript=transcript,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Notes generation failed for session_id=%s",
            session_id,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Notes generation failed: {exc}",
        ) from exc

    notes_store.save_artifact(artifact)
    replay_status_store.merge_status(
        session_id,
        transcript_status="ready",
        transcript_turn_count=len(transcript),
        notes_status="ready",
        notes_error=None,
    )
    return artifact


@app.post(
    "/v1/sessions/{session_id}/key-moments:generate",
    response_model=KeyMomentGenerationResponse,
)
async def generate_session_key_moments(
    session_id: str,
    include_debug: bool = Query(default=False, alias="includeDebug"),
):
    """Generate and persist key moments from the session transcript."""

    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    transcript = session_store.list_turns(session_id)
    if not transcript:
        raise HTTPException(status_code=422, detail="Transcript not found for this session")

    try:
        response = await generate_key_moment_response(
            session=session,
            transcript=transcript,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Key moment generation failed for session_id=%s",
            session_id,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Key moment generation failed: {exc}",
        ) from exc

    key_moment_store.save_artifact(response.artifact)
    replay_status_store.merge_status(
        session_id,
        transcript_status="ready",
        transcript_turn_count=len(transcript),
        key_moments_status="ready",
        key_moment_count=len(response.artifact.key_moments),
        key_moments_error=None,
    )
    if not include_debug:
        response.debug = None
    return response


@app.get(
    "/v1/sessions/{session_id}/recordings",
    response_model=SessionRecordingManifest,
)
async def get_session_recordings(session_id: str):
    """Return local recording segment metadata for a session."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return recording_store.get_manifest(session_id)


@app.post(
    "/v1/sessions/{session_id}/recordings/segments",
    response_model=SessionRecordingManifest,
    status_code=201,
)
async def upload_session_recording_segment(
    session_id: str,
    video: UploadFile = File(...),
    started_at: str | None = Form(default=None, alias="startedAt"),
    ended_at: str | None = Form(default=None, alias="endedAt"),
):
    """Persist one browser-recorded session segment to local storage."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    file_bytes = await video.read()
    if not file_bytes:
        raise HTTPException(status_code=422, detail="Recording upload was empty")

    return recording_store.save_segment(
        session_id=session_id,
        file_bytes=file_bytes,
        original_filename=video.filename,
        mime_type=video.content_type,
        started_at=started_at,
        ended_at=ended_at,
    )


@app.post(
    "/v1/sessions/{session_id}/recordings/finalize",
    response_model=SessionRecordingManifest,
)
async def finalize_session_recordings(session_id: str):
    """Merge all session segments into one replay video."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    try:
        manifest = recording_store.finalize_session(session_id)
    except ValueError as exc:
        replay_status_store.merge_status(
            session_id,
            video_status="unavailable",
            video_error=None,
            video_segment_count=0,
        )
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        replay_status_store.merge_status(
            session_id,
            video_status="failed",
            video_error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    replay_status_store.merge_status(
        session_id,
        video_status="ready",
        video_error=None,
        video_segment_count=len(manifest.segments),
    )
    return manifest


@app.get("/v1/sessions/{session_id}/recordings/final")
async def get_session_recording_final(session_id: str, request: Request):
    """Serve the merged session replay video if available."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    manifest = recording_store.get_manifest(session_id)
    content_size = recording_store.get_final_video_size(session_id)
    if content_size is None or not manifest.final_mime_type:
        raise HTTPException(status_code=404, detail="Final replay video not found")

    range_header = request.headers.get("range")
    if range_header:
        start, end = _parse_range_header(range_header, content_size)
        final_bytes = recording_store.get_final_video_bytes(
            session_id,
            start=start,
            end=end,
        )
        if final_bytes is None:
            raise HTTPException(status_code=404, detail="Final replay video not found")
        return Response(
            content=final_bytes,
            media_type=manifest.final_mime_type,
            status_code=206,
            headers={
                "Accept-Ranges": "bytes",
                "Content-Range": f"bytes {start}-{end}/{content_size}",
                "Content-Length": str(len(final_bytes)),
            },
        )

    final_path = recording_store.get_final_video_path(session_id)
    if final_path is not None:
        response = FileResponse(final_path, media_type=manifest.final_mime_type)
        response.headers["Accept-Ranges"] = "bytes"
        return response

    final_bytes = recording_store.get_final_video_bytes(session_id)
    if final_bytes is None:
        raise HTTPException(status_code=404, detail="Final replay video not found")

    return Response(
        content=final_bytes,
        media_type=manifest.final_mime_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_size),
        },
    )


@app.get("/v1/sessions/{session_id}/adk-debug")
async def get_adk_session_debug(session_id: str):
    """Inspect the current official ADK session state for a ThinkSpace session."""
    session = session_store.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    interpreter_packet = await interpreter_packet_store.get_packet(
        user_id=session.user_id,
        session_id=session.session_id,
    )
    interpreter_reasoning = await interpreter_reasoning_store.get_snapshot(
        user_id=session.user_id,
        session_id=session.session_id,
    )

    adk_session = await session_service.get_session(
        app_name=APP_NAME,
        user_id=session.user_id,
        session_id=session.session_id,
    )
    if adk_session is None:
        return {
            "sessionId": session_id,
            "thinkspaceUserId": session.user_id,
            "adkSessionExists": False,
            "interpreterPacket": interpreter_packet,
            "interpreterReasoning": interpreter_reasoning,
            "message": "No ADK session found for this ThinkSpace session",
        }

    state = getattr(adk_session, "state", {}) or {}
    events = getattr(adk_session, "events", []) or []
    conversation_memory = state.get(CONVERSATION_MEMORY_STATE_KEY)
    if not isinstance(conversation_memory, str):
        conversation_memory = None

    return {
        "sessionId": session_id,
        "thinkspaceUserId": session.user_id,
        "adkSessionExists": True,
        "adkSummary": _summarize_adk_session(adk_session).model_dump(by_alias=True),
        "stateKeys": sorted(state.keys()),
        "conversationMemory": conversation_memory,
        "lastUserMessage": state.get(LAST_USER_MESSAGE_STATE_KEY),
        "lastAgentMessage": state.get(LAST_AGENT_MESSAGE_STATE_KEY),
        "interpreterPacket": interpreter_packet,
        "interpreterReasoning": interpreter_reasoning,
        "recentEvents": [
            _serialize_adk_event_for_debug(event)
            for event in events[-10:]
        ],
    }


@app.post(
    "/v1/sessions/{session_id}/checkpoints",
    response_model=CheckpointRecord,
    status_code=201,
)
async def create_checkpoint(session_id: str, request: CheckpointCreateRequest):
    """Store a dummy checkpoint payload for session-management scaffolding."""
    try:
        return session_store.create_checkpoint(session_id, request)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc


@app.post("/v1/sessions/{session_id}/complete", response_model=SessionRecord)
async def complete_session(session_id: str):
    """Mark a session as completed."""
    try:
        session = session_store.complete_session(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Session not found") from exc
    _trigger_session_replay_jobs(session)
    return session


@app.post(
    "/v1/dev/widgets/reason",
    response_model=WidgetReasonerResponse,
)
async def reason_widget_preview(request: WidgetReasonerRequest):
    """Generate a widget spec for the frontend playground."""

    try:
        return await asyncio.to_thread(reason_widget, request)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "Widget reasoner failed for widget_type=%s",
            request.widget_type,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Widget reasoner failed: {exc}",
        ) from exc


# ========================================
# WebSocket Endpoint
# ========================================


@app.websocket("/ws/{user_id}/{session_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    user_id: str,
    session_id: str,
    proactivity: bool = False,
    affective_dialog: bool = False,
) -> None:
    """WebSocket endpoint for bidirectional streaming with ADK.

    Args:
        websocket: The WebSocket connection
        user_id: User identifier
        session_id: Session identifier
        proactivity: Enable proactive audio (native audio models only)
        affective_dialog: Enable affective dialog (native audio models only)
    """
    session_record = session_store.get_session(session_id)
    if session_record is None:
        await websocket.close(code=4404, reason="Session not found")
        return

    requested_user_id = user_id
    user_id = session_record.user_id
    logger.info(
        "WebSocket session starting: requested_user_id=%s resolved_user_id=%s session_id=%s "
        "proactivity=%s affective_dialog=%s",
        requested_user_id,
        user_id,
        session_id,
        proactivity,
        affective_dialog,
    )
    await websocket.accept()
    logger.info("WebSocket accepted for session_id=%s", session_id)

    # ========================================
    # Phase 2: Session Initialization (once per streaming session)
    # ========================================

    # Automatically determine response modality based on model architecture
    # Native audio models (containing "native-audio" in name)
    # ONLY support AUDIO response modality.
    # Half-cascade models support both TEXT and AUDIO,
    # we default to TEXT for better performance.
    model_name = agent.model
    is_native_audio = "native-audio" in model_name.lower()

    if is_native_audio:
        # Native audio models require AUDIO response modality
        # with audio transcription
        response_modalities = ["AUDIO"]

        # Build RunConfig with optional proactivity and affective dialog
        # These features are only supported on native audio models
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=response_modalities,
            input_audio_transcription=types.AudioTranscriptionConfig(),
            output_audio_transcription=types.AudioTranscriptionConfig(),
            session_resumption=types.SessionResumptionConfig(),
            proactivity=(
                types.ProactivityConfig(proactive_audio=True) if proactivity else None
            ),
            enable_affective_dialog=affective_dialog if affective_dialog else None,
        )
        logger.debug(
            f"Native audio model detected: {model_name}, "
            f"using AUDIO response modality, "
            f"proactivity={proactivity}, affective_dialog={affective_dialog}"
        )
    else:
        # Half-cascade models support TEXT response modality
        # for faster performance
        response_modalities = ["TEXT"]
        run_config = RunConfig(
            streaming_mode=StreamingMode.BIDI,
            response_modalities=response_modalities,
            input_audio_transcription=None,
            output_audio_transcription=None,
            session_resumption=types.SessionResumptionConfig(),
        )
        logger.debug(
            f"Half-cascade model detected: {model_name}, "
            "using TEXT response modality"
        )
        # Warn if user tried to enable native-audio-only features
        if proactivity or affective_dialog:
            logger.warning(
                f"Proactivity and affective dialog are only supported on native "
                f"audio models. Current model: {model_name}. "
                f"These settings will be ignored."
            )
    logger.debug(f"RunConfig created: {run_config}")

    # Ensure the product session stays linked to a durable ADK session.
    await _load_adk_session_summary(session_record, ensure_exists=True)
    await _backfill_adk_conversation_memory_from_transcript(
        user_id=user_id,
        session_id=session_id,
    )
    await _load_adk_session_summary(session_record, ensure_exists=False)
    adk_session_before_live = await session_service.get_session(
        app_name=APP_NAME,
        user_id=user_id,
        session_id=session_id,
    )
    adk_events_before_live = (
        list(getattr(adk_session_before_live, "events", []) or [])
        if adk_session_before_live is not None
        else []
    )
    adk_session_state_before_live = (
        getattr(adk_session_before_live, "state", {}) if adk_session_before_live else {}
    )
    conversation_memory = (
        adk_session_state_before_live.get("conversation_memory")
        if isinstance(adk_session_state_before_live, dict)
        else None
    )
    static_instruction_text = get_static_instruction_text()
    final_instruction_text = build_instruction_text(
        conversation_memory if isinstance(conversation_memory, str) else None
    )
    tool_declaration_summaries = _summarize_live_tool_declarations()
    logger.info(
        "Live handshake payload summary: session_id=%s model=%s static_instruction_len=%s memory_chars=%s final_instruction_len=%s tool_count=%s tools=%s",
        session_id,
        model_name,
        len(static_instruction_text),
        (
            len(conversation_memory.strip())
            if isinstance(conversation_memory, str) and conversation_memory.strip()
            else 0
        ),
        len(final_instruction_text),
        len(tool_declaration_summaries),
        json.dumps(tool_declaration_summaries, ensure_ascii=True),
    )
    recent_non_memory_invocations = _summarize_recent_non_memory_invocations_for_debug(
        adk_events_before_live
    )
    disable_session_resumption, unsafe_invocation = _has_unsafe_resumable_invocation(
        recent_non_memory_invocations
    )
    if disable_session_resumption:
        await _reset_adk_session_for_reconnect(session_record=session_record)

    live_request_queue = LiveRequestQueue()
    shutdown_started = asyncio.Event()
    flashcard_background_result_queue = await flashcard_job_outbox.subscribe(
        user_id, session_id
    )
    canvas_background_result_queue = await canvas_visual_job_outbox.subscribe(
        user_id, session_id
    )
    canvas_widget_background_result_queue = await canvas_widget_job_outbox.subscribe(
        user_id, session_id
    )
    canvas_delegate_background_result_queue = await canvas_delegate_job_outbox.subscribe(
        user_id, session_id
    )

    # Transcript persistence: shared buffer and lock for upstream/downstream
    transcript_buffer: list[TranscriptEntryRecord] = []
    transcript_lock = asyncio.Lock()
    existing_turns = session_store.list_turns(session_id)
    turn_sequence = len(existing_turns)
    activity_clock = asyncio.get_running_loop()
    user_speaking_active = False
    last_user_activity_at: float | None = None
    last_delivered_interpreter_at: float | None = None
    last_delivered_interpreter_key: str | None = None
    latest_closed_canvas_window_id: str | None = None
    pending_interpreter_delivery_result: dict[str, object] | None = None
    pending_interpreter_delivery_task: asyncio.Task[None] | None = None

    async def _add_transcript_entry(
        entry_type: str, content: str, is_partial: bool = False
    ) -> None:
        """Append entry to transcript buffer."""
        async with transcript_lock:
            transcript_buffer.append(
                TranscriptEntryRecord(
                    type=entry_type,
                    content=content,
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    is_partial=is_partial,
                )
            )

    async def _persist_turn(status: str = "completed") -> None:
        """Persist current buffer as a turn and clear it."""
        nonlocal turn_sequence
        async with transcript_lock:
            if not transcript_buffer:
                return
            turn_sequence += 1
            entries = list(transcript_buffer)
            # Add system entry for turn status (matches frontend display)
            entries.append(
                TranscriptEntryRecord(
                    type="system",
                    content="Turn complete" if status == "completed" else "Interrupted",
                    timestamp=datetime.now(timezone.utc).isoformat(),
                    is_partial=False,
                )
            )
            turn = TranscriptTurnRecord(
                turn_id=uuid4().hex,
                sequence=turn_sequence,
                session_id=session_id,
                entries=entries,
                status=status,
                completed_at=datetime.now(timezone.utc).isoformat(),
            )
            transcript_buffer.clear()
        try:
            session_store.create_turn(session_id, turn)
            # Avoid appending custom memory-sync events while runner.run_live() is active.
            # DatabaseSessionService treats those concurrent writes as stale-session updates,
            # which can terminate the live ADK stream. We rebuild ADK conversation memory
            # from the persisted transcript during resume/reconnect instead.
            logger.info(
                "Persisted transcript turn %s for session_id=%s status=%s entries=%d",
                turn.turn_id,
                session_id,
                status,
                len(turn.entries),
            )
            try:
                compacted_context = await build_compacted_session_context(
                    session_store=session_store,
                    session_id=session_id,
                )
                logger.debug(
                    "Updated compacted session context: session_id=%s compacted_through=%s raw_turns=%s total_turns=%s",
                    session_id,
                    compacted_context.compacted_through_sequence,
                    compacted_context.raw_turn_count,
                    compacted_context.total_finalized_turn_count,
                )
            except Exception:
                logger.exception(
                    "Failed to refresh compacted session context for session_id=%s",
                    session_id,
                )
        except Exception as e:
            logger.warning("Failed to persist transcript turn: %s", e)

    def _mark_user_activity(*, speaking: bool | None = None) -> None:
        nonlocal user_speaking_active, last_user_activity_at
        last_user_activity_at = activity_clock.time()
        if speaking is not None:
            user_speaking_active = speaking

    def _clear_user_speaking_state() -> None:
        nonlocal user_speaking_active
        user_speaking_active = False

    def _is_recently_active(
        *,
        active: bool,
        last_activity_at: float | None,
        stale_window_s: float,
        now: float,
    ) -> bool:
        if not active or last_activity_at is None:
            return False
        return (now - last_activity_at) < stale_window_s

    def _is_user_speaking_now(now: float) -> bool:
        return _is_recently_active(
            active=user_speaking_active,
            last_activity_at=last_user_activity_at,
            stale_window_s=INTERPRETER_DELIVERY_USER_SPEECH_STALE_S,
            now=now,
        )

    def _build_interpreter_delivery_key(result: dict[str, object]) -> str | None:
        proactivity = result.get("proactivity")
        steering = result.get("steering")
        packet_window_id = result.get("packet_window_id")
        if not _is_record(proactivity) or not _is_record(steering):
            return None
        return json.dumps(
            {
                "packet_window_id": packet_window_id,
                "recommended_next_tutor_move": steering.get(
                    "recommended_next_tutor_move"
                ),
                "recommended_goal": steering.get("recommended_goal"),
                "recommended_question": steering.get("recommended_question"),
            },
            sort_keys=True,
            ensure_ascii=True,
        )

    def _build_interpreter_semantic_update(result: dict[str, object]) -> str:
        proactivity = result.get("proactivity") if _is_record(result.get("proactivity")) else {}
        steering = result.get("steering") if _is_record(result.get("steering")) else {}

        lines = [
            "Interpreter proactive update from the latest canvas understanding.",
            f"Candidate reason: {proactivity.get('reason') or 'A useful proactive tutoring moment was identified.'}",
            f"Recommended move: {steering.get('recommended_next_tutor_move') or 'Choose the next best tutoring move.'}",
            f"Recommended goal: {steering.get('recommended_goal') or 'Advance the learner based on the latest canvas state.'}",
        ]
        recommended_canvas_focus = steering.get("recommended_canvas_focus")
        if isinstance(recommended_canvas_focus, str) and recommended_canvas_focus.strip():
            lines.append(f"Recommended canvas focus: {recommended_canvas_focus.strip()}")
        recommended_question = steering.get("recommended_question")
        if isinstance(recommended_question, str) and recommended_question.strip():
            lines.append(f"Recommended question: {recommended_question.strip()}")
        lines.append(
            "Treat this as pedagogical guidance only. Decide whether to speak now, wait, or ignore it."
        )
        return "\n".join(lines)

    def _update_interpreter_delivery_trace(
        result: dict[str, object],
        *,
        send_content_status: str,
        skip_reason: str | None = None,
        delivery_trigger: str | None = None,
        delivery_key: str | None = None,
        retry_delay_s: float | None = None,
        delivered: bool = False,
        extra_updates: dict[str, object] | None = None,
    ) -> None:
        trace_file = result.get("trace_file")
        if not isinstance(trace_file, str) or not trace_file.strip():
            return

        now_iso = interpreter_trace_now_iso()
        updates: dict[str, object] = {
            "send_content_status": send_content_status,
            "send_content_updated_at": now_iso,
            "send_content_skip_reason": skip_reason,
            "send_content_delivery_trigger": delivery_trigger,
            "send_content_delivery_key": delivery_key,
            "send_content_retry_delay_s": retry_delay_s,
            "send_content_delivered_at": now_iso if delivered else None,
        }
        if isinstance(extra_updates, dict):
            updates.update(extra_updates)
        try:
            update_interpreter_reasoning_trace(trace_file, updates)
        except Exception:
            logger.exception(
                "Failed to update interpreter delivery trace: trace_file=%s run_id=%s status=%s",
                trace_file,
                result.get("run_id"),
                send_content_status,
            )

    def _clear_pending_interpreter_delivery() -> None:
        nonlocal pending_interpreter_delivery_result, pending_interpreter_delivery_task
        pending_interpreter_delivery_result = None
        if pending_interpreter_delivery_task is not None and not pending_interpreter_delivery_task.done():
            pending_interpreter_delivery_task.cancel()
        pending_interpreter_delivery_task = None

    def _get_interpreter_candidate_rejection_reason(
        result: dict[str, object],
        *,
        snapshot: dict[str, object] | None = None,
        require_latest: bool,
    ) -> str | None:
        run_id = result.get("run_id")
        proactivity_payload = result.get("proactivity")
        safety_flags = result.get("safety_flags")

        if result.get("status") != "completed":
            return "result_not_completed"
        if require_latest:
            latest_run_id = snapshot.get("latestRunId") if _is_record(snapshot) else None
            if not isinstance(run_id, str) or latest_run_id != run_id:
                return "result_not_latest"
        if not _is_record(proactivity_payload) or proactivity_payload.get("is_candidate") is not True:
            return "not_proactive_candidate"
        if not _is_record(safety_flags):
            return "missing_safety_flags"
        if safety_flags.get("insufficient_context") is True:
            return "insufficient_context"
        if safety_flags.get("needs_fresh_viewport") is True:
            return "needs_fresh_viewport"
        return None

    async def _retry_pending_interpreter_delivery_after(delay_s: float) -> None:
        try:
            await asyncio.sleep(max(delay_s, 0.1))
            await _maybe_deliver_pending_interpreter_update(trigger="retry")
        except asyncio.CancelledError:
            raise

    def _schedule_pending_interpreter_delivery_retry(delay_s: float) -> None:
        nonlocal pending_interpreter_delivery_task
        if pending_interpreter_delivery_task is not None and not pending_interpreter_delivery_task.done():
            pending_interpreter_delivery_task.cancel()
        pending_interpreter_delivery_task = asyncio.create_task(
            _retry_pending_interpreter_delivery_after(delay_s),
            name=f"interpreter-delivery-retry-{session_id}",
        )

    async def _maybe_deliver_pending_interpreter_update(*, trigger: str) -> None:
        nonlocal last_delivered_interpreter_at
        nonlocal last_delivered_interpreter_key
        nonlocal pending_interpreter_delivery_result
        nonlocal pending_interpreter_delivery_task

        result = pending_interpreter_delivery_result
        pending_interpreter_delivery_task = None
        if not _is_record(result):
            pending_interpreter_delivery_result = None
            return

        snapshot = await interpreter_reasoning_store.get_snapshot(
            user_id=user_id,
            session_id=session_id,
        )
        if not _is_record(snapshot):
            logger.debug(
                "Skipping interpreter delivery (%s): missing reasoning snapshot",
                trigger,
            )
            _update_interpreter_delivery_trace(
                result,
                send_content_status="skipped",
                skip_reason="missing_reasoning_snapshot",
                delivery_trigger=trigger,
            )
            pending_interpreter_delivery_result = None
            return

        now = activity_clock.time()
        run_id = result.get("run_id")
        packet_window_id = result.get("packet_window_id")
        delivery_key = _build_interpreter_delivery_key(result)
        current_user_speaking = _is_user_speaking_now(now)
        skip_reason: str | None = None
        retry_delay_s: float | None = None

        candidate_rejection_reason = _get_interpreter_candidate_rejection_reason(
            result,
            require_latest=False,
        )
        if candidate_rejection_reason is not None:
            skip_reason = candidate_rejection_reason
        elif current_user_speaking:
            skip_reason = "user_currently_speaking"
            retry_delay_s = max(
                0.1,
                INTERPRETER_DELIVERY_USER_SPEECH_STALE_S - (now - last_user_activity_at),
            ) if last_user_activity_at is not None else 1.0
        if skip_reason is None and last_delivered_interpreter_at is not None:
            cooldown_remaining_s = INTERPRETER_DELIVERY_COOLDOWN_S - (
                now - last_delivered_interpreter_at
            )
            if cooldown_remaining_s > 0:
                skip_reason = "cooldown_active"
                retry_delay_s = cooldown_remaining_s
        if skip_reason is None and delivery_key is not None:
            if delivery_key == last_delivered_interpreter_key:
                skip_reason = "duplicate_delivery"

        if skip_reason is not None:
            logger.debug(
                "Skipping interpreter delivery (%s): reason=%s run_id=%s window_id=%s user_speaking=%s cooldown_remaining=%s dedupe_key=%s",
                trigger,
                skip_reason,
                run_id,
                packet_window_id,
                current_user_speaking,
                (
                    max(0.0, INTERPRETER_DELIVERY_COOLDOWN_S - (now - last_delivered_interpreter_at))
                    if last_delivered_interpreter_at is not None
                    else None
                ),
                delivery_key,
            )
            if retry_delay_s is not None:
                _update_interpreter_delivery_trace(
                    result,
                    send_content_status="pending_retry",
                    skip_reason=skip_reason,
                    delivery_trigger=trigger,
                    delivery_key=delivery_key,
                    retry_delay_s=retry_delay_s,
                )
                _schedule_pending_interpreter_delivery_retry(retry_delay_s)
            else:
                _update_interpreter_delivery_trace(
                    result,
                    send_content_status=(
                        "skipped_duplicate"
                        if skip_reason == "duplicate_delivery"
                        else "skipped"
                    ),
                    skip_reason=skip_reason,
                    delivery_trigger=trigger,
                    delivery_key=delivery_key,
                )
                pending_interpreter_delivery_result = None
            return

        semantic_update = _build_interpreter_semantic_update(result)
        logger.debug(
            "Delivering interpreter update (%s): run_id=%s window_id=%s dedupe_key=%s",
            trigger,
            run_id,
            packet_window_id,
            delivery_key,
        )
        live_request_queue.send_content(types.Content(parts=[types.Part(text=semantic_update)]))
        _update_interpreter_delivery_trace(
            result,
            send_content_status="delivered",
            delivery_trigger=trigger,
            delivery_key=delivery_key,
            delivered=True,
        )
        last_delivered_interpreter_at = now
        last_delivered_interpreter_key = delivery_key
        pending_interpreter_delivery_result = None

    async def _send_frontend_action_message(frontend_action: dict[str, object]) -> None:
        logger.debug("Sending frontend action: %s", json.dumps(frontend_action))
        await websocket.send_text(
            json.dumps(
                {
                    "type": "frontend_action",
                    "action": frontend_action,
                }
            )
        )

    async def _send_interpreter_lifecycle_event(
        lifecycle_event: dict[str, object]
    ) -> None:
        nonlocal pending_interpreter_delivery_result
        frontend_action = _build_interpreter_lifecycle_action(lifecycle_event)
        if frontend_action is None:
            logger.warning(
                "Ignoring invalid interpreter lifecycle event: %s",
                json.dumps(lifecycle_event),
            )
        else:
            await _send_frontend_action_message(frontend_action)

        if lifecycle_event.get("state") != "completed":
            return

        snapshot = await interpreter_reasoning_store.get_snapshot(
            user_id=user_id,
            session_id=session_id,
        )
        if not _is_record(snapshot):
            return
        latest_result = snapshot.get("latestResult")
        if not _is_record(latest_result):
            return
        candidate_rejection_reason = _get_interpreter_candidate_rejection_reason(
            latest_result,
            snapshot=snapshot,
            require_latest=True,
        )
        if candidate_rejection_reason is not None:
            _update_interpreter_delivery_trace(
                latest_result,
                send_content_status="skipped",
                skip_reason=candidate_rejection_reason,
                delivery_trigger="completed_lifecycle",
            )
            return

        previous_pending_result = pending_interpreter_delivery_result
        previous_pending_run_id = (
            previous_pending_result.get("run_id")
            if _is_record(previous_pending_result)
            else None
        )
        latest_run_id = latest_result.get("run_id")
        if (
            isinstance(previous_pending_run_id, str)
            and isinstance(latest_run_id, str)
            and previous_pending_run_id != latest_run_id
        ):
            _update_interpreter_delivery_trace(
                previous_pending_result,
                send_content_status="replaced_by_newer_candidate",
                skip_reason="replaced_by_newer_candidate",
                delivery_trigger="completed_lifecycle",
                delivery_key=_build_interpreter_delivery_key(previous_pending_result),
                extra_updates={
                    "send_content_replaced_by_run_id": latest_run_id,
                    "send_content_replaced_at": interpreter_trace_now_iso(),
                },
            )
        pending_interpreter_delivery_result = latest_result
        await _maybe_deliver_pending_interpreter_update(trigger="completed_lifecycle")

    async def _send_realtime_image_data_url(data_url: str) -> bool:
        if not isinstance(data_url, str) or not data_url.startswith("data:"):
            return False

        header, separator, encoded_payload = data_url.partition(",")
        if not separator or not encoded_payload:
            return False

        mime_segment = header[5:]
        mime_type, _, encoding_suffix = mime_segment.partition(";")
        if encoding_suffix != "base64":
            logger.warning("Unsupported image data URL encoding: %s", encoding_suffix)
            return False

        try:
            image_data = base64.b64decode(encoded_payload)
        except Exception:
            logger.exception("Failed to decode viewport snapshot data URL")
            return False

        normalized_mime_type = mime_type.strip() or "image/jpeg"
        logger.debug(
            "Sending viewport snapshot image via send_realtime: %s bytes, type=%s",
            len(image_data),
            normalized_mime_type,
        )
        live_request_queue.send_realtime(
            types.Blob(mime_type=normalized_mime_type, data=image_data)
        )
        return True

    await canvas_snapshot_session_bridge_store.set_bridge(
        user_id=user_id,
        session_id=session_id,
        bridge=CanvasSnapshotSessionBridge(
            send_frontend_action=_send_frontend_action_message,
            send_screenshot_data_url=_send_realtime_image_data_url,
        ),
    )

    # ========================================
    # Phase 3: Active Session (concurrent bidirectional communication)
    # ========================================

    async def upstream_task() -> None:
        """Receives messages from WebSocket and sends to LiveRequestQueue."""
        nonlocal latest_closed_canvas_window_id
        logger.debug("upstream_task started")
        while True:
            # Receive message from WebSocket (text or binary)
            message = await websocket.receive()
            message_type = message.get("type")

            if message_type == "websocket.disconnect":
                code = message.get("code", 1000)
                reason = message.get("reason")
                logger.info(
                    "Client disconnected: session_id=%s code=%s reason=%s",
                    session_id,
                    code,
                    reason or "",
                )
                raise WebSocketDisconnect(code=code, reason=reason)

            if message_type != "websocket.receive":
                logger.debug(f"Ignoring WebSocket message type: {message_type}")
                continue

            # Handle binary frames (audio data)
            audio_data = message.get("bytes")
            if audio_data is not None:
                audio_blob = types.Blob(
                    mime_type="audio/pcm;rate=16000", data=audio_data
                )
                live_request_queue.send_realtime(audio_blob)

            # Handle text frames (JSON messages)
            else:
                text_data = message.get("text")
                if text_data is None:
                    continue
                json_message = json.loads(text_data)

                # Extract text from JSON and send to LiveRequestQueue
                if json_message.get("type") == "text":
                    user_text = json_message.get("text", "")
                    _mark_user_activity(speaking=False)
                    await _add_transcript_entry("user-text", user_text)
                    content = types.Content(
                        parts=[types.Part(text=user_text)]
                    )
                    live_request_queue.send_content(content)

                # Handle image data
                elif json_message.get("type") == "image":
                    logger.debug("Received image data")

                    # Decode base64 image data
                    image_data = base64.b64decode(json_message["data"])
                    mime_type = json_message.get("mimeType", "image/jpeg")

                    logger.debug(
                        "Sending image: %s bytes, type: %s",
                        len(image_data),
                        mime_type,
                    )

                    # Send image as blob
                    image_blob = types.Blob(mime_type=mime_type, data=image_data)
                    live_request_queue.send_realtime(image_blob)

                # Handle frontend acknowledgements
                elif json_message.get("type") == "frontend_ack":
                    logger.debug(
                        "Received frontend ack: %s",
                        json.dumps(json_message.get("ack", {})),
                    )
                    ack = _normalize_frontend_ack(json_message.get("ack"))
                    if ack is None:
                        continue
                    semantic_text = _apply_flashcard_ack_state(
                        ack,
                        user_id,
                        session_id,
                    )
                    if semantic_text is None:
                        semantic_text = _apply_canvas_ack_state(ack)
                    if semantic_text:
                        logger.debug(
                            "Sending frontend acknowledgement semantic update: %s",
                            semantic_text,
                        )
                        content = types.Content(parts=[types.Part(text=semantic_text)])
                        live_request_queue.send_content(content)

                elif json_message.get("type") == "canvas_context":
                    context_payload = json_message.get("context")
                    if _is_record(context_payload):
                        await canvas_placement_context_store.set_context(
                            user_id=user_id,
                            session_id=session_id,
                            payload=context_payload,
                        )

                elif json_message.get("type") == "canvas_context_response":
                    context_payload = json_message.get("context")
                    source_tool = json_message.get("source_tool")
                    job_id = json_message.get("job_id")
                    if (
                        _is_record(context_payload)
                        and isinstance(source_tool, str)
                        and isinstance(job_id, str)
                        and job_id.strip()
                    ):
                        await canvas_placement_context_store.set_context(
                            user_id=user_id,
                            session_id=session_id,
                            payload=context_payload,
                        )
                        canvas_context_request_store.resolve_response(
                            user_id=user_id,
                            session_id=session_id,
                            job_id=job_id,
                            payload=context_payload,
                        )
                        if source_tool == INTERPRETER_REASONING_SOURCE_TOOL:
                            pending_job = await interpreter_snapshot_job_store.pop_job_if_current(
                                user_id=user_id,
                                session_id=session_id,
                                job_id=job_id,
                            )
                            if pending_job is not None:
                                packet = build_interpreter_input_packet(
                                    session=pending_job.session,
                                    canvas_window=pending_job.canvas_window,
                                    canvas_context=context_payload,
                                    compacted_session_context=pending_job.compacted_session_context,
                                    flashcard_snapshot=pending_job.flashcard_snapshot,
                                )
                                packet_payload = packet.model_dump(
                                    mode="python", by_alias=False
                                )
                                await interpreter_packet_store.set_packet(
                                    user_id=user_id,
                                    session_id=session_id,
                                    packet=packet_payload,
                                )
                                await interpreter_reasoning_store.schedule_reasoning(
                                    user_id=user_id,
                                    session_id=session_id,
                                    packet=packet_payload,
                                    canvas_context=context_payload,
                                    lifecycle_callback=_send_interpreter_lifecycle_event,
                                )
                                logger.debug(
                                    "Scheduled interpreter reasoning with fresh snapshot: session_id=%s window_id=%s job_id=%s",
                                    session_id,
                                    pending_job.canvas_window.id,
                                    job_id,
                                )

                elif json_message.get("type") == "canvas_activity_window":
                    window_payload = _normalize_canvas_activity_window(
                        json_message.get("window")
                    )
                    if window_payload is None:
                        continue
                    latest_closed_canvas_window_id = window_payload.id

                    compacted_context = await build_compacted_session_context(
                        session_store=session_store,
                        session_id=session_id,
                    )
                    current_session = session_store.get_session(session_id) or session_record
                    flashcard_snapshot = flashcard_session_store.snapshot(
                        user_id=user_id,
                        session_id=session_id,
                    )
                    snapshot_bridge = await canvas_snapshot_session_bridge_store.get_bridge(
                        user_id=user_id,
                        session_id=session_id,
                    )
                    if snapshot_bridge is None:
                        logger.warning(
                            "Skipping interpreter snapshot request without live bridge: session_id=%s window_id=%s",
                            session_id,
                            window_payload.id,
                        )
                        continue

                    snapshot_job_id = f"interpreter-snapshot-{uuid4()}"
                    await interpreter_snapshot_job_store.set_job(
                        user_id=user_id,
                        session_id=session_id,
                        job=PendingInterpreterSnapshotJob(
                            job_id=snapshot_job_id,
                            session=current_session,
                            canvas_window=window_payload,
                            compacted_session_context=compacted_context,
                            flashcard_snapshot=flashcard_snapshot,
                        ),
                    )
                    await snapshot_bridge.send_frontend_action(
                        {
                            "type": CANVAS_VIEWPORT_SNAPSHOT_REQUESTED_ACTION,
                            "source_tool": INTERPRETER_REASONING_SOURCE_TOOL,
                            "job_id": snapshot_job_id,
                            "payload": {
                                "title": "Refreshing canvas view",
                                "message": "Capturing a fresh viewport snapshot and context",
                            },
                        }
                    )
                    logger.debug(
                        "Queued interpreter snapshot request: session_id=%s window_id=%s close_reason=%s job_id=%s",
                        session_id,
                        window_payload.id,
                        window_payload.close_reason,
                        snapshot_job_id,
                    )

                elif json_message.get("type") == "canvas_delegate_result":
                    source_tool = json_message.get("source_tool")
                    job_id = json_message.get("job_id")
                    delegate_status = json_message.get("status")
                    error_summary = json_message.get("error")
                    if (
                        isinstance(source_tool, str)
                        and source_tool == CANVAS_DELEGATE_TASK_TOOL
                        and isinstance(job_id, str)
                        and job_id.strip()
                        and isinstance(delegate_status, str)
                    ):
                        job_record = await canvas_delegate_job_store.pop_job(
                            user_id=user_id,
                            session_id=session_id,
                            job_id=job_id,
                        )
                        if job_record is None:
                            continue

                        if delegate_status == "completed":
                            result = _build_canvas_delegate_result(
                                status="completed",
                                job_id=job_id,
                                summary="Delegated canvas task completed",
                                payload={
                                    "goal": job_record.goal,
                                    "target_scope": job_record.target_scope,
                                },
                            )
                            await publish_canvas_delegate_job_result(
                                user_id=user_id,
                                session_id=session_id,
                                result=result,
                            )
                            semantic_text = (
                                "The canvas worker finished the delegated task: "
                                f"{job_record.goal}. "
                                "Explain what was added or changed on the canvas and how "
                                "it relates to the current topic. Do not ask a new "
                                "question or introduce a new topic."
                            )
                            content = types.Content(parts=[types.Part(text=semantic_text)])
                            live_request_queue.send_content(content)
                        else:
                            failure_summary = (
                                error_summary.strip()
                                if isinstance(error_summary, str) and error_summary.strip()
                                else "Canvas worker failed to complete the delegated task"
                            )
                            result = _build_canvas_delegate_result(
                                status="failed",
                                job_id=job_id,
                                summary=failure_summary,
                                payload={
                                    "goal": job_record.goal,
                                    "target_scope": job_record.target_scope,
                                },
                            )
                            await publish_canvas_delegate_job_result(
                                user_id=user_id,
                                session_id=session_id,
                                result=result,
                            )

    async def downstream_task() -> None:
        """Receives Events from run_live() and sends to WebSocket."""
        logger.debug("downstream_task started, calling runner.run_live()")
        logger.debug(
            "Starting run_live with user_id=%s, session_id=%s",
            user_id,
            session_id,
        )
        try:
            async for event in runner.run_live(
                user_id=user_id,
                session_id=session_id,
                live_request_queue=live_request_queue,
                run_config=run_config,
            ):
                event_json = event.model_dump_json(exclude_none=True, by_alias=True)
                event_payload = json.loads(event_json)
                frontend_action = extract_frontend_action(event_payload)
                await websocket.send_text(event_json)

                # Parse event for transcript persistence
                ev = event.model_dump(exclude_none=True, by_alias=True)

                if ev.get("turnComplete"):
                    _clear_user_speaking_state()
                    await _persist_turn("completed")
                    continue
                if ev.get("interrupted"):
                    _clear_user_speaking_state()
                    await _persist_turn("interrupted")
                    continue

                if ev.get("inputTranscription", {}).get("text"):
                    it = ev["inputTranscription"]
                    _mark_user_activity(speaking=not it.get("finished", False))
                    await _add_transcript_entry(
                        "user-transcription",
                        it["text"],
                        is_partial=not it.get("finished", False),
                    )
                if ev.get("outputTranscription", {}).get("text"):
                    ot = ev["outputTranscription"]
                    _clear_user_speaking_state()
                    await _add_transcript_entry(
                        "agent-transcription",
                        ot["text"],
                        is_partial=not ot.get("finished", False),
                    )
                if ev.get("content", {}).get("parts"):
                    for part in ev["content"]["parts"]:
                        if part.get("text") and not part.get("thought"):
                            _clear_user_speaking_state()
                            await _add_transcript_entry(
                                "agent-text",
                                part["text"],
                                is_partial=bool(ev.get("partial")),
                            )
                if frontend_action is not None:
                    await _send_frontend_action_message(frontend_action)
            logger.debug("run_live() generator completed")
        except asyncio.CancelledError:
            raise
        except genai_errors.APIError:
            raise

    async def background_tool_result_task(
        *,
        result_queue: asyncio.Queue[dict[str, object]],
        task_label: str,
    ) -> None:
        """Relay background tool results to the websocket session."""

        logger.debug(
            "%s started for user_id=%s, session_id=%s",
            task_label,
            user_id,
            session_id,
        )
        while True:
            result = await result_queue.get()
            logger.debug(
                "Sending background tool result from %s: %s",
                task_label,
                json.dumps(result),
            )
            await websocket.send_text(
                json.dumps(_build_tool_result_message(result))
            )
            frontend_action = extract_frontend_action(result)
            if frontend_action is not None:
                await _send_frontend_action_message(frontend_action)
            semantic_update = _build_background_tool_semantic_update(result)
            if semantic_update:
                logger.debug(
                    "Sending background tool semantic update from %s: %s",
                    task_label,
                    semantic_update,
                )
                content = types.Content(parts=[types.Part(text=semantic_update)])
                live_request_queue.send_content(content)

    # Run the core websocket pair concurrently.
    # Background tool-result relays stay attached to the session, but they do not
    # control session lifetime the way upstream/downstream do.
    upstream = asyncio.create_task(upstream_task(), name="websocket-upstream")
    downstream = asyncio.create_task(downstream_task(), name="websocket-downstream")
    core_tasks = (upstream, downstream)
    flashcard_background_results = asyncio.create_task(
        background_tool_result_task(
            result_queue=flashcard_background_result_queue,
            task_label="flashcard_background_tool_result_task",
        ),
        name="websocket-flashcard-background-tool-results",
    )
    canvas_background_results = asyncio.create_task(
        background_tool_result_task(
            result_queue=canvas_background_result_queue,
            task_label="canvas_background_tool_result_task",
        ),
        name="websocket-canvas-background-tool-results",
    )
    canvas_widget_background_results = asyncio.create_task(
        background_tool_result_task(
            result_queue=canvas_widget_background_result_queue,
            task_label="canvas_widget_background_tool_result_task",
        ),
        name="websocket-canvas-widget-background-tool-results",
    )
    canvas_delegate_background_results = asyncio.create_task(
        background_tool_result_task(
            result_queue=canvas_delegate_background_result_queue,
            task_label="canvas_delegate_background_tool_result_task",
        ),
        name="websocket-canvas-delegate-background-tool-results",
    )
    background_tasks = (
        flashcard_background_results,
        canvas_background_results,
        canvas_widget_background_results,
        canvas_delegate_background_results,
    )

    try:
        logger.info("Starting streaming tasks for session_id=%s", session_id)
        await asyncio.gather(*core_tasks)
        logger.info(
            "Core streaming tasks completed for session_id=%s; beginning shutdown",
            session_id,
        )
        shutdown_started.set()
    except WebSocketDisconnect:
        logger.info("Client disconnected normally for session_id=%s", session_id)
    except Exception as e:
        logger.error(f"Unexpected error in streaming tasks: {e}", exc_info=True)
    finally:
        shutdown_started.set()
        try:
            await _load_adk_session_summary(session_record, ensure_exists=False)
        except Exception:
            logger.exception(
                "Failed to refresh ADK session summary during websocket shutdown"
            )
        # ========================================
        # Phase 4: Session Termination
        # ========================================

        # Always close the queue, even if exceptions occurred
        logger.info("Closing live request queue for session_id=%s", session_id)
        live_request_queue.close()

        await flashcard_job_outbox.unsubscribe(
            user_id,
            session_id,
            flashcard_background_result_queue,
        )
        await canvas_visual_job_outbox.unsubscribe(
            user_id,
            session_id,
            canvas_background_result_queue,
        )
        await canvas_widget_job_outbox.unsubscribe(
            user_id,
            session_id,
            canvas_widget_background_result_queue,
        )
        await canvas_delegate_job_outbox.unsubscribe(
            user_id,
            session_id,
            canvas_delegate_background_result_queue,
        )
        await canvas_snapshot_session_bridge_store.clear_bridge(
            user_id=user_id,
            session_id=session_id,
        )
        await interpreter_packet_store.clear_session(
            user_id=user_id,
            session_id=session_id,
        )
        await interpreter_reasoning_store.clear_session(
            user_id=user_id,
            session_id=session_id,
        )
        _clear_pending_interpreter_delivery()
        await interpreter_snapshot_job_store.clear_session(
            user_id=user_id,
            session_id=session_id,
        )
        await canvas_placement_context_store.clear_context(
            user_id=user_id,
            session_id=session_id,
        )
        canvas_context_request_store.clear_session(
            user_id=user_id,
            session_id=session_id,
        )
        await canvas_delegate_job_store.clear_session(
            user_id=user_id,
            session_id=session_id,
        )

        for task in (*core_tasks, *background_tasks):
            if not task.done():
                task.cancel()

        for task in core_tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except WebSocketDisconnect:
                pass
            except Exception:
                raise

        for task in background_tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.exception(
                    "Background websocket task failed during shutdown: %s",
                    task.get_name(),
                )

        logger.info("WebSocket session shutdown complete for session_id=%s", session_id)
