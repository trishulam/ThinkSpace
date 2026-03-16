"""Session-bound knowledge lookup tool for ThinkSpace."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from google.adk.tools import FunctionTool, ToolContext  # pylint: disable=no-name-in-module,import-error

from session_grounding_status import create_grounding_status_store
from session_vertex_rag import lookup_session_rag_corpus_sync

logger = logging.getLogger(__name__)

KNOWLEDGE_LOOKUP_TOOL = "knowledge.lookup"
DEFAULT_LOOKUP_MAX_RESULTS = 3
MAX_LOOKUP_MAX_RESULTS = 5
KNOWLEDGE_LOOKUP_MIN_DURATION_S = 2.5
_DATA_ROOT = Path(__file__).resolve().parents[2] / "data"
grounding_status_store = create_grounding_status_store(_DATA_ROOT / "session_grounding_status")


@dataclass
class _SessionOutbox:
    subscribers: set[asyncio.Queue[dict[str, object]]] = field(default_factory=set)
    pending_results: list[dict[str, object]] = field(default_factory=list)


class KnowledgeLookupJobOutbox:
    """Per-session async tool-result outbox for knowledge lookups."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._sessions: dict[tuple[str, str], _SessionOutbox] = {}

    async def subscribe(
        self, user_id: str, session_id: str
    ) -> asyncio.Queue[dict[str, object]]:
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        key = (user_id, session_id)

        async with self._lock:
            outbox = self._sessions.setdefault(key, _SessionOutbox())
            outbox.subscribers.add(queue)
            pending_results = list(outbox.pending_results)
            outbox.pending_results.clear()

        for result in pending_results:
            queue.put_nowait(result)

        return queue

    async def unsubscribe(
        self, user_id: str, session_id: str, queue: asyncio.Queue[dict[str, object]]
    ) -> None:
        key = (user_id, session_id)
        async with self._lock:
            outbox = self._sessions.get(key)
            if outbox is None:
                return
            outbox.subscribers.discard(queue)
            if not outbox.subscribers and not outbox.pending_results:
                self._sessions.pop(key, None)

    async def publish_result(
        self, user_id: str, session_id: str, result: dict[str, object]
    ) -> None:
        key = (user_id, session_id)
        async with self._lock:
            outbox = self._sessions.setdefault(key, _SessionOutbox())
            subscribers = list(outbox.subscribers)
            if not subscribers:
                outbox.pending_results.append(result)
                return

        for queue in subscribers:
            queue.put_nowait(result)


knowledge_lookup_job_outbox = KnowledgeLookupJobOutbox()


async def publish_knowledge_lookup_job_result(
    *,
    user_id: str,
    session_id: str,
    result: dict[str, object],
) -> None:
    """Publish a knowledge lookup result to the owning websocket session."""

    await knowledge_lookup_job_outbox.publish_result(user_id, session_id, result)


def _schedule_knowledge_lookup_result_delivery(
    *,
    user_id: str | None,
    session_id: str | None,
    result: dict[str, object],
    task_name: str,
) -> None:
    """Queue a websocket-only knowledge lookup status update when possible."""

    if not user_id or not session_id:
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return

    loop.create_task(
        publish_knowledge_lookup_job_result(
            user_id=user_id,
            session_id=session_id,
            result=result,
        ),
        name=task_name,
    )


def _should_enforce_min_lookup_duration() -> bool:
    """Only pace lookup replies in the live async session flow."""

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def _enforce_min_lookup_duration(started_at: float) -> None:
    remaining_s = KNOWLEDGE_LOOKUP_MIN_DURATION_S - (time.monotonic() - started_at)
    if remaining_s > 0:
        time.sleep(remaining_s)


def _build_tool_result(
    *,
    status: str,
    summary: str,
    payload: object | None = None,
    job_id: str | None = None,
) -> dict[str, object]:
    result: dict[str, object] = {
        "status": status,
        "tool": KNOWLEDGE_LOOKUP_TOOL,
        "summary": summary,
    }
    if payload is not None:
        result["payload"] = payload
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


def _normalize_max_results(max_results: int | None) -> int:
    if not isinstance(max_results, int):
        return DEFAULT_LOOKUP_MAX_RESULTS
    return max(1, min(max_results, MAX_LOOKUP_MAX_RESULTS))


def _build_lookup_query(
    *,
    query: str,
    intent: str | None,
    topic_hint: str | None,
) -> str:
    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("knowledge.lookup requires a non-empty query")
    _ = intent
    _ = topic_hint
    return normalized_query


def _run_lookup_sync(
    *,
    session_id: str,
    original_query: str,
    lookup_query: str,
    topic_hint: str | None,
    normalized_max_results: int,
) -> dict[str, object]:
    status = grounding_status_store.get_status(session_id)
    if status is None or status.knowledge_index_status != "ready" or not status.rag_corpus_id:
        return _build_tool_result(
            status="failed",
            summary="Knowledge lookup is unavailable because session grounding is not ready",
        )

    result = lookup_session_rag_corpus_sync(
        rag_corpus_id=status.rag_corpus_id,
        query=lookup_query,
        max_results=normalized_max_results,
    )

    if not result.results:
        return _build_tool_result(
            status="completed",
            summary="No high-confidence source matches found",
            payload={
                "query": original_query,
                "results": [],
            },
        )

    result_count = len(result.results)
    summary_topic = (
        topic_hint.strip()
        if isinstance(topic_hint, str) and topic_hint.strip()
        else original_query
    )
    return _build_tool_result(
        status="completed",
        summary=(
            f"Retrieved {result_count} source-grounded excerpt"
            f"{'s' if result_count != 1 else ''} for {summary_topic}"
        ),
        payload={
            "query": original_query,
            "results": [item.model_dump(mode="json") for item in result.results],
        },
    )


def knowledge_lookup(
    query: str,
    intent: str | None = None,
    topic_hint: str | None = None,
    max_results: int = DEFAULT_LOOKUP_MAX_RESULTS,
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Retrieve exact source-grounded snippets from uploaded session materials."""

    user_id, session_id = _get_session_identity(tool_context)
    job_id = f"knowledge-lookup-{uuid4()}"
    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            summary="Knowledge lookup requires an active session context",
            job_id=job_id,
        )

    try:
        lookup_query = _build_lookup_query(
            query=query,
            intent=intent,
            topic_hint=topic_hint,
        )
    except ValueError as exc:
        return _build_tool_result(
            status="failed",
            summary=str(exc),
            job_id=job_id,
        )

    normalized_max_results = _normalize_max_results(max_results)
    accepted_result = _build_tool_result(
        status="accepted",
        summary="Started knowledge lookup",
        payload={
            "query": query.strip(),
            "max_results": normalized_max_results,
            "topic_hint": topic_hint.strip()
            if isinstance(topic_hint, str) and topic_hint.strip()
            else None,
        },
        job_id=job_id,
    )
    _schedule_knowledge_lookup_result_delivery(
        user_id=user_id,
        session_id=session_id,
        result=accepted_result,
        task_name=f"knowledge-lookup-start-{job_id}",
    )

    started_at = time.monotonic()
    should_enforce_min_duration = _should_enforce_min_lookup_duration()
    try:
        result = _run_lookup_sync(
            original_query=query.strip(),
            session_id=session_id,
            lookup_query=lookup_query,
            topic_hint=topic_hint,
            normalized_max_results=normalized_max_results,
        )
    except Exception as exc:  # pragma: no cover - defensive runtime boundary
        logger.exception("knowledge.lookup failed for session_id=%s", session_id)
        result = _build_tool_result(
            status="failed",
            summary=f"Knowledge lookup failed: {exc}",
        )

    if should_enforce_min_duration:
        _enforce_min_lookup_duration(started_at)

    result["job"] = {"id": job_id}
    _schedule_knowledge_lookup_result_delivery(
        user_id=user_id,
        session_id=session_id,
        result=result,
        task_name=f"knowledge-lookup-stop-{job_id}",
    )
    return result


def get_knowledge_lookup_tools() -> list[FunctionTool]:
    """Return the knowledge lookup tools registered for ThinkSpace."""

    knowledge_lookup.__name__ = KNOWLEDGE_LOOKUP_TOOL
    knowledge_lookup.__qualname__ = KNOWLEDGE_LOOKUP_TOOL
    return [FunctionTool(knowledge_lookup)]
