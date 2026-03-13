"""Rolling transcript compaction helpers for Story I."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timezone
from typing import Literal

from google.genai import Client
from google.genai import types as genai_types
from pydantic import BaseModel, ConfigDict, Field

from session_store import (
    CheckpointCreateRequest,
    CheckpointRecord,
    SessionRecord,
    SessionStore,
    TranscriptEntryRecord,
    TranscriptTurnRecord,
)
from thinkspace_agent.config import get_session_compaction_model

logger = logging.getLogger(__name__)

RAW_TURNS_BEFORE_FIRST_COMPACTION = 10
RAW_TURNS_AFTER_COMPACTION = 5
RAW_TURNS_BEFORE_RECOMPACTION = 10
SESSION_COMPACTION_KIND = "session_compaction"


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).strip()


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class FinalizedTranscriptTurn(ApiModel):
    turn_id: str
    turn_sequence: int
    start_timestamp: str
    user_text: str | None = None
    agent_text: str | None = None


class FinalizedTranscriptPayload(ApiModel):
    session_id: str
    topic: str
    goal: str | None = None
    session_start_timestamp: str | None = None
    session_end_timestamp: str | None = None
    turns: list[FinalizedTranscriptTurn] = []


class GeneratedCompactionSummary(BaseModel):
    summary_text: str = Field(min_length=1, max_length=1600)


class CompactedSessionState(ApiModel):
    kind: Literal["session_compaction"] = SESSION_COMPACTION_KIND
    summary_text: str | None = None
    compacted_through_sequence: int = 0
    updated_at: str
    source_turn_count: int = 0
    recent_raw_count_after_compaction: int = 0
    model: str | None = None


class CompactedSessionContext(ApiModel):
    session_id: str
    topic: str
    goal: str | None = None
    summary_text: str | None = None
    recent_raw_turns: list[FinalizedTranscriptTurn] = []
    raw_turn_count: int = 0
    compacted_through_sequence: int = 0
    latest_turn_sequence: int | None = None
    total_finalized_turn_count: int = 0
    needs_recompaction: bool = False


def _build_client() -> Client:
    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def _find_last_entry(
    entries: list[TranscriptEntryRecord],
    *,
    entry_type: str,
) -> TranscriptEntryRecord | None:
    for entry in reversed(entries):
        if entry.type != entry_type or entry.is_partial:
            continue
        if not entry.content.strip():
            continue
        return entry
    return None


def build_finalized_transcript_payload(
    *,
    session: SessionRecord,
    transcript: list[TranscriptTurnRecord],
) -> FinalizedTranscriptPayload:
    turns: list[FinalizedTranscriptTurn] = []
    for turn in transcript:
        user_entry = _find_last_entry(turn.entries, entry_type="user-transcription")
        agent_entry = _find_last_entry(turn.entries, entry_type="agent-text")
        if user_entry is None and agent_entry is None:
            continue

        start_timestamp = (
            user_entry.timestamp
            if user_entry is not None
            else agent_entry.timestamp
            if agent_entry is not None
            else turn.completed_at
        )
        turns.append(
            FinalizedTranscriptTurn(
                turn_id=turn.turn_id,
                turn_sequence=turn.sequence,
                start_timestamp=start_timestamp,
                user_text=(
                    _normalize_text(user_entry.content) if user_entry is not None else None
                ),
                agent_text=(
                    _normalize_text(agent_entry.content)
                    if agent_entry is not None
                    else None
                ),
            )
        )

    return FinalizedTranscriptPayload(
        session_id=session.session_id,
        topic=session.topic,
        goal=session.goal,
        session_start_timestamp=turns[0].start_timestamp if turns else None,
        session_end_timestamp=turns[-1].start_timestamp if turns else None,
        turns=turns,
    )


def _load_compaction_state(
    checkpoint: CheckpointRecord | None,
) -> CompactedSessionState | None:
    if checkpoint is None or not isinstance(checkpoint.payload, dict):
        return None
    payload = checkpoint.payload
    if payload.get("kind") != SESSION_COMPACTION_KIND:
        return None
    try:
        return CompactedSessionState.model_validate(payload)
    except Exception:
        logger.exception("Failed to parse stored session compaction payload")
        return None


def _should_compact(
    *,
    has_prior_compaction: bool,
    raw_turn_count: int,
) -> bool:
    if not has_prior_compaction:
        return raw_turn_count > RAW_TURNS_BEFORE_FIRST_COMPACTION
    return raw_turn_count >= RAW_TURNS_BEFORE_RECOMPACTION


def _build_compaction_prompt(
    *,
    session: SessionRecord,
    previous_summary: str | None,
    turns_to_fold: list[FinalizedTranscriptTurn],
) -> str:
    payload = {
        "topic": session.topic,
        "goal": session.goal,
        "previous_summary": previous_summary,
        "turns_to_fold": [
            turn.model_dump(mode="json", by_alias=True) for turn in turns_to_fold
        ],
    }
    return "\n".join(
        [
            "You are updating a rolling semantic summary for a tutoring session.",
            "The summary should capture learning progress, key concepts already covered,",
            "important tutor explanations, misconceptions surfaced so far, and unresolved questions.",
            "Requirements:",
            "- Keep the output concise, cumulative, and human-readable.",
            "- Write as one short paragraph of 3 to 6 sentences.",
            "- Focus on learning content and progress, not conversational filler.",
            "- Incorporate the previous summary if it exists.",
            "- Fold in the new turns without repeating the same point unnecessarily.",
            "- Do not mention that this is a summary update.",
            "",
            "Input JSON:",
            json.dumps(payload, ensure_ascii=True, indent=2),
        ]
    )


def _fallback_summary(
    *,
    session: SessionRecord,
    previous_summary: str | None,
    turns_to_fold: list[FinalizedTranscriptTurn],
) -> str:
    snippets: list[str] = []
    for turn in turns_to_fold[-4:]:
        parts: list[str] = []
        if turn.user_text:
            parts.append(f"Learner: {turn.user_text}")
        if turn.agent_text:
            parts.append(f"Tutor: {turn.agent_text}")
        if parts:
            snippets.append(" ".join(parts))

    base_parts: list[str] = []
    if previous_summary:
        base_parts.append(previous_summary.strip())
    elif session.goal:
        base_parts.append(
            f"The session is focused on {session.topic} with the goal of {session.goal}."
        )
    else:
        base_parts.append(f"The session is focused on {session.topic}.")

    if snippets:
        base_parts.append(
            "Recent finalized discussion included: " + " ".join(snippets)
        )

    return _normalize_text(" ".join(base_parts))[:1600]


def _generate_updated_summary(
    *,
    session: SessionRecord,
    previous_summary: str | None,
    turns_to_fold: list[FinalizedTranscriptTurn],
) -> tuple[str, str]:
    prompt = _build_compaction_prompt(
        session=session,
        previous_summary=previous_summary,
        turns_to_fold=turns_to_fold,
    )
    model_name = get_session_compaction_model()

    try:
        client = _build_client()
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type="application/json",
                response_schema=GeneratedCompactionSummary,
            ),
        )
        if response.parsed is None:
            raise ValueError("Session compaction returned no structured summary")
        generated_payload = GeneratedCompactionSummary.model_validate(response.parsed)
        return _normalize_text(generated_payload.summary_text), model_name
    except Exception:
        logger.exception("Falling back to heuristic session compaction summary")
        return (
            _fallback_summary(
                session=session,
                previous_summary=previous_summary,
                turns_to_fold=turns_to_fold,
            ),
            model_name,
        )


async def _generate_updated_summary_async(
    *,
    session: SessionRecord,
    previous_summary: str | None,
    turns_to_fold: list[FinalizedTranscriptTurn],
) -> tuple[str, str]:
    return await asyncio.to_thread(
        _generate_updated_summary,
        session=session,
        previous_summary=previous_summary,
        turns_to_fold=turns_to_fold,
    )


async def build_compacted_session_context(
    *,
    session_store: SessionStore,
    session_id: str,
) -> CompactedSessionContext:
    session = session_store.get_session(session_id)
    if session is None:
        raise KeyError(session_id)

    transcript = session_store.list_turns(session_id)
    finalized_payload = build_finalized_transcript_payload(
        session=session,
        transcript=transcript,
    )
    finalized_turns = finalized_payload.turns
    latest_turn_sequence = finalized_turns[-1].turn_sequence if finalized_turns else None

    latest_semantic_checkpoint = session_store.get_latest_semantic_checkpoint(session_id)
    compaction_state = _load_compaction_state(latest_semantic_checkpoint)

    compacted_through_sequence = (
        compaction_state.compacted_through_sequence if compaction_state else 0
    )
    summary_text = compaction_state.summary_text if compaction_state else None

    recent_raw_turns = [
        turn
        for turn in finalized_turns
        if turn.turn_sequence > compacted_through_sequence
    ]
    has_prior_compaction = compaction_state is not None and compacted_through_sequence > 0

    if _should_compact(
        has_prior_compaction=has_prior_compaction,
        raw_turn_count=len(recent_raw_turns),
    ):
        turns_to_keep_raw = recent_raw_turns[-RAW_TURNS_AFTER_COMPACTION:]
        turns_to_fold = recent_raw_turns[:-RAW_TURNS_AFTER_COMPACTION]
        if turns_to_fold:
            updated_summary, model_name = await _generate_updated_summary_async(
                session=session,
                previous_summary=summary_text,
                turns_to_fold=turns_to_fold,
            )
            compacted_through_sequence = turns_to_fold[-1].turn_sequence
            session_store.create_checkpoint(
                session_id,
                CheckpointCreateRequest(
                    checkpoint_type="semantic",
                    save_reason="session_compaction",
                    trigger_source="session_turn_persisted",
                    summary=updated_summary,
                    payload=CompactedSessionState(
                        summary_text=updated_summary,
                        compacted_through_sequence=compacted_through_sequence,
                        updated_at=_now_iso(),
                        source_turn_count=len(finalized_turns),
                        recent_raw_count_after_compaction=len(turns_to_keep_raw),
                        model=model_name,
                    ).model_dump(mode="python", by_alias=False),
                    related_turn_sequence=compacted_through_sequence,
                ),
            )
            summary_text = updated_summary
            recent_raw_turns = turns_to_keep_raw

    needs_recompaction = _should_compact(
        has_prior_compaction=compacted_through_sequence > 0,
        raw_turn_count=len(recent_raw_turns),
    )

    return CompactedSessionContext(
        session_id=session.session_id,
        topic=session.topic,
        goal=session.goal,
        summary_text=summary_text,
        recent_raw_turns=recent_raw_turns,
        raw_turn_count=len(recent_raw_turns),
        compacted_through_sequence=compacted_through_sequence,
        latest_turn_sequence=latest_turn_sequence,
        total_finalized_turn_count=len(finalized_turns),
        needs_recompaction=needs_recompaction,
    )
