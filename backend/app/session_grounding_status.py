"""Session grounding status persistence and helpers."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict
from google_cloud_clients import get_firestore_client

logger = logging.getLogger(__name__)

ArtifactStatus = Literal["idle", "pending", "processing", "ready", "failed", "unavailable"]
GroundingStatus = Literal["idle", "processing", "ready", "failed", "unavailable"]


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class SessionGroundingStatus(ApiModel):
    session_id: str
    grounding_status: GroundingStatus = "idle"
    study_plan_status: ArtifactStatus = "idle"
    source_summary_status: ArtifactStatus = "idle"
    knowledge_index_status: ArtifactStatus = "idle"
    grounding_error: str | None = None
    study_plan_error: str | None = None
    source_summary_error: str | None = None
    knowledge_index_error: str | None = None
    rag_corpus_id: str | None = None
    requested_at: str | None = None
    updated_at: str


def default_grounding_status(session_id: str) -> SessionGroundingStatus:
    return SessionGroundingStatus(
        session_id=session_id,
        updated_at=_now_iso(),
    )


def compute_grounding_status(status: SessionGroundingStatus) -> GroundingStatus:
    if "failed" in {
        status.study_plan_status,
        status.source_summary_status,
        status.knowledge_index_status,
    }:
        return "failed"

    if "processing" in {
        status.study_plan_status,
        status.source_summary_status,
        status.knowledge_index_status,
    }:
        return "processing"

    if "pending" in {
        status.study_plan_status,
        status.source_summary_status,
        status.knowledge_index_status,
    }:
        return "processing"

    if (
        status.study_plan_status == "ready"
        and status.source_summary_status in {"ready", "unavailable"}
        and status.knowledge_index_status in {"ready", "unavailable"}
    ):
        return "ready"

    if (
        status.study_plan_status == "unavailable"
        and status.source_summary_status == "unavailable"
        and status.knowledge_index_status == "unavailable"
    ):
        return "unavailable"

    return "idle"


class GroundingStatusStore(Protocol):
    def get_status(self, session_id: str) -> SessionGroundingStatus | None: ...

    def save_status(self, status: SessionGroundingStatus) -> SessionGroundingStatus: ...

    def merge_status(self, session_id: str, **updates: object) -> SessionGroundingStatus: ...

    def delete_status(self, session_id: str) -> None: ...


class LocalFileGroundingStatusStore:
    """Persist grounding statuses to local JSON files."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def get_status(self, session_id: str) -> SessionGroundingStatus | None:
        status_path = self._status_path(session_id)
        if not status_path.exists():
            return None
        data = json.loads(status_path.read_text())
        return SessionGroundingStatus.model_validate(data)

    def save_status(self, status: SessionGroundingStatus) -> SessionGroundingStatus:
        status.updated_at = _now_iso()
        status.grounding_status = compute_grounding_status(status)
        status_path = self._status_path(status.session_id)
        status_path.parent.mkdir(parents=True, exist_ok=True)
        status_path.write_text(
            json.dumps(status.model_dump(mode="json", by_alias=False), indent=2)
        )
        return status

    def merge_status(self, session_id: str, **updates: object) -> SessionGroundingStatus:
        status = self.get_status(session_id) or default_grounding_status(session_id)
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


class FirestoreGroundingStatusStore:
    """Persist grounding statuses to Firestore."""

    def __init__(
        self,
        *,
        project: str | None = None,
        prefix: str = "thinkspace",
        database: str | None = None,
    ) -> None:
        self._db = get_firestore_client(project=project, database=database)
        self._collection = self._db.collection(f"{prefix}_session_grounding_status")

    def get_status(self, session_id: str) -> SessionGroundingStatus | None:
        snapshot = self._collection.document(session_id).get()
        if not snapshot.exists:
            return None
        return SessionGroundingStatus.model_validate(snapshot.to_dict() or {})

    def save_status(self, status: SessionGroundingStatus) -> SessionGroundingStatus:
        status.updated_at = _now_iso()
        status.grounding_status = compute_grounding_status(status)
        self._collection.document(status.session_id).set(
            status.model_dump(mode="python", by_alias=False)
        )
        return status

    def merge_status(self, session_id: str, **updates: object) -> SessionGroundingStatus:
        status = self.get_status(session_id) or default_grounding_status(session_id)
        for field_name, value in updates.items():
            if value is not None or hasattr(status, field_name):
                setattr(status, field_name, value)
        return self.save_status(status)

    def delete_status(self, session_id: str) -> None:
        self._collection.document(session_id).delete()


def create_grounding_status_store(local_root_dir: Path) -> GroundingStatusStore:
    """Create the session grounding status store from environment configuration."""

    backend = os.getenv("THINKSPACE_SESSION_STORE_BACKEND", "auto").lower()
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
    database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")

    if backend == "memory":
        logger.info("Using local-file grounding status store")
        return LocalFileGroundingStatusStore(local_root_dir)

    if backend in {"auto", "firestore"} and project:
        try:
            logger.info("Using Firestore grounding status store")
            return FirestoreGroundingStatusStore(
                project=project,
                prefix=prefix,
                database=database,
            )
        except Exception:
            logger.exception("Falling back to local-file grounding status store")

    logger.info("Using local-file grounding status store")
    return LocalFileGroundingStatusStore(local_root_dir)
