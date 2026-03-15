"""Runtime grounding bundle loading and formatting helpers."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from session_grounding_status import GroundingStatusStore
from session_source_summary import SourceSummaryStore
from session_study_plan import StudyPlanStore

ORCHESTRATOR_STUDY_PLAN_STATE_KEY = "grounding_study_plan"
ORCHESTRATOR_SOURCE_HASH_STATE_KEY = "grounding_source_material_hash"


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class InterpreterGroundingBundle(ApiModel):
    source_material_hash: str
    session_goal: str
    learner_intent: str
    target_outcomes: list[str] = Field(default_factory=list)
    topic_sequence: list[str] = Field(default_factory=list)
    likely_misconceptions: list[str] = Field(default_factory=list)
    recommended_interventions: list[str] = Field(default_factory=list)
    source_overview: str
    core_concepts: list[str] = Field(default_factory=list)
    key_terms: list[str] = Field(default_factory=list)
    important_examples: list[str] = Field(default_factory=list)
    well_supported: list[str] = Field(default_factory=list)
    lightly_supported: list[str] = Field(default_factory=list)
    not_well_supported: list[str] = Field(default_factory=list)
    runtime_context_digest: str


class RuntimeGroundingBundle(ApiModel):
    session_id: str
    source_material_hash: str
    orchestrator_study_plan_text: str
    interpreter_grounding: InterpreterGroundingBundle


def load_runtime_grounding_bundle(
    *,
    session_id: str,
    grounding_status_store: GroundingStatusStore,
    study_plan_store: StudyPlanStore,
    source_summary_store: SourceSummaryStore,
) -> RuntimeGroundingBundle | None:
    """Load a compact runtime grounding bundle for a ready session."""

    status = grounding_status_store.get_status(session_id)
    if status is None or status.grounding_status != "ready":
        return None

    study_plan_artifact = study_plan_store.get_artifact(session_id)
    if study_plan_artifact is None:
        return None
    source_summary_artifact = source_summary_store.get_artifact(session_id)
    source_summary_available = (
        status.source_summary_status == "ready" and source_summary_artifact is not None
    )
    if status.source_summary_status == "ready" and source_summary_artifact is None:
        return None

    source_material_hash = study_plan_artifact.source_material_hash
    study_plan = study_plan_artifact.study_plan
    source_summary = (
        source_summary_artifact.source_summary
        if source_summary_available
        else None
    )

    topic_sequence = [topic.topic.strip() for topic in study_plan.topic_sequence if topic.topic.strip()]
    core_concepts = [
        f"{concept.name.strip()}: {concept.summary.strip()}"
        for concept in (source_summary.core_concepts if source_summary is not None else [])
        if concept.name.strip() and concept.summary.strip()
    ]
    key_terms = [
        term.strip()
        for term in (source_summary.key_terms if source_summary is not None else [])
        if term.strip()
    ]
    important_examples = [
        example.strip()
        for example in (
            source_summary.important_examples if source_summary is not None else []
        )
        if example.strip()
    ]
    likely_misconceptions = [
        item.strip() for item in study_plan.likely_misconceptions if item.strip()
    ]
    recommended_interventions = [
        item.strip() for item in study_plan.recommended_interventions if item.strip()
    ]
    target_outcomes = [item.strip() for item in study_plan.target_outcomes if item.strip()]
    well_supported = [
        item.strip()
        for item in (
            source_summary.source_boundaries.well_supported if source_summary is not None else []
        )
        if item.strip()
    ]
    lightly_supported = [
        item.strip()
        for item in (
            source_summary.source_boundaries.lightly_supported
            if source_summary is not None
            else []
        )
        if item.strip()
    ]
    not_well_supported = [
        item.strip()
        for item in (
            source_summary.source_boundaries.not_well_supported
            if source_summary is not None
            else []
        )
        if item.strip()
    ]
    source_overview = (
        source_summary.overview.strip()
        if source_summary is not None
        else "No uploaded source materials were attached for this session."
    )

    interpreter_grounding = InterpreterGroundingBundle(
        source_material_hash=source_material_hash,
        session_goal=study_plan.session_goal.strip(),
        learner_intent=study_plan.learner_intent.strip(),
        target_outcomes=target_outcomes,
        topic_sequence=topic_sequence,
        likely_misconceptions=likely_misconceptions,
        recommended_interventions=recommended_interventions,
        source_overview=source_overview,
        core_concepts=core_concepts,
        key_terms=key_terms,
        important_examples=important_examples,
        well_supported=well_supported,
        lightly_supported=lightly_supported,
        not_well_supported=not_well_supported,
        runtime_context_digest=_build_runtime_context_digest(
            session_goal=study_plan.session_goal.strip(),
            learner_intent=study_plan.learner_intent.strip(),
            topic_sequence=topic_sequence,
            source_overview=source_overview,
            likely_misconceptions=likely_misconceptions,
        ),
    )
    return RuntimeGroundingBundle(
        session_id=session_id,
        source_material_hash=source_material_hash,
        orchestrator_study_plan_text=_build_orchestrator_study_plan_text(
            session_goal=study_plan.session_goal.strip(),
            learner_intent=study_plan.learner_intent.strip(),
            target_outcomes=target_outcomes,
            topic_sequence=topic_sequence,
            likely_misconceptions=likely_misconceptions,
            recommended_interventions=recommended_interventions,
        ),
        interpreter_grounding=interpreter_grounding,
    )


def build_orchestrator_grounding_state(
    bundle: RuntimeGroundingBundle | None,
) -> dict[str, str]:
    """Build the ADK state fragment used by the orchestrator instruction provider."""

    if bundle is None:
        return {
            ORCHESTRATOR_STUDY_PLAN_STATE_KEY: "",
            ORCHESTRATOR_SOURCE_HASH_STATE_KEY: "",
        }
    return {
        ORCHESTRATOR_STUDY_PLAN_STATE_KEY: bundle.orchestrator_study_plan_text,
        ORCHESTRATOR_SOURCE_HASH_STATE_KEY: bundle.source_material_hash,
    }


def _build_orchestrator_study_plan_text(
    *,
    session_goal: str,
    learner_intent: str,
    target_outcomes: list[str],
    topic_sequence: list[str],
    likely_misconceptions: list[str],
    recommended_interventions: list[str],
) -> str:
    lines = [
        f"Session goal: {session_goal}",
        f"Learner intent: {learner_intent}",
    ]
    if target_outcomes:
        lines.append("Target outcomes:")
        lines.extend(f"- {item}" for item in target_outcomes)
    if topic_sequence:
        lines.append("Preferred topic sequence:")
        lines.extend(f"- {item}" for item in topic_sequence)
    if likely_misconceptions:
        lines.append("Likely misconceptions to watch for:")
        lines.extend(f"- {item}" for item in likely_misconceptions)
    if recommended_interventions:
        lines.append("Recommended tutoring interventions:")
        lines.extend(f"- {item}" for item in recommended_interventions)
    return "\n".join(lines).strip()


def _build_runtime_context_digest(
    *,
    session_goal: str,
    learner_intent: str,
    topic_sequence: list[str],
    source_overview: str,
    likely_misconceptions: list[str],
) -> str:
    lines = [
        f"Session goal: {session_goal}",
        f"Learner intent: {learner_intent}",
        f"Source overview: {source_overview}",
    ]
    if topic_sequence:
        lines.append("Planned topic flow:")
        lines.extend(f"- {item}" for item in topic_sequence[:5])
    if likely_misconceptions:
        lines.append("Misconceptions to monitor:")
        lines.extend(f"- {item}" for item in likely_misconceptions[:5])
    return "\n".join(lines).strip()
