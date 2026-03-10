"""Helpers for formatting dynamic session context."""

from __future__ import annotations

from .models import SessionContext


def build_runtime_context(context: SessionContext) -> str:
    """Format session-specific context separately from the static prompt.

    This module intentionally does not inject itself into the agent's static
    instruction yet. It exists to reserve a clean boundary for future session
    metadata, digests, and user-memory-aware context assembly.
    """

    sections: list[str] = []

    if context.lecture.title or context.lecture.topic or context.lecture.learning_objective:
        lecture_lines = ["## Lecture Context"]
        if context.lecture.title:
            lecture_lines.append(f"- Title: {context.lecture.title}")
        if context.lecture.topic:
            lecture_lines.append(f"- Topic: {context.lecture.topic}")
        if context.lecture.learning_objective:
            lecture_lines.append(
                f"- Learning objective: {context.lecture.learning_objective}"
            )
        sections.append("\n".join(lecture_lines))

    if context.current_goal:
        sections.append(f"## Current Goal\n- {context.current_goal}")

    surface_lines = ["## Active Surfaces"]
    has_surface_state = False
    if context.surfaces.canvas_summary:
        surface_lines.append(f"- Canvas: {context.surfaces.canvas_summary}")
        has_surface_state = True
    if context.surfaces.flashcard_summary:
        surface_lines.append(f"- Flashcards: {context.surfaces.flashcard_summary}")
        has_surface_state = True
    if context.surfaces.widget_summary:
        surface_lines.append(f"- Widgets: {context.surfaces.widget_summary}")
        has_surface_state = True
    if has_surface_state:
        sections.append("\n".join(surface_lines))

    if context.recent_digests:
        digest_lines = ["## Recent Digests"]
        digest_lines.extend(f"- {digest}" for digest in context.recent_digests)
        sections.append("\n".join(digest_lines))

    return "\n\n".join(sections)
