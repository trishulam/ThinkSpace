"""Per-session storage for frontend-derived canvas placement context."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass
class _CanvasSessionContext:
    payload: dict[str, object]


class CanvasPlacementContextStore:
    """Caches the latest placement context for each websocket session."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._contexts: dict[tuple[str, str], _CanvasSessionContext] = {}

    async def set_context(
        self, *, user_id: str, session_id: str, payload: dict[str, object]
    ) -> None:
        async with self._lock:
            self._contexts[(user_id, session_id)] = _CanvasSessionContext(payload=payload)

    async def get_context(
        self, *, user_id: str, session_id: str
    ) -> dict[str, object] | None:
        async with self._lock:
            context = self._contexts.get((user_id, session_id))
            if context is None:
                return None
            return dict(context.payload)

    async def clear_context(self, *, user_id: str, session_id: str) -> None:
        async with self._lock:
            self._contexts.pop((user_id, session_id), None)


canvas_placement_context_store = CanvasPlacementContextStore()
