"""Session recording storage and merge helpers."""

from __future__ import annotations

import json
import logging
import mimetypes
import os
import shutil
import subprocess
import tempfile
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


class RecordingSegmentRecord(ApiModel):
    segment_id: str
    session_id: str
    sequence: int
    status: Literal["ready"]
    file_name: str
    relative_path: str
    mime_type: str
    started_at: str | None = None
    ended_at: str | None = None
    created_at: str
    size_bytes: int


class SessionRecordingManifest(ApiModel):
    session_id: str
    status: Literal["idle", "recording", "ready", "processing", "failed"]
    segments: list[RecordingSegmentRecord]
    final_file_name: str | None = None
    final_relative_path: str | None = None
    final_mime_type: str | None = None
    final_size_bytes: int | None = None
    merged_at: str | None = None
    error: str | None = None
    updated_at: str


class SessionRecordingStore:
    """Persist recording segments and merge them into one replay artifact."""

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
            self._db.collection(f"{prefix}_session_recordings") if self._db else None
        )
        self._bucket = get_storage_client(project=project).bucket(bucket_name) if bucket_name else None

    def get_manifest(self, session_id: str) -> SessionRecordingManifest:
        if self._manifest_collection:
            snapshot = self._manifest_collection.document(session_id).get()
            if snapshot.exists:
                return SessionRecordingManifest.model_validate(snapshot.to_dict() or {})

        manifest_path = self._manifest_path(session_id)
        if manifest_path.exists():
            data = json.loads(manifest_path.read_text())
            return SessionRecordingManifest.model_validate(data)

        return SessionRecordingManifest(
            session_id=session_id,
            status="idle",
            segments=[],
            updated_at=_now_iso(),
        )

    def save_segment(
        self,
        *,
        session_id: str,
        file_bytes: bytes,
        original_filename: str | None,
        mime_type: str | None,
        started_at: str | None,
        ended_at: str | None,
    ) -> SessionRecordingManifest:
        manifest = self.get_manifest(session_id)
        sequence = len(manifest.segments) + 1
        extension = self._guess_extension(original_filename=original_filename, mime_type=mime_type)
        segment_id = uuid4().hex
        file_name = f"{sequence:04d}-{segment_id}{extension}"
        relative_path = self._segment_object_path(session_id, file_name)

        if self._bucket:
            self._bucket.blob(relative_path).upload_from_string(
                file_bytes,
                content_type=mime_type or mimetypes.guess_type(file_name)[0] or "video/webm",
            )
            size_bytes = len(file_bytes)
        else:
            file_path = self._root_dir / relative_path
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(file_bytes)
            size_bytes = file_path.stat().st_size

        guessed_mime_type = mime_type or mimetypes.guess_type(file_name)[0] or "video/webm"
        segment = RecordingSegmentRecord(
            segment_id=segment_id,
            session_id=session_id,
            sequence=sequence,
            status="ready",
            file_name=file_name,
            relative_path=relative_path,
            mime_type=guessed_mime_type,
            started_at=started_at,
            ended_at=ended_at,
            created_at=_now_iso(),
            size_bytes=size_bytes,
        )
        manifest.segments.append(segment)
        manifest.status = "ready"
        manifest.error = None
        manifest.updated_at = _now_iso()
        self._write_manifest(session_id, manifest)
        return manifest

    def finalize_session(self, session_id: str) -> SessionRecordingManifest:
        manifest = self.get_manifest(session_id)
        if not manifest.segments:
            raise ValueError("No recording segments found for this session")

        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path is None:
            raise RuntimeError(
                "ffmpeg is required to finalize session recordings but was not found on PATH"
            )

        manifest.status = "processing"
        manifest.error = None
        manifest.updated_at = _now_iso()
        self._write_manifest(session_id, manifest)

        try:
            with tempfile.TemporaryDirectory(prefix=f"thinkspace-recordings-{session_id}-") as temp_dir:
                temp_dir_path = Path(temp_dir)
                concat_file = temp_dir_path / "concat.txt"
                concat_lines: list[str] = []

                for segment in sorted(manifest.segments, key=lambda item: item.sequence):
                    local_segment_path = temp_dir_path / "segments" / segment.file_name
                    local_segment_path.parent.mkdir(parents=True, exist_ok=True)
                    self._materialize_object(segment.relative_path, local_segment_path)
                    concat_lines.append(f"file '{self._escape_concat_path(local_segment_path.resolve())}'")

                concat_file.write_text("\n".join(concat_lines) + "\n")

                final_file_name = "final.webm"
                final_path = temp_dir_path / final_file_name
                copy_result = subprocess.run(
                    [
                        ffmpeg_path,
                        "-y",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(concat_file),
                        "-c",
                        "copy",
                        str(final_path),
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )

                if copy_result.returncode != 0:
                    final_file_name = "final.mp4"
                    final_path = temp_dir_path / final_file_name
                    transcode_result = subprocess.run(
                        [
                            ffmpeg_path,
                            "-y",
                            "-f",
                            "concat",
                            "-safe",
                            "0",
                            "-i",
                            str(concat_file),
                            "-c:v",
                            "libx264",
                            "-preset",
                            "veryfast",
                            "-pix_fmt",
                            "yuv420p",
                            "-c:a",
                            "aac",
                            str(final_path),
                        ],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if transcode_result.returncode != 0:
                        raise RuntimeError(
                            transcode_result.stderr.strip() or "ffmpeg merge failed"
                        )

                final_relative_path = self._final_object_path(session_id, final_file_name)
                if self._bucket:
                    self._bucket.blob(final_relative_path).upload_from_filename(
                        str(final_path),
                        content_type=self._guess_final_mime_type(final_file_name),
                    )
                    final_size_bytes = final_path.stat().st_size
                else:
                    destination = self._root_dir / final_relative_path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(final_path, destination)
                    final_size_bytes = destination.stat().st_size

            manifest.status = "ready"
            manifest.final_file_name = final_file_name
            manifest.final_relative_path = final_relative_path
            manifest.final_mime_type = self._guess_final_mime_type(final_file_name)
            manifest.final_size_bytes = final_size_bytes
            manifest.merged_at = _now_iso()
            manifest.error = None
            manifest.updated_at = _now_iso()
            self._write_manifest(session_id, manifest)
            return manifest
        except Exception as exc:
            manifest.status = "failed"
            manifest.error = str(exc)
            manifest.updated_at = _now_iso()
            self._write_manifest(session_id, manifest)
            raise

    def get_final_video_path(self, session_id: str) -> Path | None:
        manifest = self.get_manifest(session_id)
        if not manifest.final_relative_path or self._bucket:
            return None
        final_path = self._root_dir / manifest.final_relative_path
        if not final_path.exists():
            return None
        return final_path

    def get_final_video_size(self, session_id: str) -> int | None:
        manifest = self.get_manifest(session_id)
        if not manifest.final_relative_path:
            return None

        if self._bucket:
            blob = self._bucket.blob(manifest.final_relative_path)
            if not blob.exists():
                return None
            blob.reload()
            return blob.size

        final_path = self._root_dir / manifest.final_relative_path
        if not final_path.exists():
            return None
        return final_path.stat().st_size

    def get_final_video_bytes(
        self,
        session_id: str,
        *,
        start: int | None = None,
        end: int | None = None,
    ) -> bytes | None:
        manifest = self.get_manifest(session_id)
        if not manifest.final_relative_path:
            return None

        if self._bucket:
            blob = self._bucket.blob(manifest.final_relative_path)
            if not blob.exists():
                return None
            return blob.download_as_bytes(start=start, end=end)

        final_path = self._root_dir / manifest.final_relative_path
        if not final_path.exists():
            return None
        if start is None and end is None:
            return final_path.read_bytes()

        with final_path.open("rb") as file_handle:
            file_handle.seek(start or 0)
            if end is None:
                return file_handle.read()
            return file_handle.read(end - (start or 0) + 1)

    def delete_session(self, session_id: str) -> None:
        if self._manifest_collection:
            self._manifest_collection.document(session_id).delete()
        if self._bucket:
            prefix = f"sessions/{session_id}/recordings/"
            for blob in self._bucket.list_blobs(prefix=prefix):
                blob.delete()
        session_dir = self._session_dir(session_id)
        if session_dir.exists():
            shutil.rmtree(session_dir)

    def _manifest_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "manifest.json"

    def _session_dir(self, session_id: str) -> Path:
        return self._root_dir / session_id

    def _write_manifest(self, session_id: str, manifest: SessionRecordingManifest) -> None:
        manifest_data = manifest.model_dump(mode="python", by_alias=False)
        if self._manifest_collection:
            self._manifest_collection.document(session_id).set(manifest_data)
            return

        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        self._manifest_path(session_id).write_text(
            json.dumps(manifest.model_dump(mode="json", by_alias=False), indent=2)
        )

    def _segment_object_path(self, session_id: str, file_name: str) -> str:
        return f"sessions/{session_id}/recordings/segments/{file_name}"

    def _final_object_path(self, session_id: str, file_name: str) -> str:
        return f"sessions/{session_id}/recordings/final/{file_name}"

    def _materialize_object(self, relative_path: str, destination: Path) -> None:
        if self._bucket:
            blob = self._bucket.blob(relative_path)
            if not blob.exists():
                raise FileNotFoundError(f"Recording segment not found: {relative_path}")
            blob.download_to_filename(str(destination))
            return

        source = self._root_dir / relative_path
        if not source.exists():
            raise FileNotFoundError(f"Recording segment not found: {relative_path}")
        shutil.copyfile(source, destination)

    def _escape_concat_path(self, path: Path) -> str:
        return path.as_posix().replace("'", r"'\''")

    def _guess_extension(
        self, *, original_filename: str | None, mime_type: str | None
    ) -> str:
        if original_filename:
            suffix = Path(original_filename).suffix.strip()
            if suffix:
                return suffix
        if mime_type:
            guessed = mimetypes.guess_extension(mime_type)
            if guessed:
                return guessed
        return ".webm"

    def _guess_final_mime_type(self, file_name: str) -> str:
        return mimetypes.guess_type(file_name)[0] or (
            "video/webm" if file_name.endswith(".webm") else "video/mp4"
        )
