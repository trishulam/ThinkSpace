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

from .canvas_placement_geometry import (
    build_compact_placement_payload,
    repair_rect_from_center,
)

logger = logging.getLogger(__name__)

DEFAULT_VIEWPORT_WIDTH = 1440
DEFAULT_VIEWPORT_HEIGHT = 900
DEFAULT_CANVAS_PADDING = 48
SUPPORTED_ASPECT_RATIOS = {"1:1", "4:3", "3:4", "16:9", "9:16"}
VISUAL_SIZE_PRESETS: dict[str, tuple[float, float]] = {
    "1:1": (560.0, 560.0),
    "4:3": (640.0, 480.0),
    "3:4": (480.0, 640.0),
    "16:9": (768.0, 432.0),
    "9:16": (432.0, 768.0),
}


class CanvasVisualPlacementCenter(BaseModel):
    """Structured output for center-point visual placement."""

    center_x: float
    center_y: float


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
        "w": max(w, 1.0),
        "h": max(h, 1.0),
    }


def _get_visual_preset_size(aspect_ratio_hint: str) -> tuple[float, float]:
    try:
        width, height = VISUAL_SIZE_PRESETS[aspect_ratio_hint]
    except KeyError as exc:
        raise ValueError(f"Unsupported visual aspect ratio preset: {aspect_ratio_hint}") from exc
    return round(width), round(height)


def _build_geometry_from_center(
    *,
    center: CanvasVisualPlacementCenter,
    compact_context: dict[str, object],
    desired_w: float,
    desired_h: float,
) -> tuple[dict[str, float], dict[str, float] | None, dict[str, object]]:
    return repair_rect_from_center(
        compact_payload=compact_context,
        center_x=float(center.center_x),
        center_y=float(center.center_y),
        desired_w=desired_w,
        desired_h=desired_h,
    )


def _build_fallback_placement(
    *,
    viewport_bounds: dict[str, float],
    aspect_ratio_hint: str,
    placement_hint: str,
) -> tuple[dict[str, float], dict[str, float] | None]:
    width, height = _get_visual_preset_size(aspect_ratio_hint)
    viewport_x = viewport_bounds["x"]
    viewport_y = viewport_bounds["y"]
    viewport_w = viewport_bounds["w"]
    viewport_h = viewport_bounds["h"]

    center_x = viewport_x + (viewport_w / 2.0)
    center_y = viewport_y + (viewport_h / 2.0)

    if placement_hint == "viewport_right":
        center_x = viewport_x + viewport_w - (width / 2.0) - DEFAULT_CANVAS_PADDING
    elif placement_hint == "viewport_left":
        center_x = viewport_x + (width / 2.0) + DEFAULT_CANVAS_PADDING
    elif placement_hint == "viewport_top":
        center_y = viewport_y + (height / 2.0) + DEFAULT_CANVAS_PADDING
    elif placement_hint == "viewport_bottom":
        center_y = viewport_y + viewport_h - (height / 2.0) - DEFAULT_CANVAS_PADDING

    return (
        {
            "x": round(center_x - (width / 2.0)),
            "y": round(center_y - (height / 2.0)),
            "w": round(width),
            "h": round(height),
        },
        None,
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
    compact_context: dict[str, object],
    aspect_ratio_hint: str,
    placement_hint: str,
    viewport_bounds: dict[str, float],
) -> str:
    suggested_w, suggested_h = _get_visual_preset_size(aspect_ratio_hint)
    return "\n".join(
        [
            "You plan where a generated teaching visual should be inserted on a ThinkSpace canvas.",
            "Return only the page-space center_x and center_y for the image center.",
            "Requirements:",
            "- Respect the provided viewport bounds and choose a center point that best matches the intended semantic placement.",
            "- Occupied rects are blocked areas with safety padding already applied.",
            "- Free rects are open candidate regions already computed from the viewport and blocked areas.",
            "- Use the screenshot to choose the semantically best open region when one is provided.",
            "- The visual size is already locked. You are not deciding width or height.",
            "- The backend will convert your center point into the final top-left x/y and run a deterministic repair pass to reduce overlap and maximize visible area.",
            "- If placement_hint is auto, choose the clearest open area in the current viewport.",
            "- If placement_hint is directional, honor it when reasonable without causing excessive overlap.",
            f"Requested aspect ratio: {aspect_ratio_hint}",
            f"Placement hint: {placement_hint}",
            f"Exact visual size: {suggested_w}x{suggested_h}",
            "Placement geometry JSON:",
            json.dumps(compact_context, ensure_ascii=True),
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
    desired_w, desired_h = _get_visual_preset_size(aspect_ratio_hint)
    compact_context, geometry_prep = build_compact_placement_payload(
        context=context,
        viewport_bounds=viewport_bounds,
        desired_w=desired_w,
        desired_h=desired_h,
    )
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
            compact_context=compact_context,
            aspect_ratio_hint=aspect_ratio_hint,
            placement_hint=placement_hint,
            viewport_bounds=viewport_bounds,
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
            response_schema=CanvasVisualPlacementCenter,
        ),
    )

    if response.parsed is None:
        raise ValueError("Canvas placement planner returned no structured payload")

    raw_response_payload = (
        response.parsed.model_dump()
        if isinstance(response.parsed, BaseModel)
        else response.parsed
    )
    plan = CanvasVisualPlacementCenter.model_validate(response.parsed)
    final_geometry, selected_free_rect, repair_trace = _build_geometry_from_center(
        center=plan,
        compact_context=compact_context,
        desired_w=desired_w,
        desired_h=desired_h,
    )
    if final_geometry["w"] <= 0 or final_geometry["h"] <= 0:
        raise ValueError("Canvas placement backend could not repair a positive geometry from center")
    completed_at = now_iso()
    return {
        "geometry": final_geometry,
        "trace": {
            "planner_model": get_canvas_visual_planner_model(),
            "placement_hint": placement_hint,
            "screenshot_included_in_request": screenshot_part is not None,
            "geometry_prep": geometry_prep,
            "started_at": started_at,
            "completed_at": completed_at,
            "duration_ms": max(0, int((time.perf_counter() - started_perf) * 1000)),
            "planner_prompt": contents[0],
            "raw_response_payload": raw_response_payload,
            "parsed_plan": plan.model_dump(),
            "desired_size": {"w": round(desired_w), "h": round(desired_h)},
            "selected_free_rect": selected_free_rect,
            "repair_trace": repair_trace,
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
        fallback_geometry, fallback_free_rect = _build_fallback_placement(
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
                "selected_free_rect": fallback_free_rect,
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
