"""Async widget generation runtime for ThinkSpace."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
from dataclasses import dataclass, field
from uuid import uuid4

from google.genai import Client
from google.genai import types as genai_types
from pydantic import BaseModel

from thinkspace_agent.config import (
    get_canvas_visual_planner_include_screenshot,
    get_canvas_visual_planner_model,
)
from thinkspace_agent.widgets.models import (
    WidgetArtifactPayload,
    WidgetKind,
    WidgetReasonerRequest,
)
from thinkspace_agent.widgets.reasoner import reason_widget

from .canvas_widget_trace import now_iso, summarize_context

logger = logging.getLogger(__name__)

DEFAULT_VIEWPORT_WIDTH = 1440
DEFAULT_VIEWPORT_HEIGHT = 900
DEFAULT_CANVAS_PADDING = 48
MIN_GRAPH_WIDTH = 320
MIN_GRAPH_HEIGHT = 240
MIN_NOTATION_WIDTH = 280
MIN_NOTATION_HEIGHT = 220


class CanvasWidgetPlacementPlan(BaseModel):
    """Structured output for final canvas placement geometry."""

    x: float
    y: float
    w: float
    h: float


@dataclass
class _SessionOutbox:
    subscribers: set[asyncio.Queue[dict[str, object]]] = field(default_factory=set)
    pending_results: list[dict[str, object]] = field(default_factory=list)


class CanvasWidgetJobOutbox:
    """Per-session async tool-result outbox for widget jobs."""

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


canvas_widget_job_outbox = CanvasWidgetJobOutbox()


def _build_client() -> Client:
    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def _extract_viewport_bounds(context: dict[str, object] | None) -> dict[str, float]:
    fallback = {
        "x": 0.0,
        "y": 0.0,
        "w": float(DEFAULT_VIEWPORT_WIDTH),
        "h": float(DEFAULT_VIEWPORT_HEIGHT),
    }
    if not isinstance(context, dict):
        return fallback

    candidate = context.get("user_viewport_bounds")
    if not isinstance(candidate, dict):
        return fallback

    try:
        x = float(candidate.get("x", 0.0))
        y = float(candidate.get("y", 0.0))
        w = float(candidate.get("w", DEFAULT_VIEWPORT_WIDTH))
        h = float(candidate.get("h", DEFAULT_VIEWPORT_HEIGHT))
    except (TypeError, ValueError):
        return fallback

    return {
        "x": x,
        "y": y,
        "w": max(w, float(MIN_GRAPH_WIDTH)),
        "h": max(h, float(MIN_GRAPH_HEIGHT)),
    }


def _get_min_widget_size(widget_kind: WidgetKind) -> tuple[float, float]:
    if widget_kind == "graph":
        return float(MIN_GRAPH_WIDTH), float(MIN_GRAPH_HEIGHT)
    return float(MIN_NOTATION_WIDTH), float(MIN_NOTATION_HEIGHT)


def _derive_suggested_widget_size(
    widget_kind: WidgetKind, viewport_bounds: dict[str, float]
) -> tuple[float, float]:
    viewport_w = viewport_bounds["w"]
    viewport_h = viewport_bounds["h"]
    usable_w = max(viewport_w - (DEFAULT_CANVAS_PADDING * 2), float(MIN_GRAPH_WIDTH))
    usable_h = max(viewport_h - (DEFAULT_CANVAS_PADDING * 2), float(MIN_GRAPH_HEIGHT))

    if widget_kind == "graph":
        width = min(usable_w * 0.5, 680.0)
        height = min(width * 0.66, usable_h * 0.56)
        width = max(width, float(MIN_GRAPH_WIDTH))
        height = max(height, float(MIN_GRAPH_HEIGHT))
        return round(width), round(height)

    width = min(usable_w * 0.44, 620.0)
    height = min(max(usable_h * 0.38, float(MIN_NOTATION_HEIGHT)), usable_h * 0.7)
    width = max(width, float(MIN_NOTATION_WIDTH))
    height = max(height, float(MIN_NOTATION_HEIGHT))
    return round(width), round(height)


def _clamp_widget_geometry_to_viewport(
    *,
    plan: CanvasWidgetPlacementPlan,
    viewport_bounds: dict[str, float],
    widget_kind: WidgetKind,
) -> dict[str, float]:
    viewport_x = viewport_bounds["x"]
    viewport_y = viewport_bounds["y"]
    viewport_w = viewport_bounds["w"]
    viewport_h = viewport_bounds["h"]
    min_width, min_height = _get_min_widget_size(widget_kind)

    max_width = max(viewport_w - (DEFAULT_CANVAS_PADDING * 2), min_width)
    max_height = max(viewport_h - (DEFAULT_CANVAS_PADDING * 2), min_height)

    width = min(max(float(plan.w), min_width), max_width)
    height = min(max(float(plan.h), min_height), max_height)

    min_x = viewport_x + DEFAULT_CANVAS_PADDING
    min_y = viewport_y + DEFAULT_CANVAS_PADDING
    max_x = viewport_x + viewport_w - DEFAULT_CANVAS_PADDING - width
    max_y = viewport_y + viewport_h - DEFAULT_CANVAS_PADDING - height

    x = (
        viewport_x + (viewport_w - width) / 2
        if max_x < min_x
        else min(max(float(plan.x), min_x), max_x)
    )
    y = (
        viewport_y + (viewport_h - height) / 2
        if max_y < min_y
        else min(max(float(plan.y), min_y), max_y)
    )

    return {
        "x": round(x),
        "y": round(y),
        "w": round(width),
        "h": round(height),
    }


def _build_fallback_placement(
    *,
    viewport_bounds: dict[str, float],
    widget_kind: WidgetKind,
    placement_hint: str,
) -> dict[str, float]:
    width, height = _derive_suggested_widget_size(widget_kind, viewport_bounds)
    viewport_x = viewport_bounds["x"]
    viewport_y = viewport_bounds["y"]
    viewport_w = viewport_bounds["w"]
    viewport_h = viewport_bounds["h"]

    x = viewport_x + (viewport_w - width) / 2
    y = viewport_y + (viewport_h - height) / 2

    if placement_hint == "viewport_right":
        x = viewport_x + viewport_w - DEFAULT_CANVAS_PADDING - width
    elif placement_hint == "viewport_left":
        x = viewport_x + DEFAULT_CANVAS_PADDING
    elif placement_hint == "viewport_top":
        y = viewport_y + DEFAULT_CANVAS_PADDING
    elif placement_hint == "viewport_bottom":
        y = viewport_y + viewport_h - DEFAULT_CANVAS_PADDING - height

    return _clamp_widget_geometry_to_viewport(
        plan=CanvasWidgetPlacementPlan(x=x, y=y, w=width, h=height),
        viewport_bounds=viewport_bounds,
        widget_kind=widget_kind,
    )


def _parse_data_url(data_url: str) -> tuple[str, bytes] | None:
    if not data_url or not data_url.startswith("data:"):
        return None

    header, _, encoded = data_url.partition(",")
    if not header or not encoded:
        return None

    mime_type = header[5:].split(";", maxsplit=1)[0] or "image/jpeg"
    try:
        return mime_type, base64.b64decode(encoded)
    except (ValueError, TypeError):
        return None


def _build_widget_placement_planner_prompt(
    *,
    context: dict[str, object],
    widget_kind: WidgetKind,
    placement_hint: str,
    viewport_bounds: dict[str, float],
    screenshot_enabled: bool,
) -> str:
    serialized_context = {
        key: value for key, value in context.items() if key != "screenshot_data_url"
    }
    suggested_w, suggested_h = _derive_suggested_widget_size(
        widget_kind,
        viewport_bounds,
    )
    widget_description = (
        "a readable 2D function plot card"
        if widget_kind == "graph"
        else "a readable rendered notation card that may contain multiple derivation steps"
    )
    return "\n".join(
        [
            "You plan where a generated teaching widget should be inserted on a ThinkSpace canvas.",
            "Return only the final page-space geometry for the widget.",
            f"The widget is {widget_description}.",
            "Requirements:",
            "- Respect the provided viewport bounds and keep the widget fully visible inside the viewport.",
            "- Prefer low-overlap open space relative to existing blurry shapes and selected content.",
            (
                "- Use selected shapes and screenshot semantics to avoid covering the active teaching focus."
                if screenshot_enabled
                else "- Use selected shapes and structured canvas context to avoid covering the active teaching focus."
            ),
            "- Keep the size readable for a learner at a glance.",
            "- If placement_hint is auto, choose the clearest open area in the current viewport.",
            "- If placement_hint is directional, honor it when reasonable without causing excessive overlap.",
            f"Widget kind: {widget_kind}",
            f"Placement hint: {placement_hint}",
            f"Suggested starting size: {suggested_w}x{suggested_h}",
            "Canvas context JSON:",
            json.dumps(serialized_context, ensure_ascii=True),
        ]
    )


def _plan_canvas_widget_placement(
    *,
    context: dict[str, object],
    widget_kind: WidgetKind,
    placement_hint: str,
) -> dict[str, object]:
    started_at = now_iso()
    started_perf = time.perf_counter()
    viewport_bounds = _extract_viewport_bounds(context)
    screenshot_enabled = get_canvas_visual_planner_include_screenshot()
    screenshot_part = None
    screenshot_data_url = context.get("screenshot_data_url")
    if screenshot_enabled and isinstance(screenshot_data_url, str):
        parsed = _parse_data_url(screenshot_data_url)
        if parsed is not None:
            mime_type, image_bytes = parsed
            screenshot_part = genai_types.Part(
                inlineData=genai_types.Blob(
                    data=image_bytes,
                    mimeType=mime_type,
                )
            )

    client = _build_client()
    contents: list[object] = [
        _build_widget_placement_planner_prompt(
            context=context,
            widget_kind=widget_kind,
            placement_hint=placement_hint,
            viewport_bounds=viewport_bounds,
            screenshot_enabled=screenshot_enabled,
        )
    ]
    if screenshot_part is not None:
        contents.append(screenshot_part)

    response = client.models.generate_content(
        model=get_canvas_visual_planner_model(),
        contents=contents,
        config=genai_types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=CanvasWidgetPlacementPlan,
        ),
    )

    if response.parsed is None:
        raise ValueError("Canvas widget placement planner returned no structured payload")

    raw_response_payload = (
        response.parsed.model_dump()
        if isinstance(response.parsed, BaseModel)
        else response.parsed
    )
    plan = CanvasWidgetPlacementPlan.model_validate(response.parsed)
    final_geometry = _clamp_widget_geometry_to_viewport(
        plan=plan,
        viewport_bounds=viewport_bounds,
        widget_kind=widget_kind,
    )
    completed_at = now_iso()
    return {
        "geometry": final_geometry,
        "trace": {
            "planner_model": get_canvas_visual_planner_model(),
            "widget_kind": widget_kind,
            "placement_hint": placement_hint,
            "screenshot_included_in_request": screenshot_part is not None,
            "started_at": started_at,
            "completed_at": completed_at,
            "duration_ms": max(0, int((time.perf_counter() - started_perf) * 1000)),
            "planner_prompt": contents[0],
            "raw_response_payload": raw_response_payload,
            "parsed_plan": plan.model_dump(),
            "final_geometry": final_geometry,
            "used_fallback": False,
        },
    }


def _reason_canvas_widget(widget_kind: WidgetKind, prompt: str) -> dict[str, object]:
    started_at = now_iso()
    started_perf = time.perf_counter()
    response = reason_widget(
        WidgetReasonerRequest(widget_type=widget_kind, prompt=prompt)
    )
    completed_at = now_iso()
    return {
        "title": response.title,
        "spec": response.spec,
        "trace": {
            "widget_kind": widget_kind,
            "model": response.debug.model,
            "started_at": started_at,
            "completed_at": completed_at,
            "duration_ms": max(0, int((time.perf_counter() - started_perf) * 1000)),
            "prompt_text": response.debug.prompt_text,
            "raw_response_text": response.debug.raw_response_text,
            "raw_parsed_payload": response.debug.raw_parsed_payload,
            "spec": response.spec.model_dump(mode="python"),
        },
    }


async def generate_canvas_widget_artifact(
    *,
    widget_kind: WidgetKind,
    prompt: str,
    placement_hint: str,
    placement_context: dict[str, object],
) -> dict[str, object]:
    """Generate a canvas widget artifact without blocking the event loop."""

    artifact_started_at = now_iso()
    artifact_started_perf = time.perf_counter()
    normalized_placement_hint = placement_hint.strip() or "auto"
    viewport_bounds = _extract_viewport_bounds(placement_context)

    reasoner_task = asyncio.to_thread(
        _reason_canvas_widget,
        widget_kind,
        prompt,
    )
    placement_task = asyncio.to_thread(
        _plan_canvas_widget_placement,
        context=placement_context,
        widget_kind=widget_kind,
        placement_hint=normalized_placement_hint,
    )

    reasoner_result, placement_result = await asyncio.gather(
        reasoner_task,
        placement_task,
        return_exceptions=True,
    )

    if isinstance(reasoner_result, Exception):
        raise reasoner_result

    if isinstance(placement_result, Exception):
        logger.warning(
            "Canvas widget placement planner failed, using fallback placement: %s",
            placement_result,
        )
        fallback_geometry = _build_fallback_placement(
            viewport_bounds=viewport_bounds,
            widget_kind=widget_kind,
            placement_hint=normalized_placement_hint,
        )
        placement_result = {
            "geometry": fallback_geometry,
            "trace": {
                "planner_model": get_canvas_visual_planner_model(),
                "widget_kind": widget_kind,
                "placement_hint": normalized_placement_hint,
                "screenshot_included_in_request": False,
                "started_at": None,
                "completed_at": None,
                "duration_ms": None,
                "planner_prompt": None,
                "raw_response_payload": None,
                "parsed_plan": None,
                "final_geometry": fallback_geometry,
                "used_fallback": True,
                "fallback_reason": str(placement_result),
            },
        }

    geometry = placement_result["geometry"]
    spec = reasoner_result["spec"]
    artifact = WidgetArtifactPayload(
        artifact_id=f"widget-{uuid4()}",
        widget_kind=widget_kind,
        title=reasoner_result["title"],
        spec=spec,
        x=geometry["x"],
        y=geometry["y"],
        w=geometry["w"],
        h=geometry["h"],
    )
    artifact_completed_at = now_iso()
    artifact_payload = artifact.model_dump(mode="python")
    artifact_payload["planner_trace"] = placement_result["trace"]
    artifact_payload["reasoner_trace"] = reasoner_result["trace"]
    artifact_payload["artifact_timing"] = {
        "started_at": artifact_started_at,
        "completed_at": artifact_completed_at,
        "duration_ms": max(0, int((time.perf_counter() - artifact_started_perf) * 1000)),
    }
    artifact_payload["context_summary"] = summarize_context(placement_context)
    return artifact_payload


async def publish_canvas_widget_job_result(
    *,
    user_id: str,
    session_id: str,
    result: dict[str, object],
) -> None:
    """Publish a background canvas widget job result to the owning session."""

    logger.debug(
        "Publishing canvas widget job result: user_id=%s session_id=%s status=%s tool=%s",
        user_id,
        session_id,
        result.get("status"),
        result.get("tool"),
    )
    await canvas_widget_job_outbox.publish_result(user_id, session_id, result)
