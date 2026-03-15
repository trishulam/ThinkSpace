from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

# pylint: disable=import-error,wrong-import-position
sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

from session_grounding_bundle import (  # noqa: E402
    ORCHESTRATOR_STUDY_PLAN_STATE_KEY,
    build_orchestrator_grounding_state,
    load_runtime_grounding_bundle,
)
from session_grounding_status import LocalFileGroundingStatusStore  # noqa: E402
from session_source_summary import (  # noqa: E402
    LocalFileSourceSummaryStore,
    SessionSourceSummaryArtifact,
    SourceBoundaries,
    SourceSummaryCoreConcept,
    SourceSummaryData,
)
from session_study_plan import (  # noqa: E402
    LocalFileStudyPlanStore,
    SessionStudyPlanArtifact,
    StudyPlanData,
    StudyPlanTopic,
)
from session_store import SessionRecord  # noqa: E402
from thinkspace_agent.context.interpreter_packet import (  # noqa: E402
    InterpreterCanvasWindow,
    InterpreterCanvasWindowAggregateCounts,
    build_interpreter_input_packet,
)
from thinkspace_agent.context.session_compaction import CompactedSessionContext  # noqa: E402
from thinkspace_agent.instructions.assembly import (  # noqa: E402
    build_instruction,
    build_instruction_text,
)


def _write_ready_grounding(tmp_path: Path, session_id: str = "session-1"):
    grounding_status_store = LocalFileGroundingStatusStore(tmp_path / "grounding-status")
    study_plan_store = LocalFileStudyPlanStore(tmp_path / "study-plan")
    source_summary_store = LocalFileSourceSummaryStore(tmp_path / "source-summary")

    grounding_status_store.merge_status(
        session_id,
        study_plan_status="ready",
        source_summary_status="ready",
        knowledge_index_status="ready",
    )
    study_plan_store.save_artifact(
        SessionStudyPlanArtifact(
            session_id=session_id,
            status="completed",
            generated_at="2026-03-15T00:00:00+00:00",
            model="gemini-test",
            source_material_hash="hash-123",
            study_plan=StudyPlanData(
                session_goal="Understand mitochondria",
                learner_intent="Learn ATP production",
                target_outcomes=["Explain ATP generation"],
                topic_sequence=[
                    StudyPlanTopic(
                        topic="Cell respiration",
                        why_it_matters="It powers ATP production",
                        success_signals=["Can explain electron transport chain"],
                    )
                ],
                likely_misconceptions=["Mitochondria create energy from nothing"],
                recommended_interventions=["Use a stepwise causal explanation"],
            ),
        )
    )
    source_summary_store.save_artifact(
        SessionSourceSummaryArtifact(
            session_id=session_id,
            status="completed",
            generated_at="2026-03-15T00:00:00+00:00",
            model="gemini-test",
            source_material_hash="hash-123",
            source_summary=SourceSummaryData(
                overview="The materials explain how mitochondria produce ATP.",
                core_concepts=[
                    SourceSummaryCoreConcept(
                        name="Mitochondria",
                        summary="Organelle responsible for aerobic ATP production.",
                    )
                ],
                key_terms=["ATP", "electron transport chain"],
                definitions=[],
                important_examples=["ATP synthase driving ATP formation"],
                source_boundaries=SourceBoundaries(
                    well_supported=["ATP generation"],
                    lightly_supported=["Detailed membrane transport"],
                    not_well_supported=["Medical exceptions"],
                ),
            ),
        )
    )
    return grounding_status_store, study_plan_store, source_summary_store


def test_load_runtime_grounding_bundle_returns_compact_ready_bundle(tmp_path: Path) -> None:
    grounding_status_store, study_plan_store, source_summary_store = _write_ready_grounding(
        tmp_path
    )

    bundle = load_runtime_grounding_bundle(
        session_id="session-1",
        grounding_status_store=grounding_status_store,
        study_plan_store=study_plan_store,
        source_summary_store=source_summary_store,
    )

    assert bundle is not None
    assert bundle.source_material_hash == "hash-123"
    assert "Session goal: Understand mitochondria" in bundle.orchestrator_study_plan_text
    assert bundle.interpreter_grounding.topic_sequence == ["Cell respiration"]
    assert "Source overview:" in bundle.interpreter_grounding.runtime_context_digest


def test_load_runtime_grounding_bundle_returns_none_when_not_ready(tmp_path: Path) -> None:
    grounding_status_store, study_plan_store, source_summary_store = _write_ready_grounding(
        tmp_path,
        session_id="session-2",
    )
    grounding_status_store.merge_status("session-2", knowledge_index_status="processing")

    bundle = load_runtime_grounding_bundle(
        session_id="session-2",
        grounding_status_store=grounding_status_store,
        study_plan_store=study_plan_store,
        source_summary_store=source_summary_store,
    )

    assert bundle is None


def test_load_runtime_grounding_bundle_supports_prompt_only_sessions(tmp_path: Path) -> None:
    grounding_status_store = LocalFileGroundingStatusStore(tmp_path / "grounding-status")
    study_plan_store = LocalFileStudyPlanStore(tmp_path / "study-plan")
    source_summary_store = LocalFileSourceSummaryStore(tmp_path / "source-summary")

    grounding_status_store.merge_status(
        "session-prompt-only",
        study_plan_status="ready",
        source_summary_status="unavailable",
        knowledge_index_status="unavailable",
    )
    study_plan_store.save_artifact(
        SessionStudyPlanArtifact(
            session_id="session-prompt-only",
            status="completed",
            generated_at="2026-03-15T00:00:00+00:00",
            model="gemini-test",
            source_material_hash="hash-prompt-only",
            study_plan=StudyPlanData(
                session_goal="Understand derivatives",
                learner_intent="Learn the intuition behind slopes",
                target_outcomes=["Explain derivative as rate of change"],
                topic_sequence=[StudyPlanTopic(topic="Slope intuition")],
                likely_misconceptions=["Derivative is only a formula trick"],
                recommended_interventions=["Use graph-based intuition first"],
            ),
        )
    )

    bundle = load_runtime_grounding_bundle(
        session_id="session-prompt-only",
        grounding_status_store=grounding_status_store,
        study_plan_store=study_plan_store,
        source_summary_store=source_summary_store,
    )

    assert bundle is not None
    assert bundle.source_material_hash == "hash-prompt-only"
    assert "Understand derivatives" in bundle.orchestrator_study_plan_text
    assert (
        bundle.interpreter_grounding.source_overview
        == "No uploaded source materials were attached for this session."
    )
    assert "No uploaded source materials were attached for this session." in (
        bundle.interpreter_grounding.runtime_context_digest
    )


def test_instruction_assembly_includes_grounding_and_memory() -> None:
    instruction_text = build_instruction_text(
        memory="User: What is ATP?\nAgent: ATP stores usable energy.",
        study_plan_text="Session goal: Understand mitochondria",
    )

    assert "## Session Study Plan" in instruction_text
    assert "## Learner Conversation Memory" in instruction_text
    assert "For knowledge lookup:" in instruction_text
    assert "use `knowledge.lookup` when the learner needs an exact fact" in instruction_text

    provider = build_instruction()
    result = provider(
        SimpleNamespace(
            state={
                ORCHESTRATOR_STUDY_PLAN_STATE_KEY: "Session goal: Understand mitochondria",
                "conversation_memory": "User: What is ATP?",
            }
        )
    )
    assert "Session goal: Understand mitochondria" in result
    assert "User: What is ATP?" in result
    assert "For knowledge lookup:" in result


def test_interpreter_packet_includes_grounding_and_digest(tmp_path: Path) -> None:
    grounding_status_store, study_plan_store, source_summary_store = _write_ready_grounding(
        tmp_path,
        session_id="session-3",
    )
    bundle = load_runtime_grounding_bundle(
        session_id="session-3",
        grounding_status_store=grounding_status_store,
        study_plan_store=study_plan_store,
        source_summary_store=source_summary_store,
    )
    assert bundle is not None

    packet = build_interpreter_input_packet(
        session=SessionRecord(
            session_id="session-3",
            user_id="user-1",
            topic="Cell biology",
            goal="Understand mitochondria",
            mode="guided",
            level="beginner",
            created_at="2026-03-15T00:00:00+00:00",
            updated_at="2026-03-15T00:00:00+00:00",
            last_active_at="2026-03-15T00:00:00+00:00",
        ),
        canvas_window=InterpreterCanvasWindow(
            id="window-1",
            started_at="2026-03-15T00:00:00+00:00",
            last_change_at="2026-03-15T00:00:00+00:00",
            closed_at="2026-03-15T00:00:01+00:00",
            close_reason="idle_timeout",
            aggregate_counts=InterpreterCanvasWindowAggregateCounts(
                total_events=1,
                create_count=1,
                update_count=0,
                delete_count=0,
                user_changes=1,
                agent_changes=0,
                system_changes=0,
            ),
        ),
        canvas_context=None,
        compacted_session_context=CompactedSessionContext(
            session_id="session-3",
            topic="Cell biology",
            goal="Understand mitochondria",
            summary_text="The learner asked about ATP generation.",
        ),
        flashcard_snapshot=None,
        grounding=bundle.interpreter_grounding,
    )

    assert packet.grounding is not None
    assert packet.grounding.source_material_hash == "hash-123"
    assert "## Grounding Summary" in packet.runtime_context_text
    assert "Understand mitochondria" in packet.runtime_context_text


def test_build_orchestrator_grounding_state_clears_when_bundle_missing() -> None:
    state = build_orchestrator_grounding_state(None)
    assert state[ORCHESTRATOR_STUDY_PLAN_STATE_KEY] == ""
