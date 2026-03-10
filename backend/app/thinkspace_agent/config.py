"""Configuration helpers for the ThinkSpace agent."""

from __future__ import annotations

import os

DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"


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
