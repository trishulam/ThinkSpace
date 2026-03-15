"""Grounding summarization helpers for Phase 5."""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict

from session_source_extraction import ParsedSource
from session_source_summary import (
    SessionSourceSummaryArtifact,
    SourceSummaryCoreConcept,
    SourceSummaryData,
)
from session_study_plan import SessionStudyPlanArtifact, StudyPlanData, StudyPlanTopic
from session_store import SessionRecord
from thinkspace_agent.config import get_grounding_summarization_model

ALLOWED_MODALITIES = {
    "explain",
    "flashcards",
    "generate_visual",
    "generate_graph",
    "generate_notation",
    "delegate_canvas",
}
REQUIREMENTS_HEADING = "Requirements:"
JSON_MIME_TYPE = "application/json"


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class DocumentSummaryConcept(ApiModel):
    name: str
    summary: str


class GeneratedDocumentSummary(ApiModel):
    overview: str
    core_concepts: list[DocumentSummaryConcept] = []
    key_terms: list[str] = []
    important_examples: list[str] = []


class DocumentSummary(ApiModel):
    source_id: str
    title: str
    overview: str
    core_concepts: list[DocumentSummaryConcept] = []
    key_terms: list[str] = []
    important_examples: list[str] = []


class DocumentSummaryFailure(ApiModel):
    source_id: str
    title: str
    error: str


@dataclass
class DocumentSummaryResult:
    summaries: list[DocumentSummary]
    failures: list[DocumentSummaryFailure]
    warning: str | None = None


def _build_client() -> Any:
    from google.genai import Client

    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).strip()


def _build_document_summary_prompt(parsed_source: ParsedSource) -> str:
    source_payload = json.dumps(
        {
            "title": parsed_source.title,
            "mimeType": parsed_source.mime_type,
            "text": parsed_source.text,
        },
        ensure_ascii=True,
        indent=2,
    )
    return "\n".join(
        [
            "You are generating a compact source-grounded summary of one uploaded study document.",
            "Return JSON only.",
            REQUIREMENTS_HEADING,
            "- Stay grounded in the document text only.",
            "- Keep the overview concise but specific.",
            "- Include only the highest-signal concepts and vocabulary.",
            "- Do not speculate beyond the source.",
            "- Prefer short concept summaries over long prose.",
            "",
            "Document JSON:",
            source_payload,
        ]
    )


def _build_source_summary_prompt(document_summaries: list[DocumentSummary]) -> str:
    summary_payload = json.dumps(
        [
            summary.model_dump(mode="json", by_alias=True)
            for summary in document_summaries
        ],
        ensure_ascii=True,
        indent=2,
    )
    return "\n".join(
        [
            "You are merging multiple source-grounded document summaries into one session-level source summary for ThinkSpace.",
            "Return JSON only using the provided response schema.",
            REQUIREMENTS_HEADING,
            "- Produce a concise overview of the whole source pack.",
            "- Keep all claims grounded in the provided document summaries.",
            "- Use `core_concepts` for the most important ideas to track across the source pack.",
            "- Use `definitions` only for short strong definitions supported by the summaries.",
            "- Use `source_boundaries` to distinguish what is well supported, lightly supported, and not well supported.",
            "- Do not mention missing files, prompts, or implementation details.",
            "",
            "Document summaries JSON:",
            summary_payload,
        ]
    )


def _build_study_plan_prompt(
    *,
    session: SessionRecord,
    source_summary: SourceSummaryData | None,
) -> str:
    learner_intent = session.goal or session.topic
    prompt_lines = [
        "You are creating a pedagogically useful study plan for a ThinkSpace tutoring session.",
        "Return JSON only using the provided response schema.",
        REQUIREMENTS_HEADING,
        "- Keep the plan concise and practical for one tutoring session.",
        "- `topic_sequence` should be an ordered teaching path, not a random concept list.",
        "- For each topic, choose `recommended_modalities` deliberately based on the best way to teach that topic.",
        "- Every topic should include at least one modality.",
        "- Do not treat the initial session greeting as a tool-use moment.",
        "- By default, the opening teaching move after the learner's initial engagement should start with `delegate_canvas` so the tutor can create a mindmap or flowchart on the canvas.",
        "- Prefer the first teachable topic to include `delegate_canvas` unless the learner request is unusually incompatible with a canvas-first explanation.",
        "- Use visual, graph, notation, or delegated canvas modalities only when they genuinely fit the topic pedagogically.",
        "- Do not assign the same modality to every topic unless the topic sequence truly calls for that.",
        "- Use `flashcards` primarily for review or testing after the concept has already been taught, not as the default opening teaching modality.",
        "- Treat `recommended_modalities` as teaching affordances the live tutor can prefer later, not as mandatory tool calls.",
        "- `recommended_modalities` may only use these literals:",
        "  explain, flashcards, generate_visual, generate_graph, generate_notation, delegate_canvas",
        "- Keep `likely_misconceptions` and `recommended_interventions` specific and actionable.",
        "- Do not mention prompts, implementation, JSON, or model instructions.",
    ]
    if source_summary is not None:
        prompt_lines.extend(
            [
                "- Base the plan on the learner's intent plus the merged source summary.",
                "- Keep the plan source-aware when materials are provided.",
                "",
                f"Session topic: {session.topic}",
                f"Learner goal: {session.goal or ''}",
                f"Learner intent: {learner_intent}",
                "",
                "Merged source summary JSON:",
                json.dumps(
                    source_summary.model_dump(mode="json", by_alias=True),
                    ensure_ascii=True,
                    indent=2,
                ),
            ]
        )
    else:
        prompt_lines.extend(
            [
                "- No uploaded source materials were provided, so build the plan from the learner prompt only.",
                "- Do not invent source-backed details or pretend that external documents exist.",
                "",
                f"Session topic: {session.topic}",
                f"Learner goal: {session.goal or ''}",
                f"Learner intent: {learner_intent}",
            ]
        )
    return "\n".join(prompt_lines)


def _generate_document_summary(parsed_source: ParsedSource) -> DocumentSummary:
    client = _build_client()
    model_name = get_grounding_summarization_model()
    from google.genai import types as genai_types

    response = client.models.generate_content(
        model=model_name,
        contents=_build_document_summary_prompt(parsed_source),
        config=genai_types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type=JSON_MIME_TYPE,
            response_schema=GeneratedDocumentSummary,
        ),
    )
    if response.parsed is None:
        raise ValueError(
            f"Document summary generator returned no structured payload for {parsed_source.title}"
        )

    parsed = GeneratedDocumentSummary.model_validate(response.parsed)
    return DocumentSummary(
        source_id=parsed_source.source_id,
        title=parsed_source.title,
        overview=_normalize_text(parsed.overview),
        core_concepts=[
            DocumentSummaryConcept(
                name=_normalize_text(concept.name),
                summary=_normalize_text(concept.summary),
            )
            for concept in parsed.core_concepts
            if _normalize_text(concept.name) and _normalize_text(concept.summary)
        ],
        key_terms=[_normalize_text(term) for term in parsed.key_terms if _normalize_text(term)],
        important_examples=[
            _normalize_text(example)
            for example in parsed.important_examples
            if _normalize_text(example)
        ],
    )


async def generate_document_summary_result(
    attachment_sources: list[ParsedSource],
) -> DocumentSummaryResult:
    async def summarize_source(parsed_source: ParsedSource):
        try:
            summary = await asyncio.to_thread(_generate_document_summary, parsed_source)
            return summary
        except Exception as exc:
            return DocumentSummaryFailure(
                source_id=parsed_source.source_id,
                title=parsed_source.title,
                error=str(exc),
            )

    results = await asyncio.gather(
        *(summarize_source(source) for source in attachment_sources)
    )
    summaries = [result for result in results if isinstance(result, DocumentSummary)]
    failures = [result for result in results if isinstance(result, DocumentSummaryFailure)]

    warning = _resolve_document_summary_failures(summaries=summaries, failures=failures)
    return DocumentSummaryResult(
        summaries=summaries,
        failures=failures,
        warning=warning,
    )


def _resolve_document_summary_failures(
    *,
    summaries: list[DocumentSummary],
    failures: list[DocumentSummaryFailure],
) -> str | None:
    if not failures:
        return None
    if len(summaries) == 1:
        return (
            "Continuing with one successful document summary while other documents failed: "
            + "; ".join(f"{failure.title}: {failure.error}" for failure in failures)
        )
    raise ValueError(
        "Document summarization failed and grounding cannot continue: "
        + "; ".join(f"{failure.title}: {failure.error}" for failure in failures)
    )


def _generate_source_summary_data(
    document_summaries: list[DocumentSummary],
) -> SourceSummaryData:
    client = _build_client()
    model_name = get_grounding_summarization_model()
    from google.genai import types as genai_types

    response = client.models.generate_content(
        model=model_name,
        contents=_build_source_summary_prompt(document_summaries),
        config=genai_types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type=JSON_MIME_TYPE,
            response_schema=SourceSummaryData,
        ),
    )
    if response.parsed is None:
        raise ValueError("Source summary generator returned no structured payload")

    source_summary = SourceSummaryData.model_validate(response.parsed)
    return SourceSummaryData(
        overview=_normalize_text(source_summary.overview),
        core_concepts=[
            SourceSummaryCoreConcept(
                name=_normalize_text(concept.name),
                summary=_normalize_text(concept.summary),
            )
            for concept in source_summary.core_concepts
            if _normalize_text(concept.name) and _normalize_text(concept.summary)
        ],
        key_terms=[_normalize_text(term) for term in source_summary.key_terms if _normalize_text(term)],
        definitions=[
            definition.model_copy(
                update={
                    "term": _normalize_text(definition.term),
                    "definition": _normalize_text(definition.definition),
                }
            )
            for definition in source_summary.definitions
            if _normalize_text(definition.term) and _normalize_text(definition.definition)
        ],
        important_examples=[
            _normalize_text(example)
            for example in source_summary.important_examples
            if _normalize_text(example)
        ],
        source_boundaries=source_summary.source_boundaries,
    )


async def generate_source_summary_artifact(
    *,
    session_id: str,
    document_summaries: list[DocumentSummary],
    source_material_hash: str,
) -> SessionSourceSummaryArtifact:
    source_summary = await asyncio.to_thread(
        _generate_source_summary_data,
        document_summaries,
    )
    return SessionSourceSummaryArtifact(
        session_id=session_id,
        status="completed",
        source_summary=source_summary,
        generated_at=_now_iso(),
        model=get_grounding_summarization_model(),
        source_material_hash=source_material_hash,
    )


def _generate_study_plan_data(
    *,
    session: SessionRecord,
    source_summary: SourceSummaryData | None,
) -> StudyPlanData:
    client = _build_client()
    model_name = get_grounding_summarization_model()
    from google.genai import types as genai_types

    response = client.models.generate_content(
        model=model_name,
        contents=_build_study_plan_prompt(session=session, source_summary=source_summary),
        config=genai_types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type=JSON_MIME_TYPE,
            response_schema=StudyPlanData,
        ),
    )
    if response.parsed is None:
        raise ValueError("Study plan generator returned no structured payload")

    study_plan = StudyPlanData.model_validate(response.parsed)
    normalized_topics: list[StudyPlanTopic] = []
    for index, topic in enumerate(study_plan.topic_sequence, start=1):
        normalized_modalities = [
            modality
            for modality in topic.recommended_modalities
            if modality in ALLOWED_MODALITIES
        ]
        normalized_topics.append(
            topic.model_copy(
                update={
                    "id": topic.id or f"topic-{index}",
                    "topic": _normalize_text(topic.topic),
                    "why_it_matters": _normalize_text(topic.why_it_matters or "") or None,
                    "success_signals": [
                        _normalize_text(signal)
                        for signal in topic.success_signals
                        if _normalize_text(signal)
                    ],
                    "common_failure_modes": [
                        _normalize_text(mode)
                        for mode in topic.common_failure_modes
                        if _normalize_text(mode)
                    ],
                    "recommended_modalities": normalized_modalities or ["explain"],
                }
            )
        )

    return StudyPlanData(
        session_goal=_normalize_text(study_plan.session_goal),
        learner_intent=_normalize_text(study_plan.learner_intent),
        target_outcomes=[
            _normalize_text(outcome)
            for outcome in study_plan.target_outcomes
            if _normalize_text(outcome)
        ],
        topic_sequence=normalized_topics,
        likely_misconceptions=[
            _normalize_text(item)
            for item in study_plan.likely_misconceptions
            if _normalize_text(item)
        ],
        recommended_interventions=[
            _normalize_text(item)
            for item in study_plan.recommended_interventions
            if _normalize_text(item)
        ],
    )


async def generate_study_plan_artifact(
    *,
    session: SessionRecord,
    source_summary: SourceSummaryData | None,
    source_material_hash: str,
) -> SessionStudyPlanArtifact:
    study_plan = await asyncio.to_thread(
        _generate_study_plan_data,
        session=session,
        source_summary=source_summary,
    )
    return SessionStudyPlanArtifact(
        session_id=session.session_id,
        status="completed",
        study_plan=study_plan,
        generated_at=_now_iso(),
        model=get_grounding_summarization_model(),
        source_material_hash=source_material_hash,
    )


def _now_iso() -> str:
    import datetime as _datetime

    return _datetime.datetime.now(_datetime.timezone.utc).isoformat()
