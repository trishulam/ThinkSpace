"""Replay artifact status persistence and helpers."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Protocol

from google.cloud import firestore
from pydantic import BaseModel, ConfigDict

logger = logging.getLogger(__name__)

ArtifactStatus = Literal["idle", "pending", "processing", "ready", "failed", "unavailable"]
ReplayStatus = Literal["idle", "processing", "ready", "failed", "partial"]


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class SessionReplayStatus(ApiModel):
    session_id: str
    replay_status: ReplayStatus = "idle"
    transcript_status: ArtifactStatus = "idle"
    transcript_turn_count: int = 0
    video_status: ArtifactStatus = "idle"
    video_segment_count: int = 0
    video_error: str | None = None
    key_moments_status: ArtifactStatus = "idle"
    key_moment_count: int = 0
    key_moments_error: str | None = None
    notes_status: ArtifactStatus = "idle"
    notes_error: str | None = None
    requested_at: str | None = None
    updated_at: str


class SessionReplayStatusBatchRequest(ApiModel):
    session_ids: list[str]


class SessionReplayStatusBatchResponse(ApiModel):
    statuses: list[SessionReplayStatus]


def default_replay_status(session_id: str) -> SessionReplayStatus:
    return SessionReplayStatus(
        session_id=session_id,
        updated_at=_now_iso(),
    )


def compute_replay_status(status: SessionReplayStatus) -> ReplayStatus:
    if "failed" in {
        status.video_status,
        status.key_moments_status,
        status.notes_status,
        status.transcript_status,
    }:
        return "failed"

    if "processing" in {
        status.video_status,
        status.key_moments_status,
        status.notes_status,
    }:
        return "processing"

    if "pending" in {
        status.video_status,
        status.key_moments_status,
        status.notes_status,
    }:
        return "processing"

    if (
        status.transcript_status == "ready"
        and status.video_status == "ready"
        and status.key_moments_status in {"ready", "unavailable"}
        and status.notes_status in {"ready", "unavailable"}
    ):
        return "ready"

    if status.transcript_status == "ready" and (
        status.video_status in {"ready", "unavailable"}
        or status.key_moments_status in {"ready", "unavailable"}
        or status.notes_status in {"ready", "unavailable"}
    ):
        return "partial"

    return "idle"


class ReplayStatusStore(Protocol):
    def get_status(self, session_id: str) -> SessionReplayStatus | None: ...

    def save_status(self, status: SessionReplayStatus) -> SessionReplayStatus: ...

    def merge_status(self, session_id: str, **updates: object) -> SessionReplayStatus: ...

    def delete_status(self, session_id: str) -> None: ...


class LocalFileReplayStatusStore:
    """Persist replay statuses to local JSON files."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def get_status(self, session_id: str) -> SessionReplayStatus | None:
        status_path = self._status_path(session_id)
        if not status_path.exists():
            return None
        data = json.loads(status_path.read_text())
        return SessionReplayStatus.model_validate(data)

    def save_status(self, status: SessionReplayStatus) -> SessionReplayStatus:
        status.updated_at = _now_iso()
        status.replay_status = compute_replay_status(status)
        status_path = self._status_path(status.session_id)
        status_path.parent.mkdir(parents=True, exist_ok=True)
        status_path.write_text(
            json.dumps(status.model_dump(mode="json", by_alias=False), indent=2)
        )
        return status

    def merge_status(self, session_id: str, **updates: object) -> SessionReplayStatus:
        status = self.get_status(session_id) or default_replay_status(session_id)
        for field_name, value in updates.items():
            if value is not None or hasattr(status, field_name):
                setattr(status, field_name, value)
        return self.save_status(status)

    def delete_status(self, session_id: str) -> None:
        status_path = self._status_path(session_id)
        if status_path.exists():
            status_path.unlink()

    def _status_path(self, session_id: str) -> Path:
        return self._root_dir / f"{session_id}.json"


class FirestoreReplayStatusStore:
    """Persist replay statuses to Firestore."""

    def __init__(
        self,
        *,
        project: str | None = None,
        prefix: str = "thinkspace",
        database: str | None = None,
    ) -> None:
        self._db = firestore.Client(project=project, database=database)
        self._collection = self._db.collection(f"{prefix}_session_replay_status")

    def get_status(self, session_id: str) -> SessionReplayStatus | None:
        snapshot = self._collection.document(session_id).get()
        if not snapshot.exists:
            return None
        return SessionReplayStatus.model_validate(snapshot.to_dict() or {})

    def save_status(self, status: SessionReplayStatus) -> SessionReplayStatus:
        status.updated_at = _now_iso()
        status.replay_status = compute_replay_status(status)
        self._collection.document(status.session_id).set(
            status.model_dump(mode="python", by_alias=False)
        )
        return status

    def merge_status(self, session_id: str, **updates: object) -> SessionReplayStatus:
        status = self.get_status(session_id) or default_replay_status(session_id)
        for field_name, value in updates.items():
            if value is not None or hasattr(status, field_name):
                setattr(status, field_name, value)
        return self.save_status(status)

    def delete_status(self, session_id: str) -> None:
        self._collection.document(session_id).delete()


def create_replay_status_store(local_root_dir: Path) -> ReplayStatusStore:
    """Create the replay status store from environment configuration."""

    backend = os.getenv("THINKSPACE_SESSION_STORE_BACKEND", "auto").lower()
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
    database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")

    if backend == "memory":
        logger.info("Using local-file replay status store")
        return LocalFileReplayStatusStore(local_root_dir)

    if backend in {"auto", "firestore"} and project:
        try:
            logger.info("Using Firestore replay status store")
            return FirestoreReplayStatusStore(
                project=project,
                prefix=prefix,
                database=database,
            )
        except Exception:
            logger.exception("Falling back to local-file replay status store")

    logger.info("Using local-file replay status store")
    return LocalFileReplayStatusStore(local_root_dir)
