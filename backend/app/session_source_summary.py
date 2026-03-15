"""Session source summary artifact persistence helpers."""

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


class SourceSummaryCoreConcept(ApiModel):
    name: str
    summary: str


class SourceSummaryDefinition(ApiModel):
    term: str
    definition: str


class SourceBoundaries(ApiModel):
    well_supported: list[str] = []
    lightly_supported: list[str] = []
    not_well_supported: list[str] = []


class SourceSummaryData(ApiModel):
    overview: str
    core_concepts: list[SourceSummaryCoreConcept] = []
    key_terms: list[str] = []
    definitions: list[SourceSummaryDefinition] = []
    important_examples: list[str] = []
    source_boundaries: SourceBoundaries


class SessionSourceSummaryArtifact(ApiModel):
    session_id: str
    status: Literal["completed"]
    source_summary: SourceSummaryData
    generated_at: str
    model: str
    source_material_hash: str


class SourceSummaryStore(Protocol):
    def get_artifact(self, session_id: str) -> SessionSourceSummaryArtifact | None: ...

    def save_artifact(
        self, artifact: SessionSourceSummaryArtifact
    ) -> SessionSourceSummaryArtifact: ...

    def delete_artifact(self, session_id: str) -> None: ...


class LocalFileSourceSummaryStore:
    """Persist session source summaries to local JSON files."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def get_artifact(self, session_id: str) -> SessionSourceSummaryArtifact | None:
        artifact_path = self._artifact_path(session_id)
        if not artifact_path.exists():
            return None
        data = json.loads(artifact_path.read_text())
        return SessionSourceSummaryArtifact.model_validate(data)

    def save_artifact(
        self, artifact: SessionSourceSummaryArtifact
    ) -> SessionSourceSummaryArtifact:
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


class FirestoreSourceSummaryStore:
    """Persist session source summaries to Firestore."""

    def __init__(
        self,
        *,
        project: str | None = None,
        prefix: str = "thinkspace",
        database: str | None = None,
    ) -> None:
        self._db = get_firestore_client(project=project, database=database)
        self._collection = self._db.collection(f"{prefix}_session_source_summaries")

    def get_artifact(self, session_id: str) -> SessionSourceSummaryArtifact | None:
        snapshot = self._collection.document(session_id).get()
        if not snapshot.exists:
            return None
        return SessionSourceSummaryArtifact.model_validate(snapshot.to_dict() or {})

    def save_artifact(
        self, artifact: SessionSourceSummaryArtifact
    ) -> SessionSourceSummaryArtifact:
        self._collection.document(artifact.session_id).set(
            artifact.model_dump(mode="python", by_alias=False)
        )
        return artifact

    def delete_artifact(self, session_id: str) -> None:
        self._collection.document(session_id).delete()


def create_source_summary_store(local_root_dir: Path) -> SourceSummaryStore:
    """Create the session source-summary artifact store from environment configuration."""

    backend = os.getenv("THINKSPACE_SESSION_STORE_BACKEND", "auto").lower()
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
    database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")

    if backend == "memory":
        logger.info("Using local-file source summary artifact store")
        return LocalFileSourceSummaryStore(local_root_dir)

    if backend in {"auto", "firestore"} and project:
        try:
            logger.info("Using Firestore source summary artifact store")
            return FirestoreSourceSummaryStore(
                project=project,
                prefix=prefix,
                database=database,
            )
        except Exception:
            logger.exception("Falling back to local-file source summary artifact store")

    logger.info("Using local-file source summary artifact store")
    return LocalFileSourceSummaryStore(local_root_dir)
