"""Shared models for widget reasoning and canvas insertion."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


WidgetKind = Literal["graph", "notation"]


class WidgetReasonerRequest(BaseModel):
    widget_type: WidgetKind
    prompt: str = Field(min_length=1)


class GraphWidgetSpec(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    expression: str = Field(min_length=1, max_length=200)
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    x_label: str = Field(min_length=1, max_length=40)
    y_label: str = Field(min_length=1, max_length=40)


class NotationBlockSpec(BaseModel):
    latex: str = Field(min_length=1, max_length=1200)
    label: str = Field(default="", max_length=80)


class NotationWidgetSpec(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    blocks: list[NotationBlockSpec] = Field(min_length=1, max_length=12)
    annotation: str = Field(default="", max_length=240)


class GraphWidgetReasonerOutput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    expression: str = Field(min_length=1, max_length=200)
    x_min: float
    x_max: float
    y_min: float
    y_max: float
    x_label: str = Field(min_length=1, max_length=40)
    y_label: str = Field(min_length=1, max_length=40)


class NotationBlockReasonerOutput(BaseModel):
    latex: str = Field(min_length=1, max_length=1200)
    label: str = Field(default="", max_length=80)


class NotationWidgetReasonerOutput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    blocks: list[NotationBlockReasonerOutput] = Field(min_length=1, max_length=12)
    annotation: str = Field(default="", max_length=240)


class WidgetReasonerDebug(BaseModel):
    model: str
    prompt_text: str
    raw_response_text: str | None = None
    raw_parsed_payload: dict[str, object] | None = None


class WidgetReasonerResponse(BaseModel):
    widget_type: WidgetKind
    status: Literal["completed"]
    title: str = Field(min_length=1, max_length=120)
    spec: GraphWidgetSpec | NotationWidgetSpec
    debug: WidgetReasonerDebug


class WidgetArtifactPayload(BaseModel):
    artifact_id: str = Field(min_length=1, max_length=120)
    widget_kind: WidgetKind
    title: str = Field(min_length=1, max_length=120)
    spec: GraphWidgetSpec | NotationWidgetSpec
    x: float
    y: float
    w: float | None = None
    h: float | None = None
