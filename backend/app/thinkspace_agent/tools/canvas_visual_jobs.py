"""Async canvas visual generation runtime for ThinkSpace."""

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
from google.genai.types import GenerateContentResponse
from pydantic import BaseModel
from thinkspace_agent.tools.canvas_visual_trace import now_iso, summarize_context

from thinkspace_agent.config import (
    get_canvas_visual_image_model_for_mode,
    get_canvas_visual_planner_include_screenshot,
    get_canvas_visual_planner_model,
)

logger = logging.getLogger(__name__)

MIN_VISUAL_SIZE = 180
DEFAULT_VIEWPORT_WIDTH = 1440
DEFAULT_VIEWPORT_HEIGHT = 900
DEFAULT_CANVAS_PADDING = 48
SUPPORTED_ASPECT_RATIOS = {"1:1", "4:3", "3:4", "16:9", "9:16"}


class CanvasVisualPlacementPlan(BaseModel):
    """Structured output for final canvas placement geometry."""

    x: float
    y: float
    w: float
    h: float


@dataclass
class _SessionOutbox:
    subscribers: set[asyncio.Queue[dict[str, object]]] = field(default_factory=set)
    pending_results: list[dict[str, object]] = field(default_factory=list)


class CanvasVisualJobOutbox:
    """Per-session async tool-result outbox for canvas visual jobs."""

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


canvas_visual_job_outbox = CanvasVisualJobOutbox()


def _build_client() -> Client:
    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def _normalize_aspect_ratio_hint(aspect_ratio_hint: str) -> str:
    normalized = aspect_ratio_hint.strip()
    if normalized not in SUPPORTED_ASPECT_RATIOS:
        supported = ", ".join(sorted(SUPPORTED_ASPECT_RATIOS))
        raise ValueError(
            f"Unsupported aspect_ratio_hint '{aspect_ratio_hint}'. Expected one of: {supported}"
        )
    return normalized


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
        "w": max(w, float(MIN_VISUAL_SIZE)),
        "h": max(h, float(MIN_VISUAL_SIZE)),
    }


def _aspect_ratio_value(aspect_ratio_hint: str) -> float:
    width, height = aspect_ratio_hint.split(":", maxsplit=1)
    return float(width) / float(height)


def _derive_initial_size(aspect_ratio_hint: str, viewport_bounds: dict[str, float]) -> tuple[float, float]:
    aspect_ratio = _aspect_ratio_value(aspect_ratio_hint)
    viewport_w = viewport_bounds["w"]
    viewport_h = viewport_bounds["h"]
    usable_w = max(viewport_w - (DEFAULT_CANVAS_PADDING * 2), float(MIN_VISUAL_SIZE))
    usable_h = max(viewport_h - (DEFAULT_CANVAS_PADDING * 2), float(MIN_VISUAL_SIZE))

    max_w = usable_w * 0.46
    max_h = usable_h * 0.48
    width = min(max_w, max_h * aspect_ratio)
    height = width / aspect_ratio

    if height > max_h:
        height = max_h
        width = height * aspect_ratio

    width = max(width, float(MIN_VISUAL_SIZE))
    height = max(height, float(MIN_VISUAL_SIZE))
    return round(width), round(height)


def _clamp_geometry_to_viewport(
    *,
    plan: CanvasVisualPlacementPlan,
    viewport_bounds: dict[str, float],
    aspect_ratio_hint: str,
) -> dict[str, float]:
    viewport_x = viewport_bounds["x"]
    viewport_y = viewport_bounds["y"]
    viewport_w = viewport_bounds["w"]
    viewport_h = viewport_bounds["h"]
    aspect_ratio = _aspect_ratio_value(aspect_ratio_hint)

    width = float(plan.w)
    height = float(plan.h)

    max_width = max(viewport_w - (DEFAULT_CANVAS_PADDING * 2), float(MIN_VISUAL_SIZE))
    max_height = max(viewport_h - (DEFAULT_CANVAS_PADDING * 2), float(MIN_VISUAL_SIZE))

    width = min(width, max_width)
    height = min(height, max_height)

    # Preserve the aspect ratio even after clamping model output.
    height_from_width = width / aspect_ratio
    if height_from_width <= max_height:
        height = height_from_width
    else:
        height = max_height
        width = height * aspect_ratio

    width = max(width, float(MIN_VISUAL_SIZE))
    height = max(height, float(MIN_VISUAL_SIZE))

    min_x = viewport_x + DEFAULT_CANVAS_PADDING
    min_y = viewport_y + DEFAULT_CANVAS_PADDING
    max_x = viewport_x + viewport_w - DEFAULT_CANVAS_PADDING - width
    max_y = viewport_y + viewport_h - DEFAULT_CANVAS_PADDING - height

    if max_x < min_x:
        centered_x = viewport_x + (viewport_w - width) / 2
        x = centered_x
    else:
        x = min(max(float(plan.x), min_x), max_x)

    if max_y < min_y:
        centered_y = viewport_y + (viewport_h - height) / 2
        y = centered_y
    else:
        y = min(max(float(plan.y), min_y), max_y)

    return {
        "x": round(x),
        "y": round(y),
        "w": round(width),
        "h": round(height),
    }


def _build_fallback_placement(
    *,
    viewport_bounds: dict[str, float],
    aspect_ratio_hint: str,
    placement_hint: str,
) -> dict[str, float]:
    width, height = _derive_initial_size(aspect_ratio_hint, viewport_bounds)
    viewport_x = viewport_bounds["x"]
    viewport_y = viewport_bounds["y"]
    viewport_w = viewport_bounds["w"]
    viewport_h = viewport_bounds["h"]

    centered_x = viewport_x + (viewport_w - width) / 2
    centered_y = viewport_y + (viewport_h - height) / 2
    x = centered_x
    y = centered_y

    if placement_hint == "viewport_right":
        x = viewport_x + viewport_w - DEFAULT_CANVAS_PADDING - width
    elif placement_hint == "viewport_left":
        x = viewport_x + DEFAULT_CANVAS_PADDING
    elif placement_hint == "viewport_top":
        y = viewport_y + DEFAULT_CANVAS_PADDING
    elif placement_hint == "viewport_bottom":
        y = viewport_y + viewport_h - DEFAULT_CANVAS_PADDING - height

    return _clamp_geometry_to_viewport(
        plan=CanvasVisualPlacementPlan(x=x, y=y, w=width, h=height),
        viewport_bounds=viewport_bounds,
        aspect_ratio_hint=aspect_ratio_hint,
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


def _build_visual_generation_prompt(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
) -> str:
    normalized_prompt = prompt.strip()
    normalized_title_hint = title_hint.strip()
    normalized_style_hint = visual_style_hint.strip()

    lines = [
        "You are generating one static teaching visual for ThinkSpace.",
        "Follow the user-orchestrated brief exactly.",
        "Return a single clean image, not a collage, UI mockup, or multi-panel board.",
        "Prefer clear diagrammatic composition suited for learning.",
        "Make the visual pedagogically legible at a glance with clean hierarchy.",
        "Include important labels or named parts from the brief directly in the visual when appropriate.",
        "Avoid decorative scene elements that do not help teach the concept.",
        normalized_prompt,
    ]
    if normalized_title_hint:
        lines.append(f"Title hint: {normalized_title_hint}")
    if normalized_style_hint:
        lines.append(f"Visual style hint: {normalized_style_hint}")
    return "\n".join(lines)


def _derive_visual_title(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
) -> tuple[str, str | None]:
    normalized_title_hint = title_hint.strip()
    if normalized_title_hint:
        return normalized_title_hint, None

    first_sentence = prompt.strip().split(".", maxsplit=1)[0].strip()
    collapsed = " ".join(first_sentence.split())
    if not collapsed:
        return "Generated Visual", None

    title = collapsed[:72].rstrip(" ,:-")
    caption = None
    if visual_style_hint.strip():
        caption = visual_style_hint.strip()[:140]
    return title or "Generated Visual", caption


def _build_placement_planner_prompt(
    *,
    context: dict[str, object],
    aspect_ratio_hint: str,
    placement_hint: str,
    viewport_bounds: dict[str, float],
    screenshot_enabled: bool,
) -> str:
    serialized_context = {
        key: value for key, value in context.items() if key != "screenshot_data_url"
    }
    suggested_w, suggested_h = _derive_initial_size(
        aspect_ratio_hint,
        viewport_bounds,
    )
    return "\n".join(
        [
            "You plan where a generated teaching visual should be inserted on a ThinkSpace canvas.",
            "Return only the final page-space geometry for the image.",
            "Requirements:",
            "- Respect the provided viewport bounds and keep the image fully visible inside the viewport.",
            "- Prefer low-overlap open space relative to existing blurry shapes and selected content.",
            (
                "- Use selected shapes and screenshot semantics to avoid covering the active teaching focus."
                if screenshot_enabled
                else "- Use selected shapes and structured canvas context to avoid covering the active teaching focus."
            ),
            "- The output width and height must preserve the requested aspect ratio.",
            "- If placement_hint is auto, choose the clearest open area in the current viewport.",
            "- If placement_hint is directional, honor it when reasonable without causing excessive overlap.",
            f"Requested aspect ratio: {aspect_ratio_hint}",
            f"Placement hint: {placement_hint}",
            f"Suggested starting size: {suggested_w}x{suggested_h}",
            "Canvas context JSON:",
            json.dumps(serialized_context, ensure_ascii=True),
        ]
    )


def _plan_canvas_visual_placement(
    *,
    context: dict[str, object],
    aspect_ratio_hint: str,
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
        _build_placement_planner_prompt(
            context=context,
            aspect_ratio_hint=aspect_ratio_hint,
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
            response_schema=CanvasVisualPlacementPlan,
        ),
    )

    if response.parsed is None:
        raise ValueError("Canvas placement planner returned no structured payload")

    raw_response_payload = (
        response.parsed.model_dump()
        if isinstance(response.parsed, BaseModel)
        else response.parsed
    )
    plan = CanvasVisualPlacementPlan.model_validate(response.parsed)
    if plan.w <= 0 or plan.h <= 0:
        raise ValueError(
            f"Canvas placement planner returned non-positive geometry: w={plan.w}, h={plan.h}"
        )
    final_geometry = _clamp_geometry_to_viewport(
        plan=plan,
        viewport_bounds=viewport_bounds,
        aspect_ratio_hint=aspect_ratio_hint,
    )
    completed_at = now_iso()
    return {
        "geometry": final_geometry,
        "trace": {
            "planner_model": get_canvas_visual_planner_model(),
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


def _build_data_url(*, mime_type: str, image_bytes: bytes) -> str:
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _extract_inline_image(response: GenerateContentResponse) -> tuple[bytes, str]:
    candidates = response.candidates or []
    text_parts: list[str] = []

    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            inline_data = getattr(part, "inline_data", None)
            if inline_data and getattr(inline_data, "data", None):
                mime_type = getattr(inline_data, "mime_type", None) or "image/png"
                return inline_data.data, mime_type

            part_text = getattr(part, "text", None)
            if isinstance(part_text, str) and part_text.strip():
                text_parts.append(part_text.strip())

    suffix = f" Model text: {' '.join(text_parts[:2])}" if text_parts else ""
    raise ValueError(f"Canvas visual generator returned no inline image.{suffix}")


def _generate_canvas_visual_image(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
    aspect_ratio_hint: str,
    generation_mode: str,
) -> dict[str, object]:
    started_at = now_iso()
    started_perf = time.perf_counter()
    selected_image_model = get_canvas_visual_image_model_for_mode(generation_mode)
    generation_prompt = _build_visual_generation_prompt(
        prompt,
        title_hint=title_hint,
        visual_style_hint=visual_style_hint,
    )
    client = _build_client()
    response = client.models.generate_content(
        model=selected_image_model,
        contents=generation_prompt,
        config=genai_types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
            image_config=genai_types.ImageConfig(
                aspect_ratio=aspect_ratio_hint,
            ),
        ),
    )

    image_bytes, mime_type = _extract_inline_image(response)
    image_url = _build_data_url(
        mime_type=mime_type,
        image_bytes=image_bytes,
    )
    title, caption = _derive_visual_title(
        prompt,
        title_hint=title_hint,
        visual_style_hint=visual_style_hint,
    )
    completed_at = now_iso()
    return {
        "image_url": image_url,
        "title": title,
        "caption": caption,
        "mime_type": mime_type,
        "image_trace": {
            "generation_mode": generation_mode,
            "image_model": selected_image_model,
            "started_at": started_at,
            "completed_at": completed_at,
            "duration_ms": max(0, int((time.perf_counter() - started_perf) * 1000)),
            "generation_prompt": generation_prompt,
            "mime_type": mime_type,
        },
    }


async def generate_canvas_visual_artifact(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
    aspect_ratio_hint: str,
    generation_mode: str,
    placement_hint: str,
    placement_context: dict[str, object],
) -> dict[str, object]:
    """Generate a static canvas visual artifact without blocking the event loop."""
    artifact_started_at = now_iso()
    artifact_started_perf = time.perf_counter()
    normalized_aspect_ratio = _normalize_aspect_ratio_hint(aspect_ratio_hint)
    normalized_placement_hint = placement_hint.strip() or "auto"
    viewport_bounds = _extract_viewport_bounds(placement_context)

    image_task = asyncio.to_thread(
        _generate_canvas_visual_image,
        prompt,
        title_hint=title_hint,
        visual_style_hint=visual_style_hint,
        aspect_ratio_hint=normalized_aspect_ratio,
        generation_mode=generation_mode,
    )
    placement_task = asyncio.to_thread(
        _plan_canvas_visual_placement,
        context=placement_context,
        aspect_ratio_hint=normalized_aspect_ratio,
        placement_hint=normalized_placement_hint,
    )

    image_result, placement_result = await asyncio.gather(
        image_task,
        placement_task,
        return_exceptions=True,
    )

    if isinstance(image_result, Exception):
        raise image_result

    if isinstance(placement_result, Exception):
        logger.warning(
            "Canvas placement planner failed, using fallback placement: %s",
            placement_result,
        )
        fallback_geometry = _build_fallback_placement(
            viewport_bounds=viewport_bounds,
            aspect_ratio_hint=normalized_aspect_ratio,
            placement_hint=normalized_placement_hint,
        )
        placement_result = {
            "geometry": fallback_geometry,
            "trace": {
                "planner_model": get_canvas_visual_planner_model(),
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

    artifact_id = f"visual-{uuid4()}"
    geometry = placement_result["geometry"]
    planner_trace = placement_result["trace"]
    logger.info(
        "Canvas placement planner trace: %s",
        json.dumps(planner_trace, ensure_ascii=True),
    )
    artifact_completed_at = now_iso()
    return {
        "artifact_id": artifact_id,
        "image_url": image_result["image_url"],
        "title": image_result["title"],
        "caption": image_result["caption"],
        "x": geometry["x"],
        "y": geometry["y"],
        "w": geometry["w"],
        "h": geometry["h"],
        "planner_trace": planner_trace,
        "artifact_timing": {
            "started_at": artifact_started_at,
            "completed_at": artifact_completed_at,
            "duration_ms": max(
                0, int((time.perf_counter() - artifact_started_perf) * 1000)
            ),
        },
        "context_summary": summarize_context(placement_context),
        "image_trace": image_result["image_trace"],
        "mime_type": image_result["mime_type"],
    }


async def publish_canvas_visual_job_result(
    *,
    user_id: str,
    session_id: str,
    result: dict[str, object],
) -> None:
    """Publish a background canvas visual job result to the owning session."""

    logger.debug(
        "Publishing canvas visual job result: user_id=%s session_id=%s status=%s tool=%s",
        user_id,
        session_id,
        result.get("status"),
        result.get("tool"),
    )
    await canvas_visual_job_outbox.publish_result(user_id, session_id, result)
