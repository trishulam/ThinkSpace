"""Async result delivery and job metadata for canvas.delegate_task."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class CanvasDelegateJobRecord:
    """Stored metadata for a delegated canvas job."""

    goal: str
    target_scope: str
    constraints: str
    teaching_intent: str


@dataclass
class _SessionOutbox:
    subscribers: set[asyncio.Queue[dict[str, object]]] = field(default_factory=set)
    pending_results: list[dict[str, object]] = field(default_factory=list)


class CanvasDelegateJobOutbox:
    """Per-session outbox for delegated canvas job results."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._sessions: dict[tuple[str, str], _SessionOutbox] = {}

    async def subscribe(
        self, user_id: str, session_id: str
    ) -> asyncio.Queue[dict[str, object]]:
        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        key = (user_id, session_id)
        async with self._lock:
            outbox = self._sessions.setdefault(key, _SessionOutbox())
            outbox.subscribers.add(queue)
            pending_results = list(outbox.pending_results)
            outbox.pending_results.clear()

        for result in pending_results:
            queue.put_nowait(result)
        return queue

    async def unsubscribe(
        self, user_id: str, session_id: str, queue: asyncio.Queue[dict[str, object]]
    ) -> None:
        key = (user_id, session_id)
        async with self._lock:
            outbox = self._sessions.get(key)
            if outbox is None:
                return
            outbox.subscribers.discard(queue)
            if not outbox.subscribers and not outbox.pending_results:
                self._sessions.pop(key, None)

    async def publish_result(
        self, user_id: str, session_id: str, result: dict[str, object]
    ) -> None:
        key = (user_id, session_id)
        async with self._lock:
            outbox = self._sessions.setdefault(key, _SessionOutbox())
            subscribers = list(outbox.subscribers)
            if not subscribers:
                outbox.pending_results.append(result)
                return

        for queue in subscribers:
            queue.put_nowait(result)


class CanvasDelegateJobStore:
    """Stores pending delegated canvas jobs until the frontend reports completion."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._jobs: dict[tuple[str, str, str], CanvasDelegateJobRecord] = {}

    async def create_job(
        self,
        *,
        user_id: str,
        session_id: str,
        job_id: str,
        goal: str,
        target_scope: str,
        constraints: str,
        teaching_intent: str,
    ) -> None:
        async with self._lock:
            self._jobs[(user_id, session_id, job_id)] = CanvasDelegateJobRecord(
                goal=goal,
                target_scope=target_scope,
                constraints=constraints,
                teaching_intent=teaching_intent,
            )

    async def pop_job(
        self, *, user_id: str, session_id: str, job_id: str
    ) -> CanvasDelegateJobRecord | None:
        async with self._lock:
            return self._jobs.pop((user_id, session_id, job_id), None)

    async def clear_session(self, *, user_id: str, session_id: str) -> None:
        async with self._lock:
            for key in tuple(self._jobs):
                if key[0] == user_id and key[1] == session_id:
                    self._jobs.pop(key, None)


canvas_delegate_job_outbox = CanvasDelegateJobOutbox()
canvas_delegate_job_store = CanvasDelegateJobStore()


async def publish_canvas_delegate_job_result(
    *,
    user_id: str,
    session_id: str,
    result: dict[str, object],
) -> None:
    """Publish a delegated canvas job result to the session."""

    logger.debug(
        "Publishing canvas delegate result: user_id=%s session_id=%s status=%s tool=%s",
        user_id,
        session_id,
        result.get("status"),
        result.get("tool"),
    )
    await canvas_delegate_job_outbox.publish_result(user_id, session_id, result)
