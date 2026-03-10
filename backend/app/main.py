"""FastAPI application demonstrating ADK Gemini Live API Toolkit with WebSocket."""

import asyncio
import base64
import json
import logging
import warnings
from contextlib import suppress
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from google.adk.agents.live_request_queue import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

# Load environment variables from .env file BEFORE importing agent
load_dotenv(Path(__file__).parent / ".env")

# Import agent after loading environment variables
# pylint: disable=wrong-import-position
from thinkspace_agent.agent import agent  # noqa: E402
from thinkspace_agent.tools.flashcard_jobs import (  # noqa: E402
    flashcard_job_outbox,
    flashcard_session_store,
)

# Configure logging
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Avoid verbose websocket transport logs leaking sensitive headers like API keys.
logging.getLogger("websockets.client").setLevel(logging.INFO)

# Suppress Pydantic serialization warnings
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

# Application name constant
APP_NAME = "bidi-demo"


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
        current_card = snapshot.get("current_card") if isinstance(snapshot, dict) else None
        front = (
            current_card.get("front")
            if isinstance(current_card, dict) and isinstance(current_card.get("front"), str)
            else None
        )
        if front:
            return (
                "The flashcards are now visible in the UI. "
                f"The first question is: {front}"
            )
        return "The flashcards are now visible in the UI."

    if action_type == "flashcards.reveal_answer":
        snapshot = flashcard_session_store.mark_answer_rendered(
            user_id=user_id,
            session_id=session_id,
        )
        current_card = snapshot.get("current_card") if isinstance(snapshot, dict) else None
        answer = (
            current_card.get("back")
            if isinstance(current_card, dict) and isinstance(current_card.get("back"), str)
            else None
        )
        if answer:
            return (
                "The current flashcard answer is now visible in the UI. "
                f"The revealed answer is: {answer}. "
                "Briefly explain it, then pause and wait for the learner."
            )
        return (
            "The current flashcard answer is now visible in the UI. "
            "Explain it briefly, then pause and wait for the learner."
        )

    if action_type == "flashcards.next":
        snapshot = flashcard_session_store.mark_next_rendered(
            user_id=user_id,
            session_id=session_id,
        )
        current_card = snapshot.get("current_card") if isinstance(snapshot, dict) else None
        front = (
            current_card.get("front")
            if isinstance(current_card, dict) and isinstance(current_card.get("front"), str)
            else None
        )
        if front:
            return (
                "The next flashcard is now visible in the UI. "
                f"Ask the learner this question: {front}"
            )
        return "The next flashcard is now visible in the UI. Ask the next question."

    if action_type == "flashcards.clear":
        return None

    return None

# ========================================
# Phase 1: Application Initialization (once at startup)
# ========================================

app = FastAPI()

# Mount static files
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Define your session service
session_service = InMemorySessionService()

# Define your runner
runner = Runner(app_name=APP_NAME, agent=agent, session_service=session_service)

# ========================================
# HTTP Endpoints
# ========================================


@app.get("/")
async def root():
    """Serve the index.html page."""
    return FileResponse(Path(__file__).parent / "static" / "index.html")


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
    logger.debug(
        f"WebSocket connection request: user_id={user_id}, session_id={session_id}, "
        f"proactivity={proactivity}, affective_dialog={affective_dialog}"
    )
    await websocket.accept()
    logger.debug("WebSocket connection accepted")

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

    # Get or create session (handles both new sessions and reconnections)
    session = await session_service.get_session(
        app_name=APP_NAME, user_id=user_id, session_id=session_id
    )
    if not session:
        await session_service.create_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )

    live_request_queue = LiveRequestQueue()
    background_result_queue = await flashcard_job_outbox.subscribe(user_id, session_id)

    # ========================================
    # Phase 3: Active Session (concurrent bidirectional communication)
    # ========================================

    async def upstream_task() -> None:
        """Receives messages from WebSocket and sends to LiveRequestQueue."""
        logger.debug("upstream_task started")
        while True:
            # Receive message from WebSocket (text or binary)
            message = await websocket.receive()
            message_type = message.get("type")

            if message_type == "websocket.disconnect":
                logger.debug(
                    "Client disconnected: code=%s reason=%s",
                    message.get("code"),
                    message.get("reason", ""),
                )
                return

            if message_type != "websocket.receive":
                logger.debug(f"Ignoring WebSocket message type: {message_type}")
                continue

            # Handle binary frames (audio data)
            audio_data = message.get("bytes")
            if audio_data is not None:
                logger.debug(f"Received binary audio chunk: {len(audio_data)} bytes")

                audio_blob = types.Blob(
                    mime_type="audio/pcm;rate=16000", data=audio_data
                )
                live_request_queue.send_realtime(audio_blob)

            # Handle text frames (JSON messages)
            else:
                text_data = message.get("text")
                if text_data is None:
                    continue
                logger.debug(f"Received text message: {text_data[:100]}...")

                json_message = json.loads(text_data)

                # Extract text from JSON and send to LiveRequestQueue
                if json_message.get("type") == "text":
                    logger.debug(f"Sending text content: {json_message['text']}")
                    content = types.Content(
                        parts=[types.Part(text=json_message["text"])]
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
                    if semantic_text:
                        logger.debug(
                            "Sending flashcard creation semantic update: %s",
                            semantic_text,
                        )
                        content = types.Content(parts=[types.Part(text=semantic_text)])
                        live_request_queue.send_content(content)

    async def downstream_task() -> None:
        """Receives Events from run_live() and sends to WebSocket."""
        logger.debug("downstream_task started, calling runner.run_live()")
        logger.debug(
            "Starting run_live with user_id=%s, session_id=%s",
            user_id,
            session_id,
        )
        async for event in runner.run_live(
            user_id=user_id,
            session_id=session_id,
            live_request_queue=live_request_queue,
            run_config=run_config,
        ):
            event_json = event.model_dump_json(exclude_none=True, by_alias=True)
            event_payload = json.loads(event_json)
            frontend_action = extract_frontend_action(event_payload)
            logger.debug(f"[SERVER] Event: {event_json}")
            await websocket.send_text(event_json)
            if frontend_action is not None:
                logger.debug(
                    "Sending frontend action: %s", json.dumps(frontend_action)
                )
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "frontend_action",
                            "action": frontend_action,
                        }
                    )
                )
        logger.debug("run_live() generator completed")

    async def background_tool_result_task() -> None:
        """Relays background tool results to the websocket session."""

        logger.debug(
            "background_tool_result_task started for user_id=%s, session_id=%s",
            user_id,
            session_id,
        )
        while True:
            result = await background_result_queue.get()
            logger.debug(
                "Sending background tool result: %s",
                json.dumps(result),
            )
            await websocket.send_text(
                json.dumps(_build_tool_result_message(result))
            )
            frontend_action = extract_frontend_action(result)
            if frontend_action is not None:
                logger.debug(
                    "Sending background frontend action: %s",
                    json.dumps(frontend_action),
                )
                await websocket.send_text(
                    json.dumps(
                        {
                            "type": "frontend_action",
                            "action": frontend_action,
                        }
                    )
                )

    # Run both tasks concurrently
    # Exceptions from either task will propagate and cancel the other task
    upstream = asyncio.create_task(upstream_task(), name="websocket-upstream")
    downstream = asyncio.create_task(downstream_task(), name="websocket-downstream")
    background_results = asyncio.create_task(
        background_tool_result_task(),
        name="websocket-background-tool-results",
    )

    try:
        logger.debug("Starting asyncio.gather for upstream and downstream tasks")
        done, _ = await asyncio.wait(
            {upstream, downstream, background_results},
            return_when=asyncio.FIRST_COMPLETED,
        )
        logger.debug("One websocket task completed, beginning shutdown")

        for task in done:
            exc = task.exception()
            if exc:
                raise exc
    except WebSocketDisconnect:
        logger.debug("Client disconnected normally")
    except Exception as e:
        logger.error(f"Unexpected error in streaming tasks: {e}", exc_info=True)
    finally:
        # ========================================
        # Phase 4: Session Termination
        # ========================================

        # Always close the queue, even if exceptions occurred
        logger.debug("Closing live_request_queue")
        live_request_queue.close()

        await flashcard_job_outbox.unsubscribe(
            user_id,
            session_id,
            background_result_queue,
        )

        for task in (upstream, downstream, background_results):
            if not task.done():
                task.cancel()

        for task in (upstream, downstream, background_results):
            with suppress(asyncio.CancelledError):
                await task
