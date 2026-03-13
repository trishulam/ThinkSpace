"""Pending interpreter snapshot jobs for non-blocking fresh context requests."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from session_store import SessionRecord

from .interpreter_packet import InterpreterCanvasWindow
from .session_compaction import CompactedSessionContext


@dataclass
class PendingInterpreterSnapshotJob:
    job_id: str
    session: SessionRecord
    canvas_window: InterpreterCanvasWindow
    compacted_session_context: CompactedSessionContext
    flashcard_snapshot: dict[str, object] | None


class InterpreterSnapshotJobStore:
    """Stores the latest pending interpreter snapshot request per session."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._jobs: dict[tuple[str, str], PendingInterpreterSnapshotJob] = {}

    async def set_job(
        self,
        *,
        user_id: str,
        session_id: str,
        job: PendingInterpreterSnapshotJob,
    ) -> None:
        async with self._lock:
            self._jobs[(user_id, session_id)] = job

    async def pop_job_if_current(
        self,
        *,
        user_id: str,
        session_id: str,
        job_id: str,
    ) -> PendingInterpreterSnapshotJob | None:
        async with self._lock:
            key = (user_id, session_id)
            job = self._jobs.get(key)
            if job is None or job.job_id != job_id:
                return None
            return self._jobs.pop(key)

    async def clear_session(self, *, user_id: str, session_id: str) -> None:
        async with self._lock:
            self._jobs.pop((user_id, session_id), None)


interpreter_snapshot_job_store = InterpreterSnapshotJobStore()
