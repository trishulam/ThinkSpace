from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

from session_source_materials import SourceMaterialRecord
from session_store import SessionRecord
from session_vertex_rag import (
    VertexSessionRagPreparationError,
    _count_retrieved_contexts,
    _delete_session_rag_corpus_sync,
    _extract_lookup_results,
    _prepare_session_rag_corpus_sync,
)


class _NotFound(Exception):
    pass


class FakeRagSdk:
    def __init__(self) -> None:
        self.created_corpora: list[dict[str, str]] = []
        self.deleted_corpora: list[str] = []
        self.uploaded_files: list[dict[str, str]] = []
        self.import_requests: list[dict[str, object]] = []
        self.last_retrieval_query: dict[str, object] | None = None
        self.get_corpus_error: Exception | None = None
        self.get_corpus_response = None
        self.list_files_response: list[SimpleNamespace] = []
        self.retrieval_response = SimpleNamespace(
            contexts=SimpleNamespace(contexts=[SimpleNamespace(text="match")])
        )

    class RagResource:
        def __init__(self, rag_corpus: str) -> None:
            self.rag_corpus = rag_corpus

    class RagRetrievalConfig:
        def __init__(self, top_k: int) -> None:
            self.top_k = top_k

    class VertexPredictionEndpoint:
        def __init__(self, publisher_model: str) -> None:
            self.publisher_model = publisher_model

    class RagEmbeddingModelConfig:
        def __init__(self, vertex_prediction_endpoint) -> None:
            self.vertex_prediction_endpoint = vertex_prediction_endpoint

    class RagVectorDbConfig:
        def __init__(self, rag_embedding_model_config) -> None:
            self.rag_embedding_model_config = rag_embedding_model_config

    class ChunkingConfig:
        def __init__(self, chunk_size: int, chunk_overlap: int) -> None:
            self.chunk_size = chunk_size
            self.chunk_overlap = chunk_overlap

    class TransformationConfig:
        def __init__(self, chunking_config) -> None:
            self.chunking_config = chunking_config

    def get_corpus(self, *, name: str):
        if self.get_corpus_error is not None:
            raise self.get_corpus_error
        if self.get_corpus_response is not None:
            return self.get_corpus_response
        return SimpleNamespace(name=name)

    def create_corpus(self, *, display_name: str, description: str, backend_config):
        corpus_name = (
            "projects/test-project/locations/us-central1/ragCorpora/generated-corpus"
        )
        self.created_corpora.append(
            {
                "display_name": display_name,
                "description": description,
                "embedding_model": (
                    backend_config.rag_embedding_model_config.vertex_prediction_endpoint.publisher_model
                ),
            }
        )
        return SimpleNamespace(name=corpus_name)

    def import_files(
        self,
        *,
        corpus_name: str,
        paths: list[str],
        transformation_config,
        max_embedding_requests_per_min: int,
    ):
        self.import_requests.append(
            {
                "corpus_name": corpus_name,
                "paths": paths,
                "chunk_size": transformation_config.chunking_config.chunk_size,
                "chunk_overlap": transformation_config.chunking_config.chunk_overlap,
                "max_embedding_requests_per_min": max_embedding_requests_per_min,
            }
        )
        return SimpleNamespace(imported_rag_files_count=len(paths), skipped_rag_files_count=0)

    def list_files(self, *, corpus_name: str):
        _ = corpus_name
        return list(self.list_files_response)

    def upload_file(self, *, corpus_name: str, path: str, display_name: str, description: str):
        self.uploaded_files.append(
            {
                "corpus_name": corpus_name,
                "path": path,
                "display_name": display_name,
                "description": description,
            }
        )
        return SimpleNamespace(name=f"{corpus_name}/ragFiles/{display_name}")

    def retrieval_query(self, *, rag_resources, text: str, rag_retrieval_config):
        self.last_retrieval_query = {
            "rag_corpus": rag_resources[0].rag_corpus,
            "text": text,
            "top_k": rag_retrieval_config.top_k,
        }
        return self.retrieval_response

    def delete_corpus(self, *, name: str):
        self.deleted_corpora.append(name)


class FakeStore:
    def __init__(self, *, gcs_backed: bool, root_dir: Path) -> None:
        self._gcs_backed = gcs_backed
        self._root_dir = root_dir

    def is_gcs_backed(self) -> bool:
        return self._gcs_backed

    def get_material_gcs_uri(self, material: SourceMaterialRecord) -> str | None:
        if not self._gcs_backed:
            return None
        return f"gs://bucket/{material.relative_path}"

    def get_material_local_path(self, material: SourceMaterialRecord) -> Path | None:
        if self._gcs_backed:
            return None
        return self._root_dir / material.relative_path


@pytest.fixture(name="session_record")
def session_record_fixture() -> SessionRecord:
    return SessionRecord(
        session_id="session-123",
        user_id="user-1",
        topic="Cell biology",
        goal="Understand mitochondria",
        mode="guided",
        level="beginner",
        created_at="2026-03-15T00:00:00+00:00",
        updated_at="2026-03-15T00:00:00+00:00",
        last_active_at="2026-03-15T00:00:00+00:00",
    )


@pytest.fixture(name="material")
def material_fixture() -> SourceMaterialRecord:
    return SourceMaterialRecord(
        source_id="src-1",
        session_id="session-123",
        file_name="lesson.txt",
        relative_path="session-123/lesson.txt",
        mime_type="text/plain",
        size_bytes=12,
        uploaded_at="2026-03-15T00:00:00+00:00",
    )


def _patch_sdk(monkeypatch: pytest.MonkeyPatch, rag_sdk: FakeRagSdk) -> None:
    fake_vertexai = SimpleNamespace(init=lambda project, location: None)
    fake_exceptions = SimpleNamespace(NotFound=_NotFound)
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "test-project")
    monkeypatch.setattr(
        "session_vertex_rag._get_vertex_rag_sdk",
        lambda: (fake_vertexai, rag_sdk, fake_exceptions),
    )


def test_creates_new_corpus_and_imports_gcs_files(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    session_record: SessionRecord,
    material: SourceMaterialRecord,
) -> None:
    rag_sdk = FakeRagSdk()
    _patch_sdk(monkeypatch, rag_sdk)
    store = FakeStore(gcs_backed=True, root_dir=tmp_path)

    result = _prepare_session_rag_corpus_sync(
        session_record,
        [material],
        store,
        existing_rag_corpus_id=None,
    )

    assert result.rag_corpus_id == "generated-corpus"
    assert rag_sdk.created_corpora[0]["display_name"] == "thinkspace-session-session-123"
    assert rag_sdk.import_requests[0]["paths"] == ["gs://bucket/session-123/lesson.txt"]
    assert rag_sdk.uploaded_files == []


def test_reuses_existing_corpus_when_it_still_exists(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    session_record: SessionRecord,
    material: SourceMaterialRecord,
) -> None:
    rag_sdk = FakeRagSdk()
    rag_sdk.get_corpus_response = SimpleNamespace(
        name="projects/test-project/locations/us-central1/ragCorpora/existing-corpus"
    )
    _patch_sdk(monkeypatch, rag_sdk)
    store = FakeStore(gcs_backed=True, root_dir=tmp_path)

    result = _prepare_session_rag_corpus_sync(
        session_record,
        [material],
        store,
        existing_rag_corpus_id="existing-corpus",
    )

    assert result.rag_corpus_id == "existing-corpus"
    assert rag_sdk.created_corpora == []
    assert rag_sdk.import_requests[0]["corpus_name"].endswith("/existing-corpus")


def test_recreates_stale_corpus_when_lookup_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    session_record: SessionRecord,
    material: SourceMaterialRecord,
) -> None:
    rag_sdk = FakeRagSdk()
    rag_sdk.get_corpus_error = _NotFound("missing")
    _patch_sdk(monkeypatch, rag_sdk)
    store = FakeStore(gcs_backed=True, root_dir=tmp_path)

    result = _prepare_session_rag_corpus_sync(
        session_record,
        [material],
        store,
        existing_rag_corpus_id="stale-corpus",
    )

    assert result.rag_corpus_id == "generated-corpus"
    assert len(rag_sdk.created_corpora) == 1


def test_uses_local_upload_and_skips_duplicate_display_names(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    session_record: SessionRecord,
    material: SourceMaterialRecord,
) -> None:
    local_file = tmp_path / material.relative_path
    local_file.parent.mkdir(parents=True, exist_ok=True)
    local_file.write_text("mitochondria are the powerhouse")

    second_material = material.model_copy(
        update={
            "source_id": "src-2",
            "file_name": "extra.txt",
            "relative_path": "session-123/extra.txt",
        }
    )
    second_file = tmp_path / second_material.relative_path
    second_file.write_text("extra content")

    rag_sdk = FakeRagSdk()
    rag_sdk.list_files_response = [SimpleNamespace(display_name="src-1:lesson.txt")]
    _patch_sdk(monkeypatch, rag_sdk)
    store = FakeStore(gcs_backed=False, root_dir=tmp_path)

    result = _prepare_session_rag_corpus_sync(
        session_record,
        [material, second_material],
        store,
        existing_rag_corpus_id=None,
    )

    assert result.imported_file_count == 1
    assert result.skipped_file_count == 1
    assert rag_sdk.import_requests == []
    assert rag_sdk.uploaded_files[0]["display_name"] == "src-2:extra.txt"


def test_raises_with_corpus_id_when_retrieval_verification_fails(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    session_record: SessionRecord,
    material: SourceMaterialRecord,
) -> None:
    rag_sdk = FakeRagSdk()
    rag_sdk.retrieval_response = SimpleNamespace(contexts=SimpleNamespace(contexts=[]))
    _patch_sdk(monkeypatch, rag_sdk)
    store = FakeStore(gcs_backed=True, root_dir=tmp_path)

    with pytest.raises(VertexSessionRagPreparationError) as exc_info:
        _prepare_session_rag_corpus_sync(
            session_record,
            [material],
            store,
            existing_rag_corpus_id=None,
        )

    assert exc_info.value.rag_corpus_id == "generated-corpus"


def test_delete_corpus_ignores_missing_remote_resource(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rag_sdk = FakeRagSdk()

    def _delete_missing(*, name: str):
        raise _NotFound(name)

    rag_sdk.delete_corpus = _delete_missing
    _patch_sdk(monkeypatch, rag_sdk)

    _delete_session_rag_corpus_sync("gone-corpus")


def test_lookup_normalization_handles_iterable_contexts() -> None:
    context = SimpleNamespace(
        source_uri="src-1:lesson.txt",
        source_display_name="src-1:lesson.txt",
        text="ATP stores usable energy.",
        score=0.91,
    )
    response = SimpleNamespace(
        contexts=SimpleNamespace(contexts=(context,))
    )

    assert _count_retrieved_contexts(response) == 1

    results = _extract_lookup_results(response)

    assert len(results) == 1
    assert results[0].source_title == "src-1:lesson.txt"
    assert results[0].snippet == "ATP stores usable energy."
