"""Tool registry for the ThinkSpace agent."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .canvas_delegate import get_canvas_delegate_tools
from .canvas_visuals import get_canvas_visual_tools
from .flashcards import get_flashcard_tools


def get_tools() -> Sequence[Any]:
    """Return the currently enabled ThinkSpace tools.

    The tool registry should expose only the capabilities that are actually
    implemented and aligned with the current ThinkSpace contracts.
    """

    return [
        *get_canvas_delegate_tools(),
        *get_canvas_visual_tools(),
        *get_flashcard_tools(),
    ]
