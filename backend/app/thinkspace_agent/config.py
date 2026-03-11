"""Configuration helpers for the ThinkSpace agent."""

from __future__ import annotations

import os

DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
DEFAULT_FLASHCARD_MODEL = "gemini-2.5-flash"
DEFAULT_CANVAS_VISUAL_PLANNER_MODEL = "gemini-2.5-flash"
DEFAULT_CANVAS_VISUAL_IMAGE_MODEL = "gemini-2.5-flash-image"


def get_agent_model() -> str:
    """Return the configured live model for the ThinkSpace orchestrator.

    `THINKSPACE_AGENT_MODEL` becomes the product-specific override, while
    `DEMO_AGENT_MODEL` remains a backward-compatible fallback during the
    transition away from the demo scaffolding.
    """

    return os.getenv(
        "THINKSPACE_AGENT_MODEL",
        os.getenv("DEMO_AGENT_MODEL", DEFAULT_LIVE_MODEL),
    )


def get_flashcard_generation_model() -> str:
    """Return the model used by the flashcard generation worker."""

    return os.getenv("THINKSPACE_FLASHCARD_MODEL", DEFAULT_FLASHCARD_MODEL)


def get_canvas_visual_planner_model() -> str:
    """Return the model used to plan static canvas visuals."""

    return os.getenv(
        "THINKSPACE_CANVAS_VISUAL_PLANNER_MODEL",
        DEFAULT_CANVAS_VISUAL_PLANNER_MODEL,
    )


def get_canvas_visual_image_model() -> str:
    """Return the image model used to render static canvas visuals."""

    return os.getenv(
        "THINKSPACE_CANVAS_VISUAL_IMAGE_MODEL",
        DEFAULT_CANVAS_VISUAL_IMAGE_MODEL,
    )
