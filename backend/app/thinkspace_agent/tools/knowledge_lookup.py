"""Session-bound knowledge lookup tool for ThinkSpace."""

from __future__ import annotations

import logging
from pathlib import Path

from google.adk.tools import FunctionTool, ToolContext  # pylint: disable=no-name-in-module,import-error

from session_grounding_status import create_grounding_status_store
from session_vertex_rag import lookup_session_rag_corpus_sync

logger = logging.getLogger(__name__)

KNOWLEDGE_LOOKUP_TOOL = "knowledge.lookup"
DEFAULT_LOOKUP_MAX_RESULTS = 3
MAX_LOOKUP_MAX_RESULTS = 5

_DATA_ROOT = Path(__file__).resolve().parents[2] / "data"
grounding_status_store = create_grounding_status_store(_DATA_ROOT / "session_grounding_status")


def _build_tool_result(
    *,
    status: str,
    summary: str,
    payload: object | None = None,
) -> dict[str, object]:
    result: dict[str, object] = {
        "status": status,
        "tool": KNOWLEDGE_LOOKUP_TOOL,
        "summary": summary,
    }
    if payload is not None:
        result["payload"] = payload
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


def knowledge_lookup(
    query: str,
    intent: str | None = None,
    topic_hint: str | None = None,
    max_results: int = DEFAULT_LOOKUP_MAX_RESULTS,
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Retrieve exact source-grounded snippets from uploaded session materials."""

    _, session_id = _get_session_identity(tool_context)
    if not session_id:
        return _build_tool_result(
            status="failed",
            summary="Knowledge lookup requires an active session context",
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
        )

    status = grounding_status_store.get_status(session_id)
    if status is None or status.knowledge_index_status != "ready" or not status.rag_corpus_id:
        return _build_tool_result(
            status="failed",
            summary="Knowledge lookup is unavailable because session grounding is not ready",
        )

    try:
        result = lookup_session_rag_corpus_sync(
            rag_corpus_id=status.rag_corpus_id,
            query=lookup_query,
            max_results=_normalize_max_results(max_results),
        )
    except Exception as exc:  # pragma: no cover - defensive runtime boundary
        logger.exception("knowledge.lookup failed for session_id=%s", session_id)
        return _build_tool_result(
            status="failed",
            summary=f"Knowledge lookup failed: {exc}",
        )

    if not result.results:
        return _build_tool_result(
            status="completed",
            summary="No high-confidence source matches found",
            payload={
                "query": query.strip(),
                "results": [],
            },
        )

    result_count = len(result.results)
    summary_topic = (
        topic_hint.strip()
        if isinstance(topic_hint, str) and topic_hint.strip()
        else query.strip()
    )
    return _build_tool_result(
        status="completed",
        summary=(
            f"Retrieved {result_count} source-grounded excerpt"
            f"{'s' if result_count != 1 else ''} for {summary_topic}"
        ),
        payload={
            "query": query.strip(),
            "results": [item.model_dump(mode="json") for item in result.results],
        },
    )


def get_knowledge_lookup_tools() -> list[FunctionTool]:
    """Return the knowledge lookup tools registered for ThinkSpace."""

    knowledge_lookup.__name__ = KNOWLEDGE_LOOKUP_TOOL
    knowledge_lookup.__qualname__ = KNOWLEDGE_LOOKUP_TOOL
    return [FunctionTool(knowledge_lookup)]
