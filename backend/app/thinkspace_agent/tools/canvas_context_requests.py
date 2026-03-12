"""Per-job request/response store for fresh canvas placement context."""

from __future__ import annotations

import asyncio


class CanvasContextRequestStore:
    """Tracks pending canvas-context requests for background tool jobs."""

    def __init__(self) -> None:
        self._futures: dict[tuple[str, str, str], asyncio.Future[dict[str, object]]] = {}

    def create_request(self, *, user_id: str, session_id: str, job_id: str) -> None:
        key = (user_id, session_id, job_id)
        loop = asyncio.get_running_loop()
        self._futures[key] = loop.create_future()

    async def wait_for_response(
        self,
        *,
        user_id: str,
        session_id: str,
        job_id: str,
        timeout_s: float,
    ) -> dict[str, object]:
        key = (user_id, session_id, job_id)
        future = self._futures.get(key)
        if future is None:
            raise ValueError("No pending canvas context request for this job")

        try:
            return await asyncio.wait_for(future, timeout=timeout_s)
        finally:
            self._futures.pop(key, None)

    def resolve_response(
        self,
        *,
        user_id: str,
        session_id: str,
        job_id: str,
        payload: dict[str, object],
    ) -> bool:
        key = (user_id, session_id, job_id)
        future = self._futures.get(key)
        if future is None or future.done():
            return False
        future.set_result(payload)
        return True

    def cancel_request(self, *, user_id: str, session_id: str, job_id: str) -> None:
        key = (user_id, session_id, job_id)
        future = self._futures.pop(key, None)
        if future is not None and not future.done():
            future.cancel()

    def clear_session(self, *, user_id: str, session_id: str) -> None:
        for key in tuple(self._futures):
            if key[0] == user_id and key[1] == session_id:
                future = self._futures.pop(key)
                if not future.done():
                    future.cancel()


canvas_context_request_store = CanvasContextRequestStore()
