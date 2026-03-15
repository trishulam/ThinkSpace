from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

# pylint: disable=import-error,wrong-import-position,protected-access
sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

import main  # noqa: E402
from session_grounding_status import LocalFileGroundingStatusStore  # noqa: E402
from session_source_summary import LocalFileSourceSummaryStore  # noqa: E402
from session_study_plan import (  # noqa: E402
    LocalFileStudyPlanStore,
    SessionStudyPlanArtifact,
    StudyPlanData,
    StudyPlanTopic,
)
from session_store import SessionRecord  # noqa: E402


class _FakeSessionStore:
    def __init__(self, session: SessionRecord) -> None:
        self._session = session

    def get_session(self, session_id: str) -> SessionRecord | None:
        return self._session if session_id == self._session.session_id else None


class _FakeSourceMaterialStore:
    def list_materials(self, session_id: str):
        _ = session_id
        return []

    def get_material_bytes(self, material):
        raise AssertionError(f"Unexpected material read for prompt-only session: {material}")


@pytest.mark.asyncio
async def test_prompt_only_grounding_skips_summary_and_knowledge_index(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    session = SessionRecord(
        session_id="prompt-only-session",
        user_id="user-1",
        topic="Derivatives",
        goal="Understand the intuition of slope",
        mode="guided",
        level="beginner",
        created_at="2026-03-15T00:00:00+00:00",
        updated_at="2026-03-15T00:00:00+00:00",
        last_active_at="2026-03-15T00:00:00+00:00",
    )
    grounding_status_store = LocalFileGroundingStatusStore(tmp_path / "grounding-status")
    study_plan_store = LocalFileStudyPlanStore(tmp_path / "study-plan")
    source_summary_store = LocalFileSourceSummaryStore(tmp_path / "source-summary")

    monkeypatch.setattr(main, "session_store", _FakeSessionStore(session))
    monkeypatch.setattr(main, "grounding_status_store", grounding_status_store)
    monkeypatch.setattr(main, "study_plan_store", study_plan_store)
    monkeypatch.setattr(main, "source_summary_store", source_summary_store)
    monkeypatch.setattr(main, "source_material_store", _FakeSourceMaterialStore())

    async def _fake_generate_study_plan_artifact(*, session, source_summary, source_material_hash):
        await asyncio.sleep(0)
        assert source_summary is None
        assert source_material_hash
        return SessionStudyPlanArtifact(
            session_id=session.session_id,
            status="completed",
            generated_at="2026-03-15T00:00:01+00:00",
            model="gemini-test",
            source_material_hash=source_material_hash,
            study_plan=StudyPlanData(
                session_goal="Understand the intuition of slope",
                learner_intent="Understand the intuition of slope",
                target_outcomes=["Explain derivative as local slope"],
                topic_sequence=[StudyPlanTopic(topic="Slope intuition")],
                likely_misconceptions=["Derivative is only symbolic manipulation"],
                recommended_interventions=["Start with a tangent-line mental model"],
            ),
        )

    async def _unexpected_generate_document_summary_result(*args, **kwargs):
        raise AssertionError("Document summarization should be skipped for prompt-only grounding")

    async def _unexpected_generate_source_summary_artifact(*args, **kwargs):
        raise AssertionError("Source summary generation should be skipped for prompt-only grounding")

    async def _unexpected_prepare_session_rag_corpus(*args, **kwargs):
        raise AssertionError("Knowledge index creation should be skipped for prompt-only grounding")

    monkeypatch.setattr(main, "generate_study_plan_artifact", _fake_generate_study_plan_artifact)
    monkeypatch.setattr(
        main,
        "generate_document_summary_result",
        _unexpected_generate_document_summary_result,
    )
    monkeypatch.setattr(
        main,
        "generate_source_summary_artifact",
        _unexpected_generate_source_summary_artifact,
    )
    monkeypatch.setattr(
        main,
        "prepare_session_rag_corpus",
        _unexpected_prepare_session_rag_corpus,
    )

    await main._run_grounding_job(session.session_id)

    status = grounding_status_store.get_status(session.session_id)
    assert status is not None
    assert status.grounding_status == "ready"
    assert status.study_plan_status == "ready"
    assert status.source_summary_status == "unavailable"
    assert status.knowledge_index_status == "unavailable"
    assert status.rag_corpus_id is None
    assert study_plan_store.get_artifact(session.session_id) is not None
    assert source_summary_store.get_artifact(session.session_id) is None
