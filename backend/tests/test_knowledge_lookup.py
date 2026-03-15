from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

# pylint: disable=import-error,wrong-import-position
sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

from session_vertex_rag import VertexSessionLookupResult, VertexSessionLookupResultItem  # noqa: E402
from thinkspace_agent.tools.knowledge_lookup import (  # noqa: E402
    KNOWLEDGE_LOOKUP_TOOL,
    knowledge_lookup,
)
from thinkspace_agent.tools.registry import get_tools  # noqa: E402


class FakeGroundingStatusStore:
    def __init__(self, status=None) -> None:
        self._status = status

    def get_status(self, session_id: str):
        _ = session_id
        return self._status


def _tool_context(session_id: str = "session-1", user_id: str = "user-1"):
    return SimpleNamespace(
        user_id=user_id,
        session=SimpleNamespace(id=session_id),
    )


def test_lookup_requires_active_session_context(monkeypatch) -> None:
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.grounding_status_store",
        FakeGroundingStatusStore(None),
    )

    result = knowledge_lookup(query="What is ATP?", tool_context=None)

    assert result["status"] == "failed"
    assert result["tool"] == KNOWLEDGE_LOOKUP_TOOL


def test_lookup_fails_when_grounding_not_ready(monkeypatch) -> None:
    status = SimpleNamespace(knowledge_index_status="processing", rag_corpus_id=None)
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.grounding_status_store",
        FakeGroundingStatusStore(status),
    )

    result = knowledge_lookup(query="What is ATP?", tool_context=_tool_context())

    assert result["status"] == "failed"
    assert "not ready" in result["summary"]


def test_lookup_returns_completed_results(monkeypatch) -> None:
    status = SimpleNamespace(knowledge_index_status="ready", rag_corpus_id="rag-1")
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.grounding_status_store",
        FakeGroundingStatusStore(status),
    )
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.lookup_session_rag_corpus_sync",
        lambda *, rag_corpus_id, query, max_results: VertexSessionLookupResult(
            query=query,
            results=[
                VertexSessionLookupResultItem(
                    source_id="doc-1",
                    source_title="Lecture Notes",
                    locator="page 2",
                    section_title="ATP",
                    snippet="ATP stores usable energy.",
                    relevance_score=0.93,
                )
            ],
        ),
    )

    result = knowledge_lookup(
        query="What is ATP?",
        topic_hint="ATP",
        tool_context=_tool_context(),
    )

    assert result["status"] == "completed"
    assert result["payload"]["query"] == "What is ATP?"
    assert len(result["payload"]["results"]) == 1
    assert "ATP" in result["summary"]


def test_lookup_returns_completed_empty_results_when_no_matches(monkeypatch) -> None:
    status = SimpleNamespace(knowledge_index_status="ready", rag_corpus_id="rag-1")
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.grounding_status_store",
        FakeGroundingStatusStore(status),
    )
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.lookup_session_rag_corpus_sync",
        lambda *, rag_corpus_id, query, max_results: VertexSessionLookupResult(
            query=query,
            results=[],
        ),
    )

    result = knowledge_lookup(query="Unknown fact", tool_context=_tool_context())

    assert result["status"] == "completed"
    assert result["payload"]["results"] == []
    assert "No high-confidence source matches found" == result["summary"]


def test_lookup_caps_max_results(monkeypatch) -> None:
    status = SimpleNamespace(knowledge_index_status="ready", rag_corpus_id="rag-1")
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.grounding_status_store",
        FakeGroundingStatusStore(status),
    )

    def _fake_lookup(*, rag_corpus_id, query, max_results):
        captured["max_results"] = max_results
        return VertexSessionLookupResult(query=query, results=[])

    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.lookup_session_rag_corpus_sync",
        _fake_lookup,
    )

    knowledge_lookup(query="ATP", max_results=99, tool_context=_tool_context())

    assert captured["max_results"] == 5


def test_lookup_uses_default_max_results(monkeypatch) -> None:
    status = SimpleNamespace(knowledge_index_status="ready", rag_corpus_id="rag-1")
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.grounding_status_store",
        FakeGroundingStatusStore(status),
    )

    def _fake_lookup(*, rag_corpus_id, query, max_results):
        captured["max_results"] = max_results
        return VertexSessionLookupResult(query=query, results=[])

    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.lookup_session_rag_corpus_sync",
        _fake_lookup,
    )

    knowledge_lookup(query="ATP", tool_context=_tool_context())

    assert captured["max_results"] == 3


def test_lookup_returns_failed_for_invalid_corpus(monkeypatch) -> None:
    status = SimpleNamespace(knowledge_index_status="ready", rag_corpus_id="stale-rag")
    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.grounding_status_store",
        FakeGroundingStatusStore(status),
    )

    def _raise_lookup_error(*, rag_corpus_id, query, max_results):
        raise RuntimeError("stale corpus")

    monkeypatch.setattr(
        "thinkspace_agent.tools.knowledge_lookup.lookup_session_rag_corpus_sync",
        _raise_lookup_error,
    )

    result = knowledge_lookup(query="ATP", tool_context=_tool_context())

    assert result["status"] == "failed"
    assert "stale corpus" in result["summary"]


def test_registry_includes_knowledge_lookup_tool() -> None:
    tool_names = {
        getattr(tool, "name", None) or getattr(getattr(tool, "func", None), "__name__", None)
        for tool in get_tools()
    }
    assert KNOWLEDGE_LOOKUP_TOOL in tool_names
