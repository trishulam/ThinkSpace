"""Instruction assembly for the ThinkSpace agent."""

from __future__ import annotations

from pathlib import Path
from typing import Awaitable, Callable

from google.adk.agents.readonly_context import ReadonlyContext


INSTRUCTION_FILES = (
    "base.md",
    "tool_policy.md",
    "response_policy.md",
)


def _read_instruction_file(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def _build_static_instruction() -> str:
    """Build the static instruction text for the ThinkSpace agent."""

    instruction_dir = Path(__file__).resolve().parent
    parts = [
        _read_instruction_file(instruction_dir / file_name)
        for file_name in INSTRUCTION_FILES
    ]
    return "\n\n".join(part for part in parts if part)


def get_static_instruction_text() -> str:
    """Return the assembled static instruction text."""

    return _build_static_instruction()


def build_instruction_text(memory: str | None = None) -> str:
    """Return the full instruction text for an optional memory payload."""

    static_instruction = _build_static_instruction()
    if not isinstance(memory, str) or not memory.strip():
        return static_instruction

    return (
        f"{static_instruction}\n\n"
        "## Learner Conversation Memory\n"
        "The following is persisted memory from earlier turns in this same session. "
        "Use it to answer follow-up questions, maintain continuity, and avoid claiming "
        "that you cannot recall prior discussion when the memory below contains it.\n\n"
        f"{memory.strip()}"
    )


def build_instruction() -> Callable[[ReadonlyContext], str | Awaitable[str]]:
    """Build an instruction provider that injects persisted learner memory."""

    static_instruction = _build_static_instruction()

    def instruction_provider(context: ReadonlyContext) -> str:
        memory = context.state.get("conversation_memory")
        if not isinstance(memory, str) or not memory.strip():
            return static_instruction

        return (
            f"{static_instruction}\n\n"
            "## Learner Conversation Memory\n"
            "The following is persisted memory from earlier turns in this same session. "
            "Use it to answer follow-up questions, maintain continuity, and avoid claiming "
            "that you cannot recall prior discussion when the memory below contains it.\n\n"
            f"{memory.strip()}"
        )

    return instruction_provider
