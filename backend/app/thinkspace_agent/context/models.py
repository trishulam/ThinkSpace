"""Structured runtime context models for ThinkSpace."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class LectureContext:
    """High-level session facts that should stay out of the static prompt."""

    title: str | None = None
    topic: str | None = None
    learning_objective: str | None = None


@dataclass(slots=True)
class SurfaceState:
    """Summarizes active study surfaces without exposing raw UI noise."""

    canvas_summary: str | None = None
    flashcard_summary: str | None = None
    widget_summary: str | None = None


@dataclass(slots=True)
class SessionContext:
    """Dynamic session context that can be injected at reasoning time later."""

    lecture: LectureContext = field(default_factory=LectureContext)
    surfaces: SurfaceState = field(default_factory=SurfaceState)
    current_goal: str | None = None
    recent_digests: list[str] = field(default_factory=list)
