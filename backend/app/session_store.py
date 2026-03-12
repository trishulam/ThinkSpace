"""Session metadata and checkpoint storage primitives."""

from __future__ import annotations

import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Literal, Protocol
from uuid import uuid4

from google.cloud import firestore, storage
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)
INLINE_CHECKPOINT_JSON_LIMIT = 700_000

SessionMode = Literal["guided", "socratic", "challenge"]
SessionLevel = Literal["beginner", "intermediate", "advanced"]
CheckpointType = Literal["material", "semantic", "hybrid"]


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class SessionCreateRequest(ApiModel):
    user_id: str = "demo-user"
    topic: str = Field(min_length=1)
    goal: str | None = None
    mode: SessionMode = "guided"
    level: SessionLevel = "beginner"


class SessionRecord(ApiModel):
    session_id: str
    user_id: str
    topic: str
    goal: str | None = None
    mode: SessionMode
    level: SessionLevel
    status: str = "active"
    created_at: datetime
    updated_at: datetime
    last_active_at: datetime
    duration_ms: int = 0
    summary: str | None = None
    last_user_message_preview: str | None = None
    last_agent_message_preview: str | None = None
    latest_checkpoint_id: str | None = None
    latest_material_checkpoint_id: str | None = None
    checkpoint_count: int = 0
    milestone_count: int = 0
    adk_session_id: str | None = None
    adk_last_update_time: float | None = None
    adk_event_count: int = 0
    adk_state_key_count: int = 0
    adk_latest_invocation_id: str | None = None


class CheckpointCreateRequest(ApiModel):
    checkpoint_type: CheckpointType = "material"
    save_reason: str = "manual"
    trigger_source: str = "frontend_manual"
    label: str | None = None
    summary: str | None = None
    is_important: bool = False
    include_in_replay: bool = False
    document: dict[str, Any] | None = None
    session: dict[str, Any] | None = None
    agent_app_state: dict[str, Any] | None = None
    payload: dict[str, Any] | None = None
    linked_material_checkpoint_id: str | None = None
    related_turn_sequence: int | None = None
    client_updated_at: datetime | None = None


class CheckpointRecord(ApiModel):
    checkpoint_id: str
    session_id: str
    version: int
    created_at: datetime
    checkpoint_type: CheckpointType
    save_reason: str
    trigger_source: str
    label: str | None = None
    summary: str | None = None
    is_important: bool = False
    include_in_replay: bool = False
    related_turn_sequence: int | None = None
    linked_material_checkpoint_id: str | None = None
    document: dict[str, Any] | None = None
    session: dict[str, Any] | None = None
    agent_app_state: dict[str, Any] | None = None
    payload: dict[str, Any] | None = None
    document_path: str | None = None
    session_path: str | None = None
    agent_app_state_path: str | None = None
    payload_path: str | None = None


class TranscriptEntryRecord(ApiModel):
    """Single log entry within a transcript turn (maps to AgentLogEntry)."""

    type: str  # user-transcription, agent-transcription, user-text, agent-text, system
    content: str
    timestamp: str  # ISO format
    is_partial: bool = False


class TranscriptTurnRecord(ApiModel):
    """One turn in the agent transcript (user input + agent response)."""

    turn_id: str
    sequence: int
    session_id: str
    entries: list[TranscriptEntryRecord]
    status: str = "completed"  # completed | interrupted
    completed_at: str  # ISO format


class AdkSessionSummary(ApiModel):
    session_id: str
    user_id: str
    event_count: int = 0
    state_key_count: int = 0
    last_update_time: float | None = None
    latest_invocation_id: str | None = None


class SessionResumeResponse(ApiModel):
    session: SessionRecord
    latest_checkpoint: CheckpointRecord | None = None
    transcript: list[TranscriptTurnRecord] = []
    adk_session: AdkSessionSummary | None = None


class SessionListResponse(ApiModel):
    sessions: list[SessionRecord]


class SessionStore(Protocol):
    def create_session(self, request: SessionCreateRequest) -> SessionRecord: ...
    def list_sessions(self, user_id: str | None = None) -> list[SessionRecord]: ...
    def get_session(self, session_id: str) -> SessionRecord | None: ...
    def create_checkpoint(
        self, session_id: str, request: CheckpointCreateRequest
    ) -> CheckpointRecord: ...
    def get_latest_checkpoint(self, session_id: str) -> CheckpointRecord | None: ...
    def complete_session(self, session_id: str) -> SessionRecord: ...
    def create_turn(
        self, session_id: str, request: TranscriptTurnRecord
    ) -> TranscriptTurnRecord: ...
    def list_turns(self, session_id: str) -> list[TranscriptTurnRecord]: ...
    def update_adk_session_summary(
        self, session_id: str, summary: AdkSessionSummary | None
    ) -> SessionRecord: ...


class InMemorySessionStore:
    """Minimal local session store."""

    def __init__(self) -> None:
        self._sessions: dict[str, SessionRecord] = {}
        self._checkpoints: dict[str, list[CheckpointRecord]] = defaultdict(list)
        self._turns: dict[str, list[TranscriptTurnRecord]] = defaultdict(list)

    def create_session(self, request: SessionCreateRequest) -> SessionRecord:
        now = _now_utc()
        topic = request.topic.strip()
        if not topic:
            raise ValueError("Topic must not be empty")

        session = SessionRecord(
            session_id=uuid4().hex,
            user_id=request.user_id.strip() or "demo-user",
            topic=topic,
            goal=request.goal.strip() if request.goal else None,
            mode=request.mode,
            level=request.level,
            created_at=now,
            updated_at=now,
            last_active_at=now,
        )
        self._sessions[session.session_id] = session
        return session

    def list_sessions(self, user_id: str | None = None) -> list[SessionRecord]:
        sessions = list(self._sessions.values())
        if user_id:
            sessions = [session for session in sessions if session.user_id == user_id]
        return sorted(sessions, key=lambda session: session.updated_at, reverse=True)

    def get_session(self, session_id: str) -> SessionRecord | None:
        return self._sessions.get(session_id)

    def create_checkpoint(
        self, session_id: str, request: CheckpointCreateRequest
    ) -> CheckpointRecord:
        session = self.get_session(session_id)
        if session is None:
            raise KeyError(session_id)

        checkpoints = self._checkpoints[session_id]
        checkpoint = CheckpointRecord(
            checkpoint_id=uuid4().hex,
            session_id=session_id,
            version=len(checkpoints) + 1,
            created_at=_now_utc(),
            checkpoint_type=request.checkpoint_type,
            save_reason=request.save_reason,
            trigger_source=request.trigger_source,
            label=request.label,
            summary=request.summary,
            is_important=request.is_important,
            include_in_replay=request.include_in_replay,
            related_turn_sequence=request.related_turn_sequence,
            linked_material_checkpoint_id=request.linked_material_checkpoint_id,
            document=request.document,
            session=request.session,
            agent_app_state=request.agent_app_state,
            payload=request.payload,
        )
        checkpoints.append(checkpoint)
        self._update_session_from_checkpoint(session, checkpoint)
        return checkpoint

    def get_latest_checkpoint(self, session_id: str) -> CheckpointRecord | None:
        session = self.get_session(session_id)
        checkpoints = self._checkpoints.get(session_id, [])
        if session and session.latest_material_checkpoint_id:
            for checkpoint in reversed(checkpoints):
                if checkpoint.checkpoint_id == session.latest_material_checkpoint_id:
                    return checkpoint
        for checkpoint in reversed(checkpoints):
            if checkpoint.document or checkpoint.session or checkpoint.checkpoint_type != "semantic":
                return checkpoint
        return checkpoints[-1] if checkpoints else None

    def complete_session(self, session_id: str) -> SessionRecord:
        session = self.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        now = _now_utc()
        session.status = "completed"
        session.updated_at = now
        session.last_active_at = now
        return session

    def create_turn(
        self, session_id: str, request: TranscriptTurnRecord
    ) -> TranscriptTurnRecord:
        turns = self._turns[session_id]
        turns.append(request)
        return request

    def list_turns(self, session_id: str) -> list[TranscriptTurnRecord]:
        return list(self._turns.get(session_id, []))

    def update_adk_session_summary(
        self, session_id: str, summary: AdkSessionSummary | None
    ) -> SessionRecord:
        session = self.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        self._apply_adk_session_summary(session, summary)
        return session

    def _update_session_from_checkpoint(
        self, session: SessionRecord, checkpoint: CheckpointRecord
    ) -> None:
        session.updated_at = checkpoint.created_at
        session.last_active_at = checkpoint.created_at
        session.latest_checkpoint_id = checkpoint.checkpoint_id
        if checkpoint.document or checkpoint.session:
            session.latest_material_checkpoint_id = checkpoint.checkpoint_id
        session.checkpoint_count = checkpoint.version
        if checkpoint.checkpoint_type != "material" or checkpoint.is_important:
            session.milestone_count += 1
        if checkpoint.summary:
            session.summary = checkpoint.summary

    def _apply_adk_session_summary(
        self, session: SessionRecord, summary: AdkSessionSummary | None
    ) -> None:
        if summary is None:
            session.adk_session_id = None
            session.adk_last_update_time = None
            session.adk_event_count = 0
            session.adk_state_key_count = 0
            session.adk_latest_invocation_id = None
            return

        session.adk_session_id = summary.session_id
        session.adk_last_update_time = summary.last_update_time
        session.adk_event_count = summary.event_count
        session.adk_state_key_count = summary.state_key_count
        session.adk_latest_invocation_id = summary.latest_invocation_id


class FirestoreSessionStore:
    """Firestore and GCS-backed session metadata store."""

    def __init__(
        self,
        project: str | None = None,
        bucket_name: str | None = None,
        prefix: str = "thinkspace",
        database: str | None = None,
    ) -> None:
        self._db = firestore.Client(project=project, database=database)
        self._bucket_name = bucket_name
        self._bucket = storage.Client(project=project).bucket(bucket_name) if bucket_name else None
        self._sessions = self._db.collection(f"{prefix}_sessions")

    def create_session(self, request: SessionCreateRequest) -> SessionRecord:
        now = _now_utc()
        topic = request.topic.strip()
        if not topic:
            raise ValueError("Topic must not be empty")

        session = SessionRecord(
            session_id=uuid4().hex,
            user_id=request.user_id.strip() or "demo-user",
            topic=topic,
            goal=request.goal.strip() if request.goal else None,
            mode=request.mode,
            level=request.level,
            created_at=now,
            updated_at=now,
            last_active_at=now,
        )
        self._sessions.document(session.session_id).set(
            session.model_dump(mode="python", by_alias=False)
        )
        return session

    def list_sessions(self, user_id: str | None = None) -> list[SessionRecord]:
        snapshots = self._sessions.stream()
        sessions = [
            SessionRecord.model_validate(snapshot.to_dict() or {})
            for snapshot in snapshots
            if snapshot.exists
        ]
        if user_id:
            sessions = [session for session in sessions if session.user_id == user_id]
        return sorted(sessions, key=lambda session: session.updated_at, reverse=True)

    def get_session(self, session_id: str) -> SessionRecord | None:
        snapshot = self._sessions.document(session_id).get()
        if not snapshot.exists:
            return None
        return SessionRecord.model_validate(snapshot.to_dict() or {})

    def create_checkpoint(
        self, session_id: str, request: CheckpointCreateRequest
    ) -> CheckpointRecord:
        session = self.get_session(session_id)
        if session is None:
            raise KeyError(session_id)

        checkpoint_id = uuid4().hex
        version = self._get_next_checkpoint_version(session_id)
        created_at = _now_utc()
        base_path = f"sessions/{session_id}/checkpoints/{checkpoint_id}"
        document, document_path = self._store_json_payload(
            f"{base_path}/document.json", request.document
        )
        session_payload, session_path = self._store_json_payload(
            f"{base_path}/session.json", request.session
        )
        agent_app_state, agent_app_state_path = self._store_json_payload(
            f"{base_path}/agent-app-state.json", request.agent_app_state
        )
        payload, payload_path = self._store_json_payload(
            f"{base_path}/payload.json", request.payload
        )

        checkpoint = CheckpointRecord(
            checkpoint_id=checkpoint_id,
            session_id=session_id,
            version=version,
            created_at=created_at,
            checkpoint_type=request.checkpoint_type,
            save_reason=request.save_reason,
            trigger_source=request.trigger_source,
            label=request.label,
            summary=request.summary,
            is_important=request.is_important,
            include_in_replay=request.include_in_replay,
            related_turn_sequence=request.related_turn_sequence,
            linked_material_checkpoint_id=request.linked_material_checkpoint_id,
            document=document,
            session=session_payload,
            agent_app_state=agent_app_state,
            payload=payload,
            document_path=document_path,
            session_path=session_path,
            agent_app_state_path=agent_app_state_path,
            payload_path=payload_path,
        )

        self._sessions.document(session_id).collection("checkpoints").document(checkpoint_id).set(
            checkpoint.model_dump(mode="python", by_alias=False)
        )
        self._update_session_from_checkpoint(session, checkpoint)
        self._sessions.document(session_id).set(
            session.model_dump(mode="python", by_alias=False),
            merge=True,
        )
        return checkpoint

    def get_latest_checkpoint(self, session_id: str) -> CheckpointRecord | None:
        session = self.get_session(session_id)
        if session is None:
            return None

        if session.latest_material_checkpoint_id:
            snapshot = (
                self._sessions.document(session_id)
                .collection("checkpoints")
                .document(session.latest_material_checkpoint_id)
                .get()
            )
            if snapshot.exists:
                return self._hydrate_checkpoint(
                    CheckpointRecord.model_validate(snapshot.to_dict() or {})
                )

        checkpoints = list(
            self._sessions.document(session_id)
            .collection("checkpoints")
            .order_by("version", direction=firestore.Query.DESCENDING)
            .limit(1)
            .stream()
        )
        if not checkpoints:
            return None
        return self._hydrate_checkpoint(
            CheckpointRecord.model_validate(checkpoints[0].to_dict() or {})
        )

    def complete_session(self, session_id: str) -> SessionRecord:
        session = self.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        now = _now_utc()
        session.status = "completed"
        session.updated_at = now
        session.last_active_at = now
        self._sessions.document(session_id).set(
            session.model_dump(mode="python", by_alias=False),
            merge=True,
        )
        return session

    def create_turn(
        self, session_id: str, request: TranscriptTurnRecord
    ) -> TranscriptTurnRecord:
        turns_ref = self._sessions.document(session_id).collection("turns")
        data = request.model_dump(mode="python", by_alias=False)
        turns_ref.document(request.turn_id).set(data)
        return request

    def list_turns(self, session_id: str) -> list[TranscriptTurnRecord]:
        turns_ref = self._sessions.document(session_id).collection("turns")
        turns = [
            TranscriptTurnRecord.model_validate(doc.to_dict() or {})
            for doc in turns_ref.order_by("sequence", direction=firestore.Query.ASCENDING).stream()
        ]
        return turns

    def update_adk_session_summary(
        self, session_id: str, summary: AdkSessionSummary | None
    ) -> SessionRecord:
        session = self.get_session(session_id)
        if session is None:
            raise KeyError(session_id)
        self._apply_adk_session_summary(session, summary)
        self._sessions.document(session_id).set(
            session.model_dump(mode="python", by_alias=False),
            merge=True,
        )
        return session

    def _get_next_checkpoint_version(self, session_id: str) -> int:
        checkpoints = list(
            self._sessions.document(session_id)
            .collection("checkpoints")
            .order_by("version", direction=firestore.Query.DESCENDING)
            .limit(1)
            .stream()
        )
        if not checkpoints:
            return 1
        latest = checkpoints[0].to_dict() or {}
        return int(latest.get("version", 0)) + 1

    def _store_json_payload(
        self, object_path: str, payload: dict[str, Any] | None
    ) -> tuple[dict[str, Any] | None, str | None]:
        if not payload:
            return None, None

        payload_json = json.dumps(payload)
        if not self._bucket or len(payload_json.encode("utf-8")) <= INLINE_CHECKPOINT_JSON_LIMIT:
            return payload, None

        blob = self._bucket.blob(object_path)
        blob.upload_from_string(payload_json, content_type="application/json")
        return None, object_path

    def _maybe_download_json(self, object_path: str | None) -> dict[str, Any] | None:
        if not object_path or not self._bucket:
            return None
        blob = self._bucket.blob(object_path)
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())

    def _hydrate_checkpoint(self, checkpoint: CheckpointRecord) -> CheckpointRecord:
        checkpoint.document = checkpoint.document or self._maybe_download_json(
            checkpoint.document_path
        )
        checkpoint.session = checkpoint.session or self._maybe_download_json(
            checkpoint.session_path
        )
        checkpoint.agent_app_state = checkpoint.agent_app_state or self._maybe_download_json(
            checkpoint.agent_app_state_path
        )
        checkpoint.payload = checkpoint.payload or self._maybe_download_json(
            checkpoint.payload_path
        )
        return checkpoint

    def _update_session_from_checkpoint(
        self, session: SessionRecord, checkpoint: CheckpointRecord
    ) -> None:
        session.updated_at = checkpoint.created_at
        session.last_active_at = checkpoint.created_at
        session.latest_checkpoint_id = checkpoint.checkpoint_id
        if checkpoint.document or checkpoint.session:
            session.latest_material_checkpoint_id = checkpoint.checkpoint_id
        session.checkpoint_count = checkpoint.version
        if checkpoint.checkpoint_type != "material" or checkpoint.is_important:
            session.milestone_count += 1
        if checkpoint.summary:
            session.summary = checkpoint.summary

    def _apply_adk_session_summary(
        self, session: SessionRecord, summary: AdkSessionSummary | None
    ) -> None:
        if summary is None:
            session.adk_session_id = None
            session.adk_last_update_time = None
            session.adk_event_count = 0
            session.adk_state_key_count = 0
            session.adk_latest_invocation_id = None
            return

        session.adk_session_id = summary.session_id
        session.adk_last_update_time = summary.last_update_time
        session.adk_event_count = summary.event_count
        session.adk_state_key_count = summary.state_key_count
        session.adk_latest_invocation_id = summary.latest_invocation_id


def create_session_store() -> SessionStore:
    """Create the session metadata store from environment configuration."""
    backend = os.getenv("THINKSPACE_SESSION_STORE_BACKEND", "auto").lower()
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    bucket_name = os.getenv("THINKSPACE_GCS_BUCKET")
    prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
    database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")

    if backend == "memory":
        logger.info("Using in-memory session metadata store")
        return InMemorySessionStore()

    if backend in {"auto", "firestore"} and project:
        try:
            logger.info(
                "Using Firestore session metadata store%s",
                f" with GCS bucket {bucket_name}" if bucket_name else "",
            )
            return FirestoreSessionStore(
                project=project,
                bucket_name=bucket_name,
                prefix=prefix,
                database=database,
            )
        except Exception:
            logger.exception("Falling back to in-memory session metadata store")

    logger.info("Using in-memory session metadata store")
    return InMemorySessionStore()
