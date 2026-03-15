"""Session study plan artifact persistence helpers."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict
from google_cloud_clients import get_firestore_client

logger = logging.getLogger(__name__)


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])
class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class StudyPlanTopic(ApiModel):
    id: str | None = None
    topic: str
    why_it_matters: str | None = None
    depends_on: list[str] = []
    success_signals: list[str] = []
    common_failure_modes: list[str] = []
    recommended_modalities: list[str] = []


class StudyPlanData(ApiModel):
    session_goal: str
    learner_intent: str
    target_outcomes: list[str] = []
    topic_sequence: list[StudyPlanTopic] = []
    likely_misconceptions: list[str] = []
    recommended_interventions: list[str] = []


class SessionStudyPlanArtifact(ApiModel):
    session_id: str
    status: Literal["completed"]
    study_plan: StudyPlanData
    generated_at: str
    model: str
    source_material_hash: str


class StudyPlanStore(Protocol):
    def get_artifact(self, session_id: str) -> SessionStudyPlanArtifact | None: ...

    def save_artifact(self, artifact: SessionStudyPlanArtifact) -> SessionStudyPlanArtifact: ...

    def delete_artifact(self, session_id: str) -> None: ...


class LocalFileStudyPlanStore:
    """Persist session study plans to local JSON files."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def get_artifact(self, session_id: str) -> SessionStudyPlanArtifact | None:
        artifact_path = self._artifact_path(session_id)
        if not artifact_path.exists():
            return None
        data = json.loads(artifact_path.read_text())
        return SessionStudyPlanArtifact.model_validate(data)

    def save_artifact(self, artifact: SessionStudyPlanArtifact) -> SessionStudyPlanArtifact:
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


class FirestoreStudyPlanStore:
    """Persist session study plans to Firestore."""

    def __init__(
        self,
        *,
        project: str | None = None,
        prefix: str = "thinkspace",
        database: str | None = None,
    ) -> None:
        self._db = get_firestore_client(project=project, database=database)
        self._collection = self._db.collection(f"{prefix}_session_study_plans")

    def get_artifact(self, session_id: str) -> SessionStudyPlanArtifact | None:
        snapshot = self._collection.document(session_id).get()
        if not snapshot.exists:
            return None
        return SessionStudyPlanArtifact.model_validate(snapshot.to_dict() or {})

    def save_artifact(self, artifact: SessionStudyPlanArtifact) -> SessionStudyPlanArtifact:
        self._collection.document(artifact.session_id).set(
            artifact.model_dump(mode="python", by_alias=False)
        )
        return artifact

    def delete_artifact(self, session_id: str) -> None:
        self._collection.document(session_id).delete()


def create_study_plan_store(local_root_dir: Path) -> StudyPlanStore:
    """Create the session study-plan artifact store from environment configuration."""

    backend = os.getenv("THINKSPACE_SESSION_STORE_BACKEND", "auto").lower()
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
    database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")

    if backend == "memory":
        logger.info("Using local-file study plan artifact store")
        return LocalFileStudyPlanStore(local_root_dir)

    if backend in {"auto", "firestore"} and project:
        try:
            logger.info("Using Firestore study plan artifact store")
            return FirestoreStudyPlanStore(
                project=project,
                prefix=prefix,
                database=database,
            )
        except Exception:
            logger.exception("Falling back to local-file study plan artifact store")

    logger.info("Using local-file study plan artifact store")
    return LocalFileStudyPlanStore(local_root_dir)
