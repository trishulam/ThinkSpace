"""Session notes generation and artifact storage helpers."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Protocol

from google.genai import Client
from google.genai import types as genai_types
from pydantic import BaseModel, ConfigDict
from google_cloud_clients import get_firestore_client

from session_key_moments import preprocess_session_transcript
from session_store import SessionRecord, TranscriptTurnRecord
from thinkspace_agent.config import get_notes_generation_model

logger = logging.getLogger(__name__)


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_markdown(value: str) -> str:
    return value.strip()


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class SessionNotesArtifact(ApiModel):
    session_id: str
    status: Literal["completed"]
    notes_markdown: str
    generated_at: str
    model: str
    source_transcript_turn_count: int
    source_transcript_hash: str


class NotesStore(Protocol):
    def get_artifact(self, session_id: str) -> SessionNotesArtifact | None: ...

    def save_artifact(self, artifact: SessionNotesArtifact) -> SessionNotesArtifact: ...

    def delete_artifact(self, session_id: str) -> None: ...


class LocalFileNotesStore:
    """Persist session notes to local JSON files."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def get_artifact(self, session_id: str) -> SessionNotesArtifact | None:
        artifact_path = self._artifact_path(session_id)
        if not artifact_path.exists():
            return None
        data = json.loads(artifact_path.read_text())
        return SessionNotesArtifact.model_validate(data)

    def save_artifact(self, artifact: SessionNotesArtifact) -> SessionNotesArtifact:
        artifact_path = self._artifact_path(artifact.session_id)
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text(
            json.dumps(artifact.model_dump(mode="json", by_alias=False), indent=2)
        )
        return artifact

    def delete_artifact(self, session_id: str) -> None:
        artifact_path = self._artifact_path(session_id)
        if artifact_path.exists():
            artifact_path.unlink()

    def _artifact_path(self, session_id: str) -> Path:
        return self._root_dir / f"{session_id}.json"


class FirestoreNotesStore:
    """Persist session notes to Firestore."""

    def __init__(
        self,
        *,
        project: str | None = None,
        prefix: str = "thinkspace",
        database: str | None = None,
    ) -> None:
        self._db = get_firestore_client(project=project, database=database)
        self._collection = self._db.collection(f"{prefix}_session_notes")

    def get_artifact(self, session_id: str) -> SessionNotesArtifact | None:
        snapshot = self._collection.document(session_id).get()
        if not snapshot.exists:
            return None
        return SessionNotesArtifact.model_validate(snapshot.to_dict() or {})

    def save_artifact(self, artifact: SessionNotesArtifact) -> SessionNotesArtifact:
        self._collection.document(artifact.session_id).set(
            artifact.model_dump(mode="python", by_alias=False)
        )
        return artifact

    def delete_artifact(self, session_id: str) -> None:
        self._collection.document(session_id).delete()


def create_notes_store(local_root_dir: Path) -> NotesStore:
    """Create the session notes artifact store from environment configuration."""

    backend = os.getenv("THINKSPACE_SESSION_STORE_BACKEND", "auto").lower()
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
    database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")

    if backend == "memory":
        logger.info("Using local-file notes artifact store")
        return LocalFileNotesStore(local_root_dir)

    if backend in {"auto", "firestore"} and project:
        try:
            logger.info("Using Firestore notes artifact store")
            return FirestoreNotesStore(
                project=project,
                prefix=prefix,
                database=database,
            )
        except Exception:
            logger.exception("Falling back to local-file notes artifact store")

    logger.info("Using local-file notes artifact store")
    return LocalFileNotesStore(local_root_dir)


def _build_client() -> Client:
    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def _build_notes_prompt(session: SessionRecord, transcript: list[TranscriptTurnRecord]) -> str:
    transcript_payload = preprocess_session_transcript(
        session=session,
        transcript=transcript,
    )
    serialized_payload = json.dumps(
        transcript_payload.model_dump(mode="json", by_alias=True),
        ensure_ascii=True,
        indent=2,
    )
    return "\n".join(
        [
            "You are an expert tutor reviewing a ThinkSpace learning session.",
            "Your job is to generate comprehensive session notes in Markdown.",
            "The notes should help a learner revisit the session later.",
            "The input is a preprocessed turn-level transcript with the learner's final",
            "transcription and the tutor's final response for each turn.",
            "Requirements:",
            "- Return valid Markdown only.",
            '- Start with "# Session Notes".',
            "- Include a short overview near the top.",
            "- Cover all substantive topics discussed in the session.",
            "- Use ## headings for major topics and ### headings for subtopics when helpful.",
            "- Capture key concepts, definitions, explanations, examples, comparisons, worked steps, and corrections that were actually discussed.",
            "- Keep the notes factual and grounded in the transcript.",
            "- Omit greetings, filler, and administrative/control-flow chatter.",
            "- Do not mention missing information, prompt instructions, or the transcript JSON.",
            "- If the session mostly focuses on one topic, organize the notes around that topic rather than forcing many weak sections.",
            "",
            "Transcript JSON:",
            serialized_payload,
        ]
    )


def _generate_notes_artifact(
    *,
    session: SessionRecord,
    transcript: list[TranscriptTurnRecord],
) -> SessionNotesArtifact:
    transcript_payload = preprocess_session_transcript(
        session=session,
        transcript=transcript,
    )
    prompt = _build_notes_prompt(session, transcript)
    source_transcript_hash = hashlib.sha256(
        json.dumps(
            transcript_payload.model_dump(mode="json", by_alias=True),
            ensure_ascii=True,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()

    model_name = get_notes_generation_model()
    client = _build_client()
    response = client.models.generate_content(
        model=model_name,
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="text/plain",
        ),
    )
    notes_markdown = _normalize_markdown(response.text or "")
    if not notes_markdown:
        raise ValueError("Notes generator returned empty markdown")

    return SessionNotesArtifact(
        session_id=session.session_id,
        status="completed",
        notes_markdown=notes_markdown,
        generated_at=_now_iso(),
        model=model_name,
        source_transcript_turn_count=len(transcript_payload.turns),
        source_transcript_hash=source_transcript_hash,
    )


async def generate_session_notes_artifact(
    *,
    session: SessionRecord,
    transcript: list[TranscriptTurnRecord],
) -> SessionNotesArtifact:
    """Generate a session notes artifact without blocking the event loop."""

    return await asyncio.to_thread(
        _generate_notes_artifact,
        session=session,
        transcript=transcript,
    )
