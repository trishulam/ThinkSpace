"""ThinkSpace agent definition."""

from __future__ import annotations

from google.adk.agents import Agent

from .config import get_agent_model
from .instructions import build_instruction
from .tools import get_tools


agent = Agent(
    name="thinkspace_agent",
    model=get_agent_model(),
    tools=list(get_tools()),
    instruction=build_instruction(),
)
