"""Per-job request/response store for fresh canvas placement context."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from .canvas_visual_trace import now_iso


@dataclass
class _CanvasContextRequestRecord:
    future: asyncio.Future[dict[str, object]]
    created_at: str
    trace_events: list[dict[str, object]] = field(default_factory=list)


class CanvasContextRequestStore:
    """Tracks pending canvas-context requests for background tool jobs."""

    def __init__(self) -> None:
        self._records: dict[tuple[str, str, str], _CanvasContextRequestRecord] = {}

    def create_request(self, *, user_id: str, session_id: str, job_id: str) -> None:
        key = (user_id, session_id, job_id)
        loop = asyncio.get_running_loop()
        record = _CanvasContextRequestRecord(
            future=loop.create_future(),
            created_at=now_iso(),
        )
        record.trace_events.append(
            {
                "event": "request_created",
                "timestamp": record.created_at,
            }
        )
        self._records[key] = record

    async def wait_for_response(
        self,
        *,
        user_id: str,
        session_id: str,
        job_id: str,
        timeout_s: float,
    ) -> dict[str, object]:
        key = (user_id, session_id, job_id)
        record = self._records.get(key)
        if record is None:
            raise ValueError("No pending canvas context request for this job")
        future = record.future
        record.trace_events.append(
            {
                "event": "wait_started",
                "timestamp": now_iso(),
                "timeout_s": timeout_s,
            }
        )

        try:
            return await asyncio.wait_for(future, timeout=timeout_s)
        except asyncio.TimeoutError:
            record.trace_events.append(
                {
                    "event": "wait_timed_out",
                    "timestamp": now_iso(),
                    "timeout_s": timeout_s,
                }
            )
            raise

    def resolve_response(
        self,
        *,
        user_id: str,
        session_id: str,
        job_id: str,
        payload: dict[str, object],
    ) -> bool:
        key = (user_id, session_id, job_id)
        record = self._records.get(key)
        if record is None or record.future.done():
            return False
        record.trace_events.append(
            {
                "event": "response_resolved",
                "timestamp": now_iso(),
            }
        )
        record.future.set_result(payload)
        return True

    def append_trace_event(
        self,
        *,
        user_id: str,
        session_id: str,
        job_id: str,
        event: dict[str, object],
    ) -> None:
        key = (user_id, session_id, job_id)
        record = self._records.get(key)
        if record is None:
            return
        normalized_event = dict(event)
        normalized_event.setdefault("timestamp", now_iso())
        record.trace_events.append(normalized_event)

    def get_trace_snapshot(
        self, *, user_id: str, session_id: str, job_id: str
    ) -> dict[str, object] | None:
        key = (user_id, session_id, job_id)
        record = self._records.get(key)
        if record is None:
            return None
        return {
            "created_at": record.created_at,
            "future_done": record.future.done(),
            "trace_events": list(record.trace_events),
        }

    def pop_trace_snapshot(
        self, *, user_id: str, session_id: str, job_id: str
    ) -> dict[str, object] | None:
        key = (user_id, session_id, job_id)
        record = self._records.pop(key, None)
        if record is None:
            return None
        return {
            "created_at": record.created_at,
            "future_done": record.future.done(),
            "trace_events": list(record.trace_events),
        }

    def cancel_request(self, *, user_id: str, session_id: str, job_id: str) -> None:
        key = (user_id, session_id, job_id)
        record = self._records.pop(key, None)
        if record is not None and not record.future.done():
            record.future.cancel()

    def clear_session(self, *, user_id: str, session_id: str) -> None:
        for key in tuple(self._records):
            if key[0] == user_id and key[1] == session_id:
                record = self._records.pop(key)
                if not record.future.done():
                    record.future.cancel()


canvas_context_request_store = CanvasContextRequestStore()
