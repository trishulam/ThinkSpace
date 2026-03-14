"""Shared widget reasoner service for graph and notation widgets."""

from __future__ import annotations

import os

from google.genai import Client
from google.genai import types as genai_types

from thinkspace_agent.config import get_widget_reasoner_model

from .models import (
    GraphWidgetReasonerOutput,
    GraphWidgetSpec,
    NotationWidgetReasonerOutput,
    NotationWidgetSpec,
    WidgetReasonerDebug,
    WidgetReasonerRequest,
    WidgetReasonerResponse,
)


def _build_client() -> Client:
    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def _build_graph_prompt(prompt: str) -> str:
    return "\n".join(
        [
            "You are building a graph widget spec for ThinkSpace.",
            "Return only JSON matching the provided schema.",
            "This is for a single 2D Cartesian function plot.",
            "Requirements:",
            "- Produce exactly one function expression compatible with function-plot math syntax.",
            "- Keep the graph to one function only.",
            "- Choose sensible x and y ranges for learning visibility.",
            "- Ensure x_min < x_max and y_min < y_max.",
            "- Prefer simple axis labels such as x and y unless a clearer label is explicitly needed.",
            "- Keep the title concise and learner-facing.",
            "",
            f"Prompt: {prompt.strip()}",
        ]
    )


def _build_notation_prompt(prompt: str) -> str:
    return "\n".join(
        [
            "You are building a notation widget spec for ThinkSpace.",
            "Return only JSON matching the provided schema.",
            "Requirements:",
            "- Produce valid KaTeX-compatible LaTeX in one or more ordered blocks.",
            "- Use multiple blocks when the learner asked for a derivation, proof, or multi-step notation card.",
            "- Keep each block focused and readable.",
            "- Use short labels only when they materially improve clarity.",
            "- Keep the title concise and learner-facing.",
            "- Keep the annotation short and helpful.",
            "",
            f"Prompt: {prompt.strip()}",
        ]
    )


def reason_widget(request: WidgetReasonerRequest) -> WidgetReasonerResponse:
    model_name = get_widget_reasoner_model()
    prompt = request.prompt.strip()
    client = _build_client()

    if request.widget_type == "graph":
        prompt_text = _build_graph_prompt(prompt)
        response = client.models.generate_content(
            model=model_name,
            contents=prompt_text,
            config=genai_types.GenerateContentConfig(
                temperature=0.2,
                response_mime_type="application/json",
                response_schema=GraphWidgetReasonerOutput,
            ),
        )
        if response.parsed is None:
            raise ValueError("Graph widget reasoner returned no structured output")
        parsed = GraphWidgetReasonerOutput.model_validate(response.parsed)
        spec = GraphWidgetSpec(**parsed.model_dump())
        return WidgetReasonerResponse(
            widget_type="graph",
            status="completed",
            title=spec.title,
            spec=spec,
            debug=WidgetReasonerDebug(
                model=model_name,
                prompt_text=prompt_text,
                raw_response_text=response.text if isinstance(response.text, str) else None,
                raw_parsed_payload=parsed.model_dump(mode="python"),
            ),
        )

    prompt_text = _build_notation_prompt(prompt)
    response = client.models.generate_content(
        model=model_name,
        contents=prompt_text,
        config=genai_types.GenerateContentConfig(
            temperature=0.2,
            response_mime_type="application/json",
            response_schema=NotationWidgetReasonerOutput,
        ),
    )
    if response.parsed is None:
        raise ValueError("Notation widget reasoner returned no structured output")
    parsed = NotationWidgetReasonerOutput.model_validate(response.parsed)
    spec = NotationWidgetSpec(**parsed.model_dump())
    return WidgetReasonerResponse(
        widget_type="notation",
        status="completed",
        title=spec.title,
        spec=spec,
        debug=WidgetReasonerDebug(
            model=model_name,
            prompt_text=prompt_text,
            raw_response_text=response.text if isinstance(response.text, str) else None,
            raw_parsed_payload=parsed.model_dump(mode="python"),
        ),
    )
