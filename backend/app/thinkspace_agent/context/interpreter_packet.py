"""Interpreter input packet assembly helpers for Story I."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field

from session_store import SessionRecord
from thinkspace_agent.context.assembler import build_runtime_context
from thinkspace_agent.context.models import LectureContext, SessionContext, SurfaceState
from thinkspace_agent.context.session_compaction import CompactedSessionContext


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


class InterpreterCanvasPrimitive(ApiModel):
    shape_id: str
    shape_type: str
    x: float | None = None
    y: float | None = None
    w: float | None = None
    h: float | None = None
    text: str | None = None
    note: str | None = None
    asset_id: str | None = None
    artifact_id: str | None = None
    title: str | None = None
    source_tool: str | None = None
    delegate_job_id: str | None = None
    created_at: str | None = None


class InterpreterCanvasWindowEvent(ApiModel):
    event_type: str
    occurred_at: str
    actor: str
    source: str | None = None
    shape_id: str
    shape_type: str
    primitive: InterpreterCanvasPrimitive
    previous_primitive: InterpreterCanvasPrimitive | None = None
    shape_meta: dict[str, object] = Field(default_factory=dict)


class InterpreterCanvasWindowAggregateCounts(ApiModel):
    total_events: int
    create_count: int
    update_count: int
    delete_count: int
    user_changes: int
    agent_changes: int
    system_changes: int


class InterpreterCanvasWindow(ApiModel):
    id: str
    started_at: str
    last_change_at: str
    closed_at: str
    close_reason: str
    events: list[InterpreterCanvasWindowEvent] = Field(default_factory=list)
    changed_shape_ids: list[str] = Field(default_factory=list)
    actor_counts: dict[str, int] = Field(default_factory=dict)
    aggregate_counts: InterpreterCanvasWindowAggregateCounts


class InterpreterSessionMetadata(ApiModel):
    session_id: str
    user_id: str
    topic: str
    goal: str | None = None
    mode: str
    level: str
    learning_objective: str | None = None


class InterpreterTrigger(ApiModel):
    source: str = "canvas_activity_window"
    received_at: str


class InterpreterCanvasContext(ApiModel):
    captured_at: str | None = None
    viewport_bounds: dict[str, object] | None = None
    agent_viewport_bounds: dict[str, object] | None = None
    selected_shape_ids: list[str] = Field(default_factory=list)
    selected_shapes: list[dict[str, object]] = Field(default_factory=list)
    visible_shapes: list[dict[str, object]] = Field(default_factory=list)
    peripheral_shapes: list[dict[str, object]] = Field(default_factory=list)
    canvas_lints: list[dict[str, object] | str] = Field(default_factory=list)
    snapshot_summary: dict[str, object] = Field(default_factory=dict)


class InterpreterSurfaceState(ApiModel):
    canvas_summary: str | None = None
    flashcard_summary: str | None = None
    widget_summary: str | None = None


class InterpreterInputPacket(ApiModel):
    session: InterpreterSessionMetadata
    trigger: InterpreterTrigger
    canvas_window: InterpreterCanvasWindow
    canvas_context: InterpreterCanvasContext | None = None
    session_compaction: CompactedSessionContext
    surface_state: InterpreterSurfaceState
    runtime_context_text: str
    previous_interpreter_summary: str | None = None


def sanitize_canvas_context(
    context: dict[str, object] | None,
) -> InterpreterCanvasContext | None:
    if not isinstance(context, dict):
        return None

    visible_shapes = context.get("blurry_shapes")
    peripheral_shapes = context.get("peripheral_clusters")
    selected_shapes = context.get("selected_shape_details")
    selected_shape_ids = context.get("selected_shape_ids")
    canvas_lints = context.get("canvas_lints")

    snapshot_summary = {
        "selected_shape_count": (
            len(selected_shape_ids) if isinstance(selected_shape_ids, list) else 0
        ),
        "visible_shape_count": len(visible_shapes) if isinstance(visible_shapes, list) else 0,
        "peripheral_cluster_count": (
            len(peripheral_shapes) if isinstance(peripheral_shapes, list) else 0
        ),
        "lint_count": len(canvas_lints) if isinstance(canvas_lints, list) else 0,
    }

    return InterpreterCanvasContext(
        captured_at=context.get("captured_at")
        if isinstance(context.get("captured_at"), str)
        else None,
        viewport_bounds=context.get("user_viewport_bounds")
        if isinstance(context.get("user_viewport_bounds"), dict)
        else None,
        agent_viewport_bounds=context.get("agent_viewport_bounds")
        if isinstance(context.get("agent_viewport_bounds"), dict)
        else None,
        selected_shape_ids=[
            str(shape_id) for shape_id in selected_shape_ids
        ]
        if isinstance(selected_shape_ids, list)
        else [],
        selected_shapes=selected_shapes if isinstance(selected_shapes, list) else [],
        visible_shapes=visible_shapes if isinstance(visible_shapes, list) else [],
        peripheral_shapes=peripheral_shapes if isinstance(peripheral_shapes, list) else [],
        canvas_lints=canvas_lints if isinstance(canvas_lints, list) else [],
        snapshot_summary=snapshot_summary,
    )


def build_flashcard_surface_summary(
    snapshot: dict[str, object] | None,
) -> str | None:
    if not isinstance(snapshot, dict):
        return None

    topic = snapshot.get("topic")
    current_index = snapshot.get("current_index")
    total_cards = snapshot.get("total_cards")
    current_card = snapshot.get("current_card")
    next_card = snapshot.get("next_card")

    if not isinstance(topic, str):
        return None

    parts = [f"Flashcards active for {topic}."]
    if isinstance(current_index, int) and isinstance(total_cards, int):
        parts.append(f"Showing card {current_index + 1} of {total_cards}.")
    if isinstance(current_card, dict):
        front = current_card.get("front")
        if isinstance(front, str) and front.strip():
            parts.append(f"Current prompt: {front.strip()}")
        back = current_card.get("back")
        if isinstance(back, str) and back.strip():
            parts.append(f"Current answer: {back.strip()}")

    if isinstance(next_card, dict):
        next_front = next_card.get("front")
        if isinstance(next_front, str) and next_front.strip():
            parts.append(f"Following prompt: {next_front.strip()}")

    return " ".join(parts)


def build_canvas_surface_summary(
    canvas_window: InterpreterCanvasWindow,
    canvas_context: InterpreterCanvasContext | None,
) -> str:
    counts = canvas_window.aggregate_counts
    parts = [
        f"Latest canvas window had {counts.total_events} change events",
        f"({counts.create_count} create, {counts.update_count} update, {counts.delete_count} delete).",
    ]
    if canvas_context and canvas_context.snapshot_summary:
        visible_count = canvas_context.snapshot_summary.get("visible_shape_count")
        if isinstance(visible_count, int):
            parts.append(f"Current viewport has about {visible_count} visible shapes.")
    return " ".join(parts)


def build_interpreter_input_packet(
    *,
    session: SessionRecord,
    canvas_window: InterpreterCanvasWindow,
    canvas_context: dict[str, object] | None,
    compacted_session_context: CompactedSessionContext,
    flashcard_snapshot: dict[str, object] | None,
) -> InterpreterInputPacket:
    sanitized_canvas_context = sanitize_canvas_context(canvas_context)
    surface_state = InterpreterSurfaceState(
        canvas_summary=build_canvas_surface_summary(
            canvas_window,
            sanitized_canvas_context,
        ),
        flashcard_summary=build_flashcard_surface_summary(flashcard_snapshot),
        widget_summary=None,
    )

    runtime_context = SessionContext(
        lecture=LectureContext(
            topic=session.topic,
            learning_objective=None,
        ),
        surfaces=SurfaceState(
            canvas_summary=surface_state.canvas_summary,
            flashcard_summary=surface_state.flashcard_summary,
            widget_summary=surface_state.widget_summary,
        ),
        current_goal=session.goal,
        recent_digests=[compacted_session_context.summary_text]
        if compacted_session_context.summary_text
        else [],
    )

    return InterpreterInputPacket(
        session=InterpreterSessionMetadata(
            session_id=session.session_id,
            user_id=session.user_id,
            topic=session.topic,
            goal=session.goal,
            mode=session.mode,
            level=session.level,
            learning_objective=None,
        ),
        trigger=InterpreterTrigger(received_at=_now_iso()),
        canvas_window=canvas_window,
        canvas_context=sanitized_canvas_context,
        session_compaction=compacted_session_context,
        surface_state=surface_state,
        runtime_context_text=build_runtime_context(runtime_context),
        previous_interpreter_summary=None,
    )


@dataclass
class _StoredInterpreterPacket:
    packet: dict[str, object]


class InterpreterPacketStore:
    """Per-session storage for the latest assembled interpreter packet."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._packets: dict[tuple[str, str], _StoredInterpreterPacket] = {}

    async def set_packet(
        self,
        *,
        user_id: str,
        session_id: str,
        packet: dict[str, object],
    ) -> None:
        async with self._lock:
            self._packets[(user_id, session_id)] = _StoredInterpreterPacket(packet=packet)

    async def get_packet(
        self, *, user_id: str, session_id: str
    ) -> dict[str, object] | None:
        async with self._lock:
            stored = self._packets.get((user_id, session_id))
            if stored is None:
                return None
            return dict(stored.packet)

    async def clear_session(self, *, user_id: str, session_id: str) -> None:
        async with self._lock:
            self._packets.pop((user_id, session_id), None)


interpreter_packet_store = InterpreterPacketStore()
