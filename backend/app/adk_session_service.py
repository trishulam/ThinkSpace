"""Create the official ADK session service for ThinkSpace."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from google.adk.sessions import (
    BaseSessionService,
    DatabaseSessionService,
    InMemorySessionService,
)

logger = logging.getLogger(__name__)


def _default_sqlite_db_url() -> str:
    db_path = Path(__file__).parent / "data" / "thinkspace_adk.db"
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path}"


def create_adk_session_service() -> BaseSessionService:
    """Create the official ADK session service from environment configuration."""
    backend = os.getenv("THINKSPACE_ADK_SESSION_BACKEND", "database").lower()
    db_url = os.getenv("THINKSPACE_ADK_DATABASE_URL", "").strip()

    if backend == "memory":
        logger.info("Using in-memory ADK session service")
        return InMemorySessionService()

    if backend in {"auto", "database"}:
        resolved_db_url = db_url or _default_sqlite_db_url()
        try:
            logger.info("Using official DatabaseSessionService: %s", resolved_db_url)
            return DatabaseSessionService(db_url=resolved_db_url)
        except Exception:
            logger.exception("Falling back to in-memory ADK session service")

    logger.info("Using in-memory ADK session service")
    return InMemorySessionService()
