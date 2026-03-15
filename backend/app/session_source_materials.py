"""Session source-material storage helpers."""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from google_cloud_clients import get_firestore_client, get_storage_client

logger = logging.getLogger(__name__)


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class SourceMaterialRecord(ApiModel):
    source_id: str
    session_id: str
    file_name: str
    relative_path: str
    mime_type: str
    size_bytes: int
    uploaded_at: str
    status: Literal["ready", "failed"] = "ready"
    error: str | None = None


class SessionSourceMaterialManifest(ApiModel):
    session_id: str
    status: Literal["idle", "ready", "failed"]
    materials: list[SourceMaterialRecord]
    error: str | None = None
    updated_at: str


class SessionSourceMaterialStore:
    """Persist uploaded source materials for session grounding."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)
        backend = os.getenv("THINKSPACE_SESSION_STORE_BACKEND", "auto").lower()
        project = os.getenv("GOOGLE_CLOUD_PROJECT")
        prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
        database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")
        bucket_name = os.getenv("THINKSPACE_GCS_BUCKET")
        self._use_firestore = backend in {"auto", "firestore"} and bool(project)
        self._db = (
            get_firestore_client(project=project, database=database)
            if self._use_firestore
            else None
        )
        self._manifest_collection = (
            self._db.collection(f"{prefix}_session_source_materials") if self._db else None
        )
        self._bucket = (
            get_storage_client(project=project).bucket(bucket_name) if bucket_name else None
        )
        self._bucket_name = bucket_name

    def get_manifest(self, session_id: str) -> SessionSourceMaterialManifest:
        if self._manifest_collection:
            snapshot = self._manifest_collection.document(session_id).get()
            if snapshot.exists:
                return SessionSourceMaterialManifest.model_validate(snapshot.to_dict() or {})

        manifest_path = self._manifest_path(session_id)
        if manifest_path.exists():
            return SessionSourceMaterialManifest.model_validate(
                json.loads(manifest_path.read_text())
            )

        return SessionSourceMaterialManifest(
            session_id=session_id,
            status="idle",
            materials=[],
            updated_at=_now_iso(),
        )

    def save_material(
        self,
        *,
        session_id: str,
        file_bytes: bytes,
        original_filename: str | None,
        mime_type: str | None,
    ) -> SessionSourceMaterialManifest:
        manifest = self.get_manifest(session_id)
        source_id = uuid4().hex
        file_name = self._normalize_file_name(original_filename, source_id)
        relative_path = self._object_path(session_id, source_id, file_name)
        guessed_mime_type = mime_type or mimetypes.guess_type(file_name)[0] or "application/octet-stream"

        if self._bucket:
            self._bucket.blob(relative_path).upload_from_string(
                file_bytes,
                content_type=guessed_mime_type,
            )
            size_bytes = len(file_bytes)
        else:
            file_path = self._root_dir / relative_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(file_bytes)
            size_bytes = file_path.stat().st_size

        material = SourceMaterialRecord(
            source_id=source_id,
            session_id=session_id,
            file_name=file_name,
            relative_path=relative_path,
            mime_type=guessed_mime_type,
            size_bytes=size_bytes,
            uploaded_at=_now_iso(),
            status="ready",
            error=None,
        )
        manifest.materials.append(material)
        manifest.status = "ready"
        manifest.error = None
        manifest.updated_at = _now_iso()
        self._write_manifest(session_id, manifest)
        return manifest

    def list_materials(self, session_id: str) -> list[SourceMaterialRecord]:
        return self.get_manifest(session_id).materials

    def get_material_bytes(self, material: SourceMaterialRecord) -> bytes:
        if self._bucket:
            blob = self._bucket.blob(material.relative_path)
            if not blob.exists():
                raise FileNotFoundError(
                    f"Source material not found: {material.relative_path}"
                )
            return blob.download_as_bytes()

        local_path = self._root_dir / material.relative_path
        if not local_path.exists():
            raise FileNotFoundError(f"Source material not found: {material.relative_path}")
        return local_path.read_bytes()

    def is_gcs_backed(self) -> bool:
        return self._bucket is not None and bool(self._bucket_name)

    def get_material_gcs_uri(self, material: SourceMaterialRecord) -> str | None:
        if not self.is_gcs_backed():
            return None
        return f"gs://{self._bucket_name}/{material.relative_path}"

    def get_material_local_path(self, material: SourceMaterialRecord) -> Path | None:
        if self.is_gcs_backed():
            return None
        return self._root_dir / material.relative_path

    def delete_session(self, session_id: str) -> None:
        if self._manifest_collection:
            self._manifest_collection.document(session_id).delete()
        if self._bucket:
            prefix = f"sessions/{session_id}/source-materials/"
            for blob in self._bucket.list_blobs(prefix=prefix):
                blob.delete()
        session_dir = self._session_dir(session_id)
        if session_dir.exists():
            shutil.rmtree(session_dir)

    def _write_manifest(
        self, session_id: str, manifest: SessionSourceMaterialManifest
    ) -> None:
        manifest_data = manifest.model_dump(mode="python", by_alias=False)
        if self._manifest_collection:
            self._manifest_collection.document(session_id).set(manifest_data)
            return

        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        self._manifest_path(session_id).write_text(
            json.dumps(manifest.model_dump(mode="json", by_alias=False), indent=2)
        )

    def _manifest_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "manifest.json"

    def _session_dir(self, session_id: str) -> Path:
        return self._root_dir / session_id

    def _object_path(self, session_id: str, source_id: str, file_name: str) -> str:
        return f"sessions/{session_id}/source-materials/files/{source_id}-{file_name}"

    def _normalize_file_name(self, original_filename: str | None, source_id: str) -> str:
        if original_filename:
            safe_name = Path(original_filename).name.strip()
            if safe_name:
                return safe_name
        return f"{source_id}.bin"
