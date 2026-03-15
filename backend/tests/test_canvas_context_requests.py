from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# pylint: disable=import-error,wrong-import-position
sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

from thinkspace_agent.tools.canvas_context_requests import CanvasContextRequestStore  # noqa: E402


async def _resolve_after_tick(
    store: CanvasContextRequestStore,
    *,
    user_id: str,
    session_id: str,
    job_id: str,
) -> None:
    await asyncio.sleep(0)
    store.append_trace_event(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
        event={"event": "frontend_trace", "trace": {"event": "context_build_started"}},
    )
    store.resolve_response(
        user_id=user_id,
        session_id=session_id,
        job_id=job_id,
        payload={"captured_at": "2026-03-15T00:00:00+00:00"},
    )


def test_canvas_context_request_trace_snapshot_records_resolution() -> None:
    async def run() -> None:
        store = CanvasContextRequestStore()
        store.create_request(user_id="user-1", session_id="session-1", job_id="job-1")
        resolver = asyncio.create_task(
            _resolve_after_tick(
                store,
                user_id="user-1",
                session_id="session-1",
                job_id="job-1",
            )
        )

        payload = await store.wait_for_response(
            user_id="user-1",
            session_id="session-1",
            job_id="job-1",
            timeout_s=1.0,
        )
        await resolver

        snapshot = store.pop_trace_snapshot(
            user_id="user-1",
            session_id="session-1",
            job_id="job-1",
        )

        assert payload["captured_at"] == "2026-03-15T00:00:00+00:00"
        assert snapshot is not None
        assert snapshot["future_done"] is True
        events = snapshot["trace_events"]
        assert [event["event"] for event in events] == [
            "request_created",
            "wait_started",
            "frontend_trace",
            "response_resolved",
        ]

    asyncio.run(run())


def test_canvas_context_request_trace_snapshot_records_timeout() -> None:
    async def run() -> None:
        store = CanvasContextRequestStore()
        store.create_request(user_id="user-1", session_id="session-1", job_id="job-2")

        try:
            await store.wait_for_response(
                user_id="user-1",
                session_id="session-1",
                job_id="job-2",
                timeout_s=0.001,
            )
        except asyncio.TimeoutError:
            pass
        else:  # pragma: no cover
            raise AssertionError("Expected wait_for_response to time out")

        snapshot = store.pop_trace_snapshot(
            user_id="user-1",
            session_id="session-1",
            job_id="job-2",
        )

        assert snapshot is not None
        events = snapshot["trace_events"]
        assert [event["event"] for event in events] == [
            "request_created",
            "wait_started",
            "wait_timed_out",
        ]

    asyncio.run(run())
