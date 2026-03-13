"""Session key moment generation and artifact storage helpers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Protocol

from google.cloud import firestore
from google.genai import Client
from google.genai import types as genai_types
from pydantic import BaseModel, ConfigDict, Field

from session_store import SessionRecord, TranscriptTurnRecord
from thinkspace_agent.config import get_key_moment_generation_model
from thinkspace_agent.context.session_compaction import (
    build_finalized_transcript_payload,
)

logger = logging.getLogger(__name__)


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_text(value: str) -> str:
    return " ".join(value.split()).strip()


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class PreprocessedTranscriptTurn(ApiModel):
    turn_id: str
    turn_sequence: int
    start_timestamp: str
    user_text: str | None = None
    agent_text: str | None = None


class PreprocessedTranscriptPayload(ApiModel):
    session_id: str
    topic: str
    goal: str | None = None
    session_start_timestamp: str
    session_end_timestamp: str
    turns: list[PreprocessedTranscriptTurn] = []


class GeneratedKeyMomentCandidate(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    summary: str = Field(min_length=1, max_length=280)
    start_turn_sequence: int = Field(ge=1)
    end_turn_sequence: int = Field(ge=1)


class GeneratedKeyMomentPayload(BaseModel):
    moments: list[GeneratedKeyMomentCandidate] = Field(min_length=1, max_length=8)


class SessionKeyMoment(ApiModel):
    id: str
    title: str
    summary: str
    start_turn_sequence: int
    end_turn_sequence: int
    start_timestamp: str


class SessionKeyMomentArtifact(ApiModel):
    session_id: str
    status: Literal["completed"]
    key_moments: list[SessionKeyMoment] = []
    generated_at: str
    model: str
    source_transcript_turn_count: int
    source_transcript_hash: str


class KeyMomentGenerationDebug(ApiModel):
    prompt: str
    transcript_input: PreprocessedTranscriptPayload
    raw_response_payload: dict[str, object] | list[object] | None = None


class KeyMomentGenerationResponse(ApiModel):
    artifact: SessionKeyMomentArtifact
    debug: KeyMomentGenerationDebug | None = None


class KeyMomentStore(Protocol):
    def get_artifact(self, session_id: str) -> SessionKeyMomentArtifact | None: ...

    def save_artifact(
        self, artifact: SessionKeyMomentArtifact
    ) -> SessionKeyMomentArtifact: ...


class LocalFileKeyMomentStore:
    """Persist session key moments to local JSON files."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def get_artifact(self, session_id: str) -> SessionKeyMomentArtifact | None:
        artifact_path = self._artifact_path(session_id)
        if not artifact_path.exists():
            return None
        data = json.loads(artifact_path.read_text())
        return SessionKeyMomentArtifact.model_validate(data)

    def save_artifact(
        self, artifact: SessionKeyMomentArtifact
    ) -> SessionKeyMomentArtifact:
        artifact_path = self._artifact_path(artifact.session_id)
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(artifact.model_dump(mode="json", by_alias=False), indent=2)
        )
        return artifact

    def _artifact_path(self, session_id: str) -> Path:
        return self._root_dir / f"{session_id}.json"


class FirestoreKeyMomentStore:
    """Persist session key moments to Firestore."""

    def __init__(
        self,
        *,
        project: str | None = None,
        prefix: str = "thinkspace",
        database: str | None = None,
    ) -> None:
        self._db = firestore.Client(project=project, database=database)
        self._collection = self._db.collection(f"{prefix}_session_key_moments")

    def get_artifact(self, session_id: str) -> SessionKeyMomentArtifact | None:
        snapshot = self._collection.document(session_id).get()
        if not snapshot.exists:
            return None
        return SessionKeyMomentArtifact.model_validate(snapshot.to_dict() or {})

    def save_artifact(
        self, artifact: SessionKeyMomentArtifact
    ) -> SessionKeyMomentArtifact:
        self._collection.document(artifact.session_id).set(
            artifact.model_dump(mode="python", by_alias=False)
        )
        return artifact


def create_key_moment_store(local_root_dir: Path) -> KeyMomentStore:
    """Create the session key moment artifact store from environment configuration."""

    backend = os.getenv("THINKSPACE_SESSION_STORE_BACKEND", "auto").lower()
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
    database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")

    if backend == "memory":
        logger.info("Using local-file key moment artifact store")
        return LocalFileKeyMomentStore(local_root_dir)

    if backend in {"auto", "firestore"} and project:
        try:
            logger.info("Using Firestore key moment artifact store")
            return FirestoreKeyMomentStore(
                project=project,
                prefix=prefix,
                database=database,
            )
        except Exception:
            logger.exception("Falling back to local-file key moment artifact store")

    logger.info("Using local-file key moment artifact store")
    return LocalFileKeyMomentStore(local_root_dir)


def _build_client() -> Client:
    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def preprocess_session_transcript(
    *,
    session: SessionRecord,
    transcript: list[TranscriptTurnRecord],
) -> PreprocessedTranscriptPayload:
    """Reduce the persisted transcript into turn-level LLM input."""

    finalized_payload = build_finalized_transcript_payload(
        session=session,
        transcript=transcript,
    )
    turns = [
        PreprocessedTranscriptTurn(
            turn_id=turn.turn_id,
            turn_sequence=turn.turn_sequence,
            start_timestamp=turn.start_timestamp,
            user_text=turn.user_text,
            agent_text=turn.agent_text,
        )
        for turn in finalized_payload.turns
    ]

    if not turns:
        raise ValueError("Transcript does not contain any final user/agent entries")

    return PreprocessedTranscriptPayload(
        session_id=session.session_id,
        topic=session.topic,
        goal=session.goal,
        session_start_timestamp=turns[0].start_timestamp,
        session_end_timestamp=turns[-1].start_timestamp,
        turns=turns,
    )


def _build_key_moment_prompt(payload: PreprocessedTranscriptPayload) -> str:
    serialized_payload = json.dumps(
        payload.model_dump(mode="json", by_alias=True),
        ensure_ascii=True,
        indent=2,
    )
    return "\n".join(
        [
            "You are an expert tutor reviewing a ThinkSpace learning session.",
            "Your job is to identify the actual teaching topics or substantive discussions",
            "that a learner would want to revisit on a session summary page.",
            "The input is a preprocessed turn-level transcript.",
            "Each turn contains the learner's final transcription, the agent's final agent-text, and the turn start timestamp.",
            "Treat a key moment as a meaningful learning segment, not merely a notable exchange.",
            "Requirements:",
            "- Return between 1 and 8 key moments.",
            "- Each key moment must describe a contiguous range of turns.",
            "- Prefer major explanations, core concepts, topic shifts, clarifications, corrections, worked examples, or decision points tied to the subject matter.",
            "- Focus on what was taught or discussed, not on conversational control flow.",
            "- If the transcript mainly covers one substantive topic, return one key moment for that topic rather than multiple weak moments.",
            "- Do not create a key moment just because the learner greeted the tutor, asked for help, asked what was discussed previously, or because the tutor recalled prior context.",
            "- Do not treat recap-only, memory-only, or administrative turns as key moments unless they introduce new subject-matter content.",
            "- Ignore greetings, filler, low-information turns, and duplicate moments.",
            "- Keep titles concise and specific.",
            "- Keep summaries factual and grounded in the transcript.",
            "- Titles and summaries should describe the learning topic, concept, or explanation itself.",
            "- Sort moments by start_turn_sequence.",
            "",
            "Good key moment examples:",
            '- "Introduction to Convolutional Neural Networks"',
            '- "Tutor Explains Backpropagation"',
            '- "Clarifying Overfitting vs Underfitting"',
            "",
            "Bad key moment examples:",
            '- "User Says Hello"',
            '- "Tutor Offers Help"',
            '- "Recalling Prior Conversation"',
            '- "Asking What We Discussed Before"',
            "",
            "Transcript JSON:",
            serialized_payload,
        ]
    )


def _resolve_turn_sequence(
    candidate_sequence: int,
    available_sequences: list[int],
) -> int:
    if candidate_sequence in available_sequences:
        return candidate_sequence
    return min(available_sequences, key=lambda sequence: abs(sequence - candidate_sequence))


def _normalize_generated_moments(
    *,
    payload: GeneratedKeyMomentPayload,
    transcript_payload: PreprocessedTranscriptPayload,
) -> list[SessionKeyMoment]:
    turn_by_sequence = {
        turn.turn_sequence: turn for turn in transcript_payload.turns
    }
    available_sequences = sorted(turn_by_sequence.keys())
    normalized_moments: list[SessionKeyMoment] = []
    seen_ranges: set[tuple[int, int]] = set()

    for index, moment in enumerate(
        sorted(
            payload.moments,
            key=lambda item: (item.start_turn_sequence, item.end_turn_sequence),
        ),
        start=1,
    ):
        start_sequence = _resolve_turn_sequence(
            moment.start_turn_sequence,
            available_sequences,
        )
        end_sequence = _resolve_turn_sequence(
            moment.end_turn_sequence,
            available_sequences,
        )
        if end_sequence < start_sequence:
            start_sequence, end_sequence = end_sequence, start_sequence

        moment_range = (start_sequence, end_sequence)
        if moment_range in seen_ranges:
            continue
        seen_ranges.add(moment_range)

        start_turn = turn_by_sequence[start_sequence]
        normalized_moments.append(
            SessionKeyMoment(
                id=f"moment-{index}",
                title=_normalize_text(moment.title),
                summary=_normalize_text(moment.summary),
                start_turn_sequence=start_sequence,
                end_turn_sequence=end_sequence,
                start_timestamp=start_turn.start_timestamp,
            )
        )

    if not normalized_moments:
        raise ValueError("Key moment generator returned no valid moments")

    return normalized_moments


def _generate_key_moment_response(
    *,
    session: SessionRecord,
    transcript: list[TranscriptTurnRecord],
) -> KeyMomentGenerationResponse:
    transcript_payload = preprocess_session_transcript(
        session=session,
        transcript=transcript,
    )
    prompt = _build_key_moment_prompt(transcript_payload)
    source_transcript_hash = hashlib.sha256(
        json.dumps(
            transcript_payload.model_dump(mode="json", by_alias=True),
            ensure_ascii=True,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()

    client = _build_client()
    response = client.models.generate_content(
        model=get_key_moment_generation_model(),
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=GeneratedKeyMomentPayload,
        ),
    )
    if response.parsed is None:
        raise ValueError("Key moment generator returned no structured payload")

    raw_response_payload = (
        response.parsed.model_dump()
        if isinstance(response.parsed, BaseModel)
        else response.parsed
    )
    generated_payload = GeneratedKeyMomentPayload.model_validate(response.parsed)
    key_moments = _normalize_generated_moments(
        payload=generated_payload,
        transcript_payload=transcript_payload,
    )

    artifact = SessionKeyMomentArtifact(
        session_id=session.session_id,
        status="completed",
        key_moments=key_moments,
        generated_at=_now_iso(),
        model=get_key_moment_generation_model(),
        source_transcript_turn_count=len(transcript_payload.turns),
        source_transcript_hash=source_transcript_hash,
    )
    return KeyMomentGenerationResponse(
        artifact=artifact,
        debug=KeyMomentGenerationDebug(
            prompt=prompt,
            transcript_input=transcript_payload,
            raw_response_payload=raw_response_payload
            if isinstance(raw_response_payload, (dict, list))
            else None,
        ),
    )


async def generate_key_moment_response(
    *,
    session: SessionRecord,
    transcript: list[TranscriptTurnRecord],
) -> KeyMomentGenerationResponse:
    """Generate a session key moment artifact without blocking the event loop."""

    return await asyncio.to_thread(
        _generate_key_moment_response,
        session=session,
        transcript=transcript,
    )
