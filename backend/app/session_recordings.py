"""Local session recording storage and merge helpers."""

from __future__ import annotations

import json
import mimetypes
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict


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
    """Persist recording segments locally and merge them on finalize."""

    def __init__(self, root_dir: Path) -> None:
        self._root_dir = root_dir
        self._root_dir.mkdir(parents=True, exist_ok=True)

    def get_manifest(self, session_id: str) -> SessionRecordingManifest:
        manifest_path = self._manifest_path(session_id)
        if not manifest_path.exists():
            return SessionRecordingManifest(
                session_id=session_id,
                status="idle",
                segments=[],
                updated_at=_now_iso(),
            )

        data = json.loads(manifest_path.read_text())
        return SessionRecordingManifest.model_validate(data)

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
        session_dir = self._session_dir(session_id)
        segments_dir = session_dir / "segments"
        segments_dir.mkdir(parents=True, exist_ok=True)

        manifest = self.get_manifest(session_id)
        sequence = len(manifest.segments) + 1
        extension = self._guess_extension(original_filename=original_filename, mime_type=mime_type)
        segment_id = uuid4().hex
        file_name = f"{sequence:04d}-{segment_id}{extension}"
        file_path = segments_dir / file_name
        file_path.write_bytes(file_bytes)

        guessed_mime_type = mime_type or mimetypes.guess_type(file_name)[0] or "video/webm"
        segment = RecordingSegmentRecord(
            segment_id=segment_id,
            session_id=session_id,
            sequence=sequence,
            status="ready",
            file_name=file_name,
            relative_path=self._relative_path(file_path),
            mime_type=guessed_mime_type,
            started_at=started_at,
            ended_at=ended_at,
            created_at=_now_iso(),
            size_bytes=file_path.stat().st_size,
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

        final_dir = self._session_dir(session_id) / "final"
        final_dir.mkdir(parents=True, exist_ok=True)
        manifest.status = "processing"
        manifest.error = None
        manifest.updated_at = _now_iso()
        self._write_manifest(session_id, manifest)

        concat_file = self._session_dir(session_id) / "concat.txt"
        concat_lines = []
        for segment in sorted(manifest.segments, key=lambda item: item.sequence):
            segment_path = self._root_dir / segment.relative_path
            concat_lines.append(f"file '{segment_path.as_posix()}'")
        concat_file.write_text("\n".join(concat_lines) + "\n")

        try:
            final_file_name = "final.webm"
            final_path = final_dir / final_file_name
            copy_result = subprocess.run(
                [
                    "ffmpeg",
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
                final_path = final_dir / final_file_name
                transcode_result = subprocess.run(
                    [
                        "ffmpeg",
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
                    raise RuntimeError(transcode_result.stderr.strip() or "ffmpeg merge failed")

            manifest.status = "ready"
            manifest.final_file_name = final_file_name
            manifest.final_relative_path = self._relative_path(final_path)
            manifest.final_mime_type = (
                mimetypes.guess_type(final_file_name)[0]
                or "video/webm"
                if final_file_name.endswith(".webm")
                else "video/mp4"
            )
            manifest.final_size_bytes = final_path.stat().st_size
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
        finally:
            concat_file.unlink(missing_ok=True)

    def get_final_video_path(self, session_id: str) -> Path | None:
        manifest = self.get_manifest(session_id)
        if not manifest.final_relative_path:
            return None
        final_path = self._root_dir / manifest.final_relative_path
        if not final_path.exists():
            return None
        return final_path

    def _manifest_path(self, session_id: str) -> Path:
        return self._session_dir(session_id) / "manifest.json"

    def _session_dir(self, session_id: str) -> Path:
        return self._root_dir / session_id

    def _write_manifest(
        self, session_id: str, manifest: SessionRecordingManifest
    ) -> None:
        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        self._manifest_path(session_id).write_text(
            json.dumps(manifest.model_dump(mode="json", by_alias=False), indent=2)
        )

    def _relative_path(self, path: Path) -> str:
        return str(path.relative_to(self._root_dir))

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
