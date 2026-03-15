"""Instruction assembly for the ThinkSpace agent."""

from __future__ import annotations

from pathlib import Path
from typing import Awaitable, Callable

from google.adk.agents.readonly_context import ReadonlyContext  # pylint: disable=no-name-in-module,import-error
from session_grounding_bundle import ORCHESTRATOR_STUDY_PLAN_STATE_KEY
from session_personas import ORCHESTRATOR_PERSONA_STATE_KEY


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


def _compose_instruction_text(
    *,
    static_instruction: str,
    memory: str | None = None,
    study_plan_text: str | None = None,
    persona_overlay_text: str | None = None,
) -> str:
    sections = [static_instruction]

    if isinstance(persona_overlay_text, str) and persona_overlay_text.strip():
        sections.append(
            "## Active Tutor Persona\n"
            "Apply this persona consistently in your tone, pacing, and teaching posture for the full live session.\n\n"
            f"{persona_overlay_text.strip()}"
        )

    if isinstance(study_plan_text, str) and study_plan_text.strip():
        sections.append(
            "## Session Study Plan\n"
            "Use this as the main pedagogical scaffold for the live session. "
            "Follow its sequence and teaching intent unless the learner clearly needs to deviate.\n\n"
            f"{study_plan_text.strip()}"
        )

    if isinstance(memory, str) and memory.strip():
        sections.append(
            "## Learner Conversation Memory\n"
            "The following is persisted memory from earlier turns in this same session. "
            "Use it to answer follow-up questions, maintain continuity, and avoid claiming "
            "that you cannot recall prior discussion when the memory below contains it.\n\n"
            f"{memory.strip()}"
        )

    return "\n\n".join(section for section in sections if section.strip())


def build_instruction_text(
    memory: str | None = None,
    study_plan_text: str | None = None,
    persona_overlay_text: str | None = None,
) -> str:
    """Return the full instruction text for optional grounding and memory payloads."""

    static_instruction = _build_static_instruction()
    return _compose_instruction_text(
        static_instruction=static_instruction,
        memory=memory,
        study_plan_text=study_plan_text,
        persona_overlay_text=persona_overlay_text,
    )


def build_instruction() -> Callable[[ReadonlyContext], str | Awaitable[str]]:
    """Build an instruction provider that injects persisted learner memory."""

    static_instruction = _build_static_instruction()

    def instruction_provider(context: ReadonlyContext) -> str:
        memory = context.state.get("conversation_memory")
        study_plan_text = context.state.get(ORCHESTRATOR_STUDY_PLAN_STATE_KEY)
        persona_overlay_text = context.state.get(ORCHESTRATOR_PERSONA_STATE_KEY)
        return _compose_instruction_text(
            static_instruction=static_instruction,
            memory=memory if isinstance(memory, str) else None,
            study_plan_text=study_plan_text if isinstance(study_plan_text, str) else None,
            persona_overlay_text=(
                persona_overlay_text if isinstance(persona_overlay_text, str) else None
            ),
        )

    return instruction_provider
