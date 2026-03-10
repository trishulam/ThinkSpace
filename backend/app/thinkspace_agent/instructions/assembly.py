"""Instruction assembly for the ThinkSpace agent."""

from __future__ import annotations

from pathlib import Path


INSTRUCTION_FILES = (
    "base.md",
    "tool_policy.md",
    "response_policy.md",
)


def _read_instruction_file(path: Path) -> str:
    return path.read_text(encoding="utf-8").strip()


def build_instruction() -> str:
    """Build the static instruction text for the ThinkSpace agent."""

    instruction_dir = Path(__file__).resolve().parent
    parts = [
        _read_instruction_file(instruction_dir / file_name)
        for file_name in INSTRUCTION_FILES
    ]
    return "\n\n".join(part for part in parts if part)
