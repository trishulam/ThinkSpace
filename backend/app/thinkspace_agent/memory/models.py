"""Semantic learner and session memory placeholders for ThinkSpace."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class LearnerMemory:
    """Captures durable learner-specific signals for future tutoring decisions."""

    preferences: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    recurring_struggles: list[str] = field(default_factory=list)


@dataclass(slots=True)
class SessionMemorySnapshot:
    """Summarizes the current session's semantic memory state."""

    learner_memory: LearnerMemory = field(default_factory=LearnerMemory)
    recent_interventions: list[str] = field(default_factory=list)
    recent_topic_shifts: list[str] = field(default_factory=list)
