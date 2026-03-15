"""Vertex AI RAG helpers for session-grounding corpora."""

from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from collections.abc import Iterable
from typing import Any

from pydantic import BaseModel

from session_source_materials import SessionSourceMaterialStore, SourceMaterialRecord
from session_store import SessionRecord
from thinkspace_agent.config import (
    get_vertex_rag_chunk_overlap,
    get_vertex_rag_chunk_size,
    get_vertex_rag_embedding_model,
    get_vertex_rag_location,
    get_vertex_rag_max_embedding_requests_per_min,
    get_vertex_rag_verification_top_k,
)

logger = logging.getLogger(__name__)


class VertexSessionRagResult(BaseModel):
    rag_corpus_name: str
    rag_corpus_id: str
    imported_file_count: int
    skipped_file_count: int = 0
    verification_query: str
    verification_match_count: int


class VertexSessionLookupResultItem(BaseModel):
    source_id: str
    source_title: str
    locator: str
    snippet: str
    relevance_score: float
    section_title: str | None = None


class VertexSessionLookupResult(BaseModel):
    query: str
    results: list[VertexSessionLookupResultItem]


class VertexSessionRagPreparationError(RuntimeError):
    """Raised when corpus preparation fails after a corpus is already known."""

    def __init__(self, message: str, *, rag_corpus_id: str | None = None) -> None:
        super().__init__(message)
        self.rag_corpus_id = rag_corpus_id


async def prepare_session_rag_corpus(
    *,
    session: SessionRecord,
    materials: list[SourceMaterialRecord],
    source_material_store: SessionSourceMaterialStore,
    existing_rag_corpus_id: str | None,
) -> VertexSessionRagResult:
    """Create or reuse the session corpus, ingest files, and verify retrieval."""

    return await asyncio.to_thread(
        _prepare_session_rag_corpus_sync,
        session,
        materials,
        source_material_store,
        existing_rag_corpus_id,
    )


async def delete_session_rag_corpus(rag_corpus_id: str) -> None:
    """Delete a session Vertex RAG corpus if it still exists."""

    await asyncio.to_thread(_delete_session_rag_corpus_sync, rag_corpus_id)


async def lookup_session_rag_corpus(
    *,
    rag_corpus_id: str,
    query: str,
    max_results: int,
) -> VertexSessionLookupResult:
    """Query an existing session corpus and return compact snippet results."""

    return await asyncio.to_thread(
        _lookup_session_rag_corpus_sync,
        rag_corpus_id,
        query,
        max_results,
    )


def lookup_session_rag_corpus_sync(
    *,
    rag_corpus_id: str,
    query: str,
    max_results: int,
) -> VertexSessionLookupResult:
    """Synchronously query an existing session corpus."""

    return _lookup_session_rag_corpus_sync(rag_corpus_id, query, max_results)


def _prepare_session_rag_corpus_sync(
    session: SessionRecord,
    materials: list[SourceMaterialRecord],
    source_material_store: SessionSourceMaterialStore,
    existing_rag_corpus_id: str | None,
) -> VertexSessionRagResult:
    if not materials:
        raise ValueError("At least one source material is required for Vertex RAG ingestion")

    project = _get_project_id()
    location = get_vertex_rag_location()
    vertexai, rag, api_exceptions = _get_vertex_rag_sdk()
    vertexai.init(project=project, location=location)

    corpus_name = _ensure_corpus(
        rag=rag,
        api_exceptions=api_exceptions,
        session=session,
        existing_rag_corpus_id=existing_rag_corpus_id,
    )
    rag_corpus_id = _extract_rag_corpus_id(corpus_name)

    try:
        imported_file_count, skipped_file_count = _ingest_materials(
            rag=rag,
            corpus_name=corpus_name,
            materials=materials,
            source_material_store=source_material_store,
        )

        verification_query = _build_verification_query(session)
        retrieval_response = rag.retrieval_query(
            rag_resources=[rag.RagResource(rag_corpus=corpus_name)],
            text=verification_query,
            rag_retrieval_config=rag.RagRetrievalConfig(
                top_k=get_vertex_rag_verification_top_k(),
            ),
        )
        verification_match_count = _count_retrieved_contexts(retrieval_response)
        if verification_match_count < 1:
            raise ValueError("Vertex RAG retrieval verification returned no contexts")
    except Exception as exc:
        raise VertexSessionRagPreparationError(
            str(exc),
            rag_corpus_id=rag_corpus_id,
        ) from exc

    return VertexSessionRagResult(
        rag_corpus_name=corpus_name,
        rag_corpus_id=rag_corpus_id,
        imported_file_count=imported_file_count,
        skipped_file_count=skipped_file_count,
        verification_query=verification_query,
        verification_match_count=verification_match_count,
    )


def _delete_session_rag_corpus_sync(rag_corpus_id: str) -> None:
    if not rag_corpus_id:
        return

    project = _get_project_id()
    location = get_vertex_rag_location()
    vertexai, rag, api_exceptions = _get_vertex_rag_sdk()
    vertexai.init(project=project, location=location)
    corpus_name = _build_corpus_name(project=project, location=location, rag_corpus_id=rag_corpus_id)

    try:
        rag.delete_corpus(name=corpus_name)
    except api_exceptions.NotFound:
        logger.info("Vertex RAG corpus already absent for corpus_id=%s", rag_corpus_id)


def _lookup_session_rag_corpus_sync(
    rag_corpus_id: str,
    query: str,
    max_results: int,
) -> VertexSessionLookupResult:
    normalized_query = query.strip()
    if not normalized_query:
        raise ValueError("Lookup query is required")

    project = _get_project_id()
    location = get_vertex_rag_location()
    vertexai, rag, _ = _get_vertex_rag_sdk()
    vertexai.init(project=project, location=location)
    corpus_name = _build_corpus_name(
        project=project,
        location=location,
        rag_corpus_id=rag_corpus_id,
    )
    normalized_max_results = max(1, min(max_results, 5))
    response = rag.retrieval_query(
        rag_resources=[rag.RagResource(rag_corpus=corpus_name)],
        text=normalized_query,
        rag_retrieval_config=rag.RagRetrievalConfig(top_k=normalized_max_results),
    )
    return VertexSessionLookupResult(
        query=normalized_query,
        results=_extract_lookup_results(response),
    )


def _ensure_corpus(
    *,
    rag: Any,
    api_exceptions: Any,
    session: SessionRecord,
    existing_rag_corpus_id: str | None,
) -> str:
    if existing_rag_corpus_id:
        existing_corpus_name = _build_corpus_name(
            project=_get_project_id(),
            location=get_vertex_rag_location(),
            rag_corpus_id=existing_rag_corpus_id,
        )
        try:
            corpus = rag.get_corpus(name=existing_corpus_name)
            return str(corpus.name)
        except api_exceptions.NotFound:
            logger.info(
                "Stored Vertex RAG corpus missing for session_id=%s; recreating",
                session.session_id,
            )

    embedding_model = get_vertex_rag_embedding_model()
    corpus = rag.create_corpus(
        display_name=_build_corpus_display_name(session.session_id),
        description=_build_corpus_description(session),
        backend_config=rag.RagVectorDbConfig(
            rag_embedding_model_config=rag.RagEmbeddingModelConfig(
                vertex_prediction_endpoint=rag.VertexPredictionEndpoint(
                    publisher_model=embedding_model,
                )
            )
        ),
    )
    return str(corpus.name)


def _ingest_materials(
    *,
    rag: Any,
    corpus_name: str,
    materials: list[SourceMaterialRecord],
    source_material_store: SessionSourceMaterialStore,
) -> tuple[int, int]:
    if source_material_store.is_gcs_backed():
        return _ingest_from_gcs(
            rag=rag,
            corpus_name=corpus_name,
            materials=materials,
            source_material_store=source_material_store,
        )
    return _ingest_from_local_files(
        rag=rag,
        corpus_name=corpus_name,
        materials=materials,
        source_material_store=source_material_store,
    )


def _ingest_from_gcs(
    *,
    rag: Any,
    corpus_name: str,
    materials: list[SourceMaterialRecord],
    source_material_store: SessionSourceMaterialStore,
) -> tuple[int, int]:
    paths = [
        gcs_uri
        for material in materials
        if (gcs_uri := source_material_store.get_material_gcs_uri(material))
    ]
    if not paths:
        raise ValueError("No GCS source material URIs available for Vertex RAG import")

    response = rag.import_files(
        corpus_name=corpus_name,
        paths=paths,
        transformation_config=rag.TransformationConfig(
            chunking_config=rag.ChunkingConfig(
                chunk_size=get_vertex_rag_chunk_size(),
                chunk_overlap=get_vertex_rag_chunk_overlap(),
            )
        ),
        max_embedding_requests_per_min=get_vertex_rag_max_embedding_requests_per_min(),
    )
    return (
        int(getattr(response, "imported_rag_files_count", 0)),
        int(getattr(response, "skipped_rag_files_count", 0)),
    )


def _ingest_from_local_files(
    *,
    rag: Any,
    corpus_name: str,
    materials: list[SourceMaterialRecord],
    source_material_store: SessionSourceMaterialStore,
) -> tuple[int, int]:
    existing_display_names = {
        str(file.display_name)
        for file in rag.list_files(corpus_name=corpus_name)
        if getattr(file, "display_name", None)
    }
    imported_file_count = 0
    skipped_file_count = 0

    for material in materials:
        display_name = _build_rag_file_display_name(material)
        if display_name in existing_display_names:
            skipped_file_count += 1
            continue

        local_path = source_material_store.get_material_local_path(material)
        if local_path is None:
            raise ValueError(f"Local source material path unavailable for {material.file_name}")
        if not local_path.exists():
            raise FileNotFoundError(f"Source material not found: {local_path}")

        rag.upload_file(
            corpus_name=corpus_name,
            path=str(local_path),
            display_name=display_name,
            description=f"ThinkSpace source material for session {material.session_id}",
        )
        existing_display_names.add(display_name)
        imported_file_count += 1

    return imported_file_count, skipped_file_count


def _build_verification_query(session: SessionRecord) -> str:
    if session.topic.strip():
        return session.topic.strip()
    if session.goal and session.goal.strip():
        return session.goal.strip()
    return "Summarize the uploaded learning material"


def _build_corpus_display_name(session_id: str) -> str:
    return f"thinkspace-session-{session_id}"


def _build_corpus_description(session: SessionRecord) -> str:
    goal_suffix = f" Goal: {session.goal.strip()}." if session.goal and session.goal.strip() else ""
    return f"ThinkSpace grounding corpus for topic: {session.topic.strip()}.{goal_suffix}"


def _build_rag_file_display_name(material: SourceMaterialRecord) -> str:
    return f"{material.source_id}:{material.file_name}"


def _extract_rag_corpus_id(corpus_name: str) -> str:
    return corpus_name.rstrip("/").split("/")[-1]


def _build_corpus_name(*, project: str, location: str, rag_corpus_id: str) -> str:
    return f"projects/{project}/locations/{location}/ragCorpora/{rag_corpus_id}"


def _extract_lookup_results(response: Any) -> list[VertexSessionLookupResultItem]:
    contexts = _extract_retrieval_contexts(response)
    results: list[VertexSessionLookupResultItem] = []

    for index, context in enumerate(contexts, start=1):
        text = _read_context_field(context, "text")
        if not isinstance(text, str) or not text.strip():
            continue

        source_uri = _read_context_field(context, "source_uri") or _read_context_field(
            context, "sourceUri"
        )
        source_display_name = _read_context_field(
            context, "source_display_name"
        ) or _read_context_field(context, "sourceDisplayName")
        title = _derive_source_title(source_display_name, source_uri, index=index)
        source_id = _derive_source_id(source_uri, index=index)
        locator = _derive_locator(context, index=index)
        section_title = _derive_section_title(context)
        relevance_score = _derive_relevance_score(context)

        results.append(
            VertexSessionLookupResultItem(
                source_id=source_id,
                source_title=title,
                locator=locator,
                snippet=" ".join(text.split()),
                relevance_score=relevance_score,
                section_title=section_title,
            )
        )

    return results


def _count_retrieved_contexts(response: Any) -> int:
    contexts = _extract_retrieval_contexts(response)
    count = 0
    for context in contexts:
        text = getattr(context, "text", None)
        if text is None and isinstance(context, dict):
            text = context.get("text")
        if isinstance(text, str) and text.strip():
            count += 1
    return count


def _extract_retrieval_contexts(response: Any) -> list[Any]:
    contexts_root = getattr(response, "contexts", None)
    if contexts_root is None and isinstance(response, dict):
        contexts_root = response.get("contexts")

    if contexts_root is None:
        return []

    contexts = getattr(contexts_root, "contexts", None)
    if contexts is None and isinstance(contexts_root, dict):
        contexts = contexts_root.get("contexts")
    if contexts is None and _is_context_iterable(contexts_root):
        contexts = list(contexts_root)
    if not _is_context_iterable(contexts):
        return []
    return list(contexts)


def _read_context_field(context: Any, field_name: str) -> Any:
    value = getattr(context, field_name, None)
    if value is None and isinstance(context, dict):
        value = context.get(field_name)
    return value


def _derive_source_title(
    source_display_name: object,
    source_uri: object,
    *,
    index: int,
) -> str:
    if isinstance(source_display_name, str) and source_display_name.strip():
        return source_display_name.strip()
    if isinstance(source_uri, str) and source_uri.strip():
        trimmed = source_uri.strip().rstrip("/")
        return trimmed.rsplit("/", maxsplit=1)[-1] or f"Retrieved source {index}"
    return f"Retrieved source {index}"


def _derive_source_id(source_uri: object, *, index: int) -> str:
    if isinstance(source_uri, str) and source_uri.strip():
        return source_uri.strip()
    return f"retrieved-source-{index}"


def _derive_locator(context: Any, *, index: int) -> str:
    page_span = _read_context_field(context, "page_span") or _read_context_field(
        context, "pageSpan"
    )
    if isinstance(page_span, object):
        start_page = getattr(page_span, "start_page", None)
        if start_page is None and isinstance(page_span, dict):
            start_page = page_span.get("start_page") or page_span.get("startPage")
        end_page = getattr(page_span, "end_page", None)
        if end_page is None and isinstance(page_span, dict):
            end_page = page_span.get("end_page") or page_span.get("endPage")
        if isinstance(start_page, int) and isinstance(end_page, int):
            if start_page == end_page:
                return f"page {start_page}"
            return f"pages {start_page}-{end_page}"
        if isinstance(start_page, int):
            return f"page {start_page}"

    chunk_index = _read_context_field(context, "chunk_index") or _read_context_field(
        context, "chunkIndex"
    )
    if isinstance(chunk_index, int):
        return f"chunk {chunk_index}"
    return f"match {index}"


def _derive_section_title(context: Any) -> str | None:
    section_title = _read_context_field(context, "section_title") or _read_context_field(
        context, "sectionTitle"
    )
    if isinstance(section_title, str) and section_title.strip():
        return section_title.strip()
    return None


def _derive_relevance_score(context: Any) -> float:
    for field_name in ("score", "relevance_score", "relevanceScore", "distance"):
        value = _read_context_field(context, field_name)
        if isinstance(value, (int, float)):
            if field_name == "distance":
                return max(0.0, min(1.0, 1.0 - float(value)))
            return float(value)
    return 0.0


def _is_context_iterable(value: Any) -> bool:
    return (
        value is not None
        and not isinstance(value, (str, bytes, dict))
        and isinstance(value, Iterable)
    )


def _get_project_id() -> str:
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    if not project:
        raise ValueError("GOOGLE_CLOUD_PROJECT is required for Vertex RAG operations")
    return project


def _get_vertex_rag_sdk() -> tuple[Any, Any, Any]:
    import vertexai
    from google.api_core import exceptions as api_exceptions
    from vertexai import rag

    return vertexai, rag, api_exceptions
