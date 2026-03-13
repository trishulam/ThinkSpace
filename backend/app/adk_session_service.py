"""Create the official ADK session service for ThinkSpace."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from urllib.parse import quote_plus

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


def _cloud_sql_postgres_db_url() -> str | None:
    instance_connection_name = os.getenv(
        "THINKSPACE_ADK_DATABASE_INSTANCE_CONNECTION_NAME", ""
    ).strip()
    database_name = os.getenv("THINKSPACE_ADK_DATABASE_NAME", "").strip()
    database_user = os.getenv("THINKSPACE_ADK_DATABASE_USER", "").strip()
    database_password = os.getenv("THINKSPACE_ADK_DATABASE_PASSWORD", "").strip()
    socket_dir = os.getenv("THINKSPACE_ADK_DATABASE_SOCKET_DIR", "/cloudsql").rstrip(
        "/"
    )

    if not all(
        [
            instance_connection_name,
            database_name,
            database_user,
            database_password,
        ]
    ):
        return None

    socket_path = f"{socket_dir}/{instance_connection_name}/.s.PGSQL.5432"
    encoded_socket_path = quote_plus(socket_path)
    encoded_database_name = quote_plus(database_name)
    encoded_database_user = quote_plus(database_user)
    encoded_database_password = quote_plus(database_password)
    return (
        "postgresql+pg8000://"
        f"{encoded_database_user}:{encoded_database_password}"
        f"@/{encoded_database_name}?unix_sock={encoded_socket_path}"
    )


def create_adk_session_service() -> BaseSessionService:
    """Create the official ADK session service from environment configuration."""
    backend = os.getenv("THINKSPACE_ADK_SESSION_BACKEND", "database").lower()
    db_url = os.getenv("THINKSPACE_ADK_DATABASE_URL", "").strip()

    if backend == "memory":
        logger.info("Using in-memory ADK session service")
        return InMemorySessionService()

    if backend in {"auto", "database"}:
        resolved_db_url = db_url or _cloud_sql_postgres_db_url() or _default_sqlite_db_url()
        try:
            logger.info("Using official DatabaseSessionService: %s", resolved_db_url)
            return DatabaseSessionService(db_url=resolved_db_url)
        except Exception:
            logger.exception("Falling back to in-memory ADK session service")

    logger.info("Using in-memory ADK session service")
    return InMemorySessionService()
