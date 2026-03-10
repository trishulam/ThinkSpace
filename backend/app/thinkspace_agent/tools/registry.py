"""Tool registry for the ThinkSpace agent."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any


def get_tools() -> Sequence[Any]:
    """Return the currently enabled ThinkSpace tools.

    Story Group A will define the real tool families and contracts. For now, the
    ThinkSpace agent starts with an explicit empty registry so the product agent
    structure exists without inheriting demo-only tool behavior.
    """

    return []
