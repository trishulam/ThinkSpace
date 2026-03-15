"""Configuration helpers for the ThinkSpace agent."""

from __future__ import annotations

import os

DEFAULT_LIVE_MODEL = "gemini-2.5-flash-native-audio-preview-12-2025"
DEFAULT_FLASHCARD_MODEL = "gemini-3-flash-preview"
DEFAULT_KEY_MOMENT_MODEL = "gemini-3-flash-preview"
DEFAULT_NOTES_MODEL = "gemini-3-flash-preview"
DEFAULT_GROUNDING_SUMMARIZATION_MODEL = "gemini-3-flash-preview"
DEFAULT_VERTEX_RAG_LOCATION = "us-central1"
DEFAULT_VERTEX_RAG_EMBEDDING_MODEL = "publishers/google/models/text-embedding-005"
DEFAULT_VERTEX_RAG_CHUNK_SIZE = 512
DEFAULT_VERTEX_RAG_CHUNK_OVERLAP = 100
DEFAULT_VERTEX_RAG_MAX_EMBEDDING_REQUESTS_PER_MIN = 900
DEFAULT_VERTEX_RAG_VERIFICATION_TOP_K = 3
DEFAULT_SESSION_COMPACTION_MODEL = "gemini-3-flash-preview"
DEFAULT_CANVAS_INTERPRETER_MODEL = "gemini-3-flash-preview"
DEFAULT_WIDGET_REASONER_MODEL = "gemini-3-flash-preview"
DEFAULT_CANVAS_VISUAL_PLANNER_MODEL = "gemini-2.5-flash"
DEFAULT_CANVAS_VISUAL_IMAGE_QUALITY_MODEL = "gemini-3.1-flash-image-preview"
DEFAULT_CANVAS_VISUAL_IMAGE_FAST_MODEL = "gemini-2.5-flash-image"
DEFAULT_CANVAS_VISUAL_PLANNER_INCLUDE_SCREENSHOT = True


def _get_bool_env(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default


def _get_int_env(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw.strip())
    except ValueError:
        return default


def get_agent_model() -> str:
    """Return the configured live model for the ThinkSpace orchestrator.

    `THINKSPACE_AGENT_MODEL` becomes the product-specific override, while
    `DEMO_AGENT_MODEL` remains a backward-compatible fallback during the
    transition away from the demo scaffolding.
    """

    return os.getenv(
        "THINKSPACE_AGENT_MODEL",
        os.getenv("DEMO_AGENT_MODEL", DEFAULT_LIVE_MODEL),
    )


def get_flashcard_generation_model() -> str:
    """Return the model used by the flashcard generation worker."""

    return os.getenv("THINKSPACE_FLASHCARD_MODEL", DEFAULT_FLASHCARD_MODEL)


def get_key_moment_generation_model() -> str:
    """Return the model used by the session key moment generator."""

    return os.getenv("THINKSPACE_KEY_MOMENT_MODEL", DEFAULT_KEY_MOMENT_MODEL)


def get_notes_generation_model() -> str:
    """Return the model used by the session notes generator."""

    return os.getenv("THINKSPACE_NOTES_MODEL", DEFAULT_NOTES_MODEL)


def get_grounding_summarization_model() -> str:
    """Return the model used by the grounding summarization pipeline."""

    return os.getenv(
        "THINKSPACE_GROUNDING_SUMMARIZATION_MODEL",
        DEFAULT_GROUNDING_SUMMARIZATION_MODEL,
    )


def get_vertex_rag_location() -> str:
    """Return the configured Vertex AI RAG region."""

    return os.getenv("THINKSPACE_VERTEX_RAG_LOCATION", DEFAULT_VERTEX_RAG_LOCATION)


def get_vertex_rag_embedding_model() -> str:
    """Return the Vertex embedding model used for session corpora."""

    return os.getenv(
        "THINKSPACE_VERTEX_RAG_EMBEDDING_MODEL",
        DEFAULT_VERTEX_RAG_EMBEDDING_MODEL,
    )


def get_vertex_rag_chunk_size() -> int:
    """Return the chunk size used during RAG ingestion."""

    return _get_int_env("THINKSPACE_VERTEX_RAG_CHUNK_SIZE", DEFAULT_VERTEX_RAG_CHUNK_SIZE)


def get_vertex_rag_chunk_overlap() -> int:
    """Return the chunk overlap used during RAG ingestion."""

    return _get_int_env(
        "THINKSPACE_VERTEX_RAG_CHUNK_OVERLAP",
        DEFAULT_VERTEX_RAG_CHUNK_OVERLAP,
    )


def get_vertex_rag_max_embedding_requests_per_min() -> int:
    """Return the per-minute embedding request cap for RAG ingestion."""

    return _get_int_env(
        "THINKSPACE_VERTEX_RAG_MAX_EMBEDDING_REQUESTS_PER_MIN",
        DEFAULT_VERTEX_RAG_MAX_EMBEDDING_REQUESTS_PER_MIN,
    )


def get_vertex_rag_verification_top_k() -> int:
    """Return the top-k used by the RAG smoke retrieval query."""

    return _get_int_env(
        "THINKSPACE_VERTEX_RAG_VERIFICATION_TOP_K",
        DEFAULT_VERTEX_RAG_VERIFICATION_TOP_K,
    )


def get_session_compaction_model() -> str:
    """Return the model used to maintain the rolling session summary."""

    return os.getenv(
        "THINKSPACE_SESSION_COMPACTION_MODEL",
        DEFAULT_SESSION_COMPACTION_MODEL,
    )


def get_canvas_interpreter_model() -> str:
    """Return the model used by the canvas interpreter reasoning step."""

    return os.getenv(
        "THINKSPACE_CANVAS_INTERPRETER_MODEL",
        DEFAULT_CANVAS_INTERPRETER_MODEL,
    )


def get_widget_reasoner_model() -> str:
    """Return the model used by the widget reasoner playground service."""

    return os.getenv(
        "THINKSPACE_WIDGET_REASONER_MODEL",
        DEFAULT_WIDGET_REASONER_MODEL,
    )


def get_canvas_visual_planner_model() -> str:
    """Return the model used to plan static canvas visuals."""

    return os.getenv(
        "THINKSPACE_CANVAS_VISUAL_PLANNER_MODEL",
        DEFAULT_CANVAS_VISUAL_PLANNER_MODEL,
    )


def get_canvas_visual_image_model() -> str:
    """Return the image model used to render static canvas visuals."""

    return os.getenv(
        "THINKSPACE_CANVAS_VISUAL_IMAGE_MODEL",
        DEFAULT_CANVAS_VISUAL_IMAGE_QUALITY_MODEL,
    )


def get_canvas_visual_image_model_for_mode(generation_mode: str) -> str:
    """Return the image model used for the requested visual generation mode."""

    normalized_mode = generation_mode.strip().lower()
    if normalized_mode == "fast":
        return os.getenv(
            "THINKSPACE_CANVAS_VISUAL_IMAGE_FAST_MODEL",
            DEFAULT_CANVAS_VISUAL_IMAGE_FAST_MODEL,
        )
    return os.getenv(
        "THINKSPACE_CANVAS_VISUAL_IMAGE_QUALITY_MODEL",
        os.getenv(
            "THINKSPACE_CANVAS_VISUAL_IMAGE_MODEL",
            DEFAULT_CANVAS_VISUAL_IMAGE_QUALITY_MODEL,
        ),
    )


def get_canvas_visual_planner_include_screenshot() -> bool:
    """Return whether planner requests should include a viewport screenshot."""

    return _get_bool_env(
        "THINKSPACE_CANVAS_VISUAL_PLANNER_INCLUDE_SCREENSHOT",
        DEFAULT_CANVAS_VISUAL_PLANNER_INCLUDE_SCREENSHOT,
    )
