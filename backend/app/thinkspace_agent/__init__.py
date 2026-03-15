"""ThinkSpace agent package."""

from __future__ import annotations

from .config import get_agent_model

__all__ = ["agent", "get_agent_model"]


def __getattr__(name: str):
    if name == "agent":
        from .agent import agent

        return agent
    raise AttributeError(name)
