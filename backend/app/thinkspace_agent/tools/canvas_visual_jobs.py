"""Async canvas visual generation runtime for ThinkSpace."""

from __future__ import annotations

import asyncio
import base64
import logging
import os
from dataclasses import dataclass, field
from typing import Literal
from uuid import uuid4

from google.genai import Client
from google.genai import types as genai_types
from google.genai.types import GenerateContentResponse
from pydantic import BaseModel, Field

from thinkspace_agent.config import (
    get_canvas_visual_image_model,
    get_canvas_visual_planner_model,
)

logger = logging.getLogger(__name__)

CANVAS_VISUAL_WIDTH = 960
CANVAS_VISUAL_HEIGHT = 720
CANVAS_VISUAL_PLACEMENT_INTENT = "viewport_center"


class CanvasVisualPlan(BaseModel):
    """Structured planner output for a generated teaching visual."""

    title: str = Field(min_length=1)
    caption: str | None = None
    visual_prompt: str = Field(min_length=1)
    placement_intent: Literal["viewport_center"] = "viewport_center"


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


def _build_visual_planner_prompt(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
) -> str:
    normalized_prompt = prompt.strip()
    normalized_title_hint = title_hint.strip()
    normalized_style_hint = visual_style_hint.strip()

    lines = [
        "You plan a static teaching visual for ThinkSpace.",
        "Return a concise visual plan for a single explanatory image.",
        "Requirements:",
        "- Output one static visual, not a widget or multi-step board edit.",
        "- The visual should help a learner understand the topic clearly.",
        "- The title should be short and learner-facing.",
        "- The caption should be concise and optional.",
        "- The visual prompt should be detailed enough for an image generator.",
        "- Keep placement_intent as viewport_center.",
        f"Prompt: {normalized_prompt}",
    ]
    if normalized_title_hint:
        lines.append(f"Title hint: {normalized_title_hint}")
    if normalized_style_hint:
        lines.append(f"Visual style hint: {normalized_style_hint}")
    return "\n".join(lines)


def _normalize_visual_plan(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
    generated_plan: CanvasVisualPlan,
) -> dict[str, str]:
    title = generated_plan.title.strip() if generated_plan.title.strip() else ""
    if not title:
        title = title_hint.strip() or "Generated Visual"

    caption = generated_plan.caption.strip() if generated_plan.caption else ""
    visual_prompt = (
        generated_plan.visual_prompt.strip()
        if generated_plan.visual_prompt.strip()
        else prompt.strip()
    )

    if visual_style_hint.strip() and visual_style_hint.strip().lower() not in visual_prompt.lower():
        visual_prompt = f"{visual_prompt}\nStyle: {visual_style_hint.strip()}"

    return {
        "title": title,
        "caption": caption,
        "visual_prompt": visual_prompt,
        "placement_intent": CANVAS_VISUAL_PLACEMENT_INTENT,
    }


def _plan_canvas_visual(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
) -> dict[str, str]:
    client = _build_client()
    response = client.models.generate_content(
        model=get_canvas_visual_planner_model(),
        contents=_build_visual_planner_prompt(
            prompt,
            title_hint=title_hint,
            visual_style_hint=visual_style_hint,
        ),
        config=genai_types.GenerateContentConfig(
            temperature=0.4,
            response_mime_type="application/json",
            response_schema=CanvasVisualPlan,
        ),
    )

    if response.parsed is None:
        raise ValueError("Canvas visual planner returned no structured payload")

    generated_plan = CanvasVisualPlan.model_validate(response.parsed)
    return _normalize_visual_plan(
        prompt,
        title_hint=title_hint,
        visual_style_hint=visual_style_hint,
        generated_plan=generated_plan,
    )


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


def _generate_canvas_visual_artifact(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
) -> dict[str, object]:
    plan = _plan_canvas_visual(
        prompt,
        title_hint=title_hint,
        visual_style_hint=visual_style_hint,
    )

    client = _build_client()
    response = client.models.generate_content(
        model=get_canvas_visual_image_model(),
        contents=plan["visual_prompt"],
        config=genai_types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
            image_config=genai_types.ImageConfig(
                aspect_ratio="4:3",
            ),
        ),
    )

    image_bytes, mime_type = _extract_inline_image(response)
    image_url = _build_data_url(
        mime_type=mime_type,
        image_bytes=image_bytes,
    )

    artifact_id = f"visual-{uuid4()}"
    return {
        "artifact_id": artifact_id,
        "image_url": image_url,
        "title": plan["title"],
        "caption": plan["caption"] or None,
        "width": CANVAS_VISUAL_WIDTH,
        "height": CANVAS_VISUAL_HEIGHT,
        "placement_intent": plan["placement_intent"],
        "mime_type": mime_type,
    }


async def generate_canvas_visual_artifact(
    prompt: str,
    *,
    title_hint: str,
    visual_style_hint: str,
) -> dict[str, object]:
    """Generate a static canvas visual artifact without blocking the event loop."""

    return await asyncio.to_thread(
        _generate_canvas_visual_artifact,
        prompt,
        title_hint=title_hint,
        visual_style_hint=visual_style_hint,
    )


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
