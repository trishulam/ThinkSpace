"""Lean source extraction helpers for grounding."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, ConfigDict

from session_source_materials import SourceMaterialRecord


def _to_camel(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part.capitalize() for part in parts[1:])


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=_to_camel, populate_by_name=True)


SUPPORTED_SOURCE_EXTENSIONS = {".pdf", ".txt", ".md", ".markdown"}
SUPPORTED_SOURCE_MIME_TYPES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
}
TEXT_PLAIN_MIME_TYPE = "text/plain"
MARKDOWN_MIME_TYPES = {"text/markdown", "text/x-markdown"}


class ParsedSource(ApiModel):
    source_id: str
    source_type: Literal["attachment", "prompt"]
    title: str
    mime_type: str
    text: str


class SourceExtractionFailure(ApiModel):
    source_id: str
    title: str
    mime_type: str
    error: str


@dataclass
class SourceExtractionResult:
    parsed_sources: list[ParsedSource]
    failures: list[SourceExtractionFailure]


def is_supported_source_material(file_name: str, mime_type: str | None) -> bool:
    suffix = Path(file_name).suffix.lower()
    normalized_mime_type = (mime_type or "").lower()
    return suffix in SUPPORTED_SOURCE_EXTENSIONS or normalized_mime_type in SUPPORTED_SOURCE_MIME_TYPES


def build_prompt_parsed_source(topic: str, goal: str | None) -> ParsedSource | None:
    prompt_bits = [bit.strip() for bit in [topic, goal or ""] if bit and bit.strip()]
    if not prompt_bits:
        return None

    return ParsedSource(
        source_id="session-prompt",
        source_type="prompt",
        title="Learner prompt",
        mime_type=TEXT_PLAIN_MIME_TYPE,
        text="\n\n".join(prompt_bits),
    )


def extract_parsed_sources(
    materials: list[SourceMaterialRecord],
    *,
    read_bytes: Callable[[SourceMaterialRecord], bytes],
) -> SourceExtractionResult:
    parsed_sources: list[ParsedSource] = []
    failures: list[SourceExtractionFailure] = []

    for material in materials:
        try:
            parsed_sources.append(
                ParsedSource(
                    source_id=material.source_id,
                    source_type="attachment",
                    title=material.file_name,
                    mime_type=material.mime_type,
                    text=_extract_text(material, read_bytes(material)),
                )
            )
        except (FileNotFoundError, ModuleNotFoundError, ValueError) as exc:
            failures.append(
                SourceExtractionFailure(
                    source_id=material.source_id,
                    title=material.file_name,
                    mime_type=material.mime_type,
                    error=str(exc),
                )
            )

    return SourceExtractionResult(parsed_sources=parsed_sources, failures=failures)


def _extract_text(material: SourceMaterialRecord, file_bytes: bytes) -> str:
    suffix = Path(material.file_name).suffix.lower()

    if suffix == ".pdf" or material.mime_type == "application/pdf":
        text = _extract_pdf_text(file_bytes)
    elif suffix in {".txt", ".md", ".markdown"} or material.mime_type in {
        TEXT_PLAIN_MIME_TYPE,
        *MARKDOWN_MIME_TYPES,
    }:
        text = _decode_text_bytes(file_bytes)
    else:
        raise ValueError(f"Unsupported source material type: {material.file_name}")

    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError(f"No extractable text found in {material.file_name}")
    return normalized_text


def _extract_pdf_text(file_bytes: bytes) -> str:
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ModuleNotFoundError as exc:
        raise ValueError(
            "PDF extraction requires the pypdf package in the active backend environment"
        ) from exc

    try:
        reader = PdfReader(BytesIO(file_bytes))
        page_text = [page.extract_text() or "" for page in reader.pages]
        return "\n\n".join(text for text in page_text if text.strip())
    except PdfReadError as exc:
        raise ValueError(str(exc)) from exc


def _decode_text_bytes(file_bytes: bytes) -> str:
    for encoding in ("utf-8", "utf-8-sig"):
        try:
            return file_bytes.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Unable to decode text file as UTF-8")
