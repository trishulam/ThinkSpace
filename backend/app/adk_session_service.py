"""Persistent ADK session service backed by Firestore."""

from __future__ import annotations

import copy
import logging
import os
import time
from typing import Any
from uuid import uuid4

from google.adk.events import Event
from google.adk.sessions import BaseSessionService, InMemorySessionService, Session, State
from google.adk.sessions import _session_util
from google.adk.sessions.base_session_service import GetSessionConfig, ListSessionsResponse
from google.cloud import firestore

logger = logging.getLogger(__name__)


class FirestoreSessionService(BaseSessionService):
    """A minimal Firestore-backed ADK session service."""

    def __init__(
        self,
        project: str | None = None,
        prefix: str = "thinkspace",
        database: str | None = None,
    ):
        self._db = firestore.Client(project=project, database=database)
        self._sessions = self._db.collection(f"{prefix}_adk_sessions")
        self._app_state = self._db.collection(f"{prefix}_adk_app_state")
        self._user_state = self._db.collection(f"{prefix}_adk_user_state")

    def _session_doc_id(self, app_name: str, user_id: str, session_id: str) -> str:
        return f"{app_name}__{user_id}__{session_id}"

    def _user_state_doc_id(self, app_name: str, user_id: str) -> str:
        return f"{app_name}__{user_id}"

    def _serialize_event(self, event: Event) -> dict[str, Any]:
        return event.model_dump(mode="json", by_alias=False)

    def _deserialize_event(self, payload: dict[str, Any]) -> Event:
        return Event.model_validate(payload)

    def _serialize_session(self, session: Session) -> dict[str, Any]:
        return {
            "id": session.id,
            "app_name": session.app_name,
            "user_id": session.user_id,
            "state": session.state,
            "events": [self._serialize_event(event) for event in session.events],
            "last_update_time": session.last_update_time,
        }

    def _deserialize_session(self, payload: dict[str, Any]) -> Session:
        return Session(
            id=payload["id"],
            app_name=payload["app_name"],
            user_id=payload["user_id"],
            state=payload.get("state", {}),
            events=[
                self._deserialize_event(event_payload)
                for event_payload in payload.get("events", [])
            ],
            last_update_time=payload.get("last_update_time", 0.0),
        )

    def _get_app_state(self, app_name: str) -> dict[str, Any]:
        snapshot = self._app_state.document(app_name).get()
        payload = snapshot.to_dict() if snapshot.exists else None
        return payload.get("state", {}) if payload else {}

    def _get_user_state(self, app_name: str, user_id: str) -> dict[str, Any]:
        snapshot = self._user_state.document(self._user_state_doc_id(app_name, user_id)).get()
        payload = snapshot.to_dict() if snapshot.exists else None
        return payload.get("state", {}) if payload else {}

    def _merge_state(self, session: Session) -> Session:
        copied_session = copy.deepcopy(session)
        for key, value in self._get_app_state(session.app_name).items():
            copied_session.state[State.APP_PREFIX + key] = value
        for key, value in self._get_user_state(session.app_name, session.user_id).items():
            copied_session.state[State.USER_PREFIX + key] = value
        return copied_session

    def _filter_session_events(
        self, session: Session, config: GetSessionConfig | None
    ) -> Session:
        copied_session = copy.deepcopy(session)
        if not config:
            return copied_session

        if config.num_recent_events:
            copied_session.events = copied_session.events[-config.num_recent_events :]
        if config.after_timestamp:
            copied_session.events = [
                event
                for event in copied_session.events
                if event.timestamp >= config.after_timestamp
            ]
        return copied_session

    async def create_session(
        self,
        *,
        app_name: str,
        user_id: str,
        state: dict[str, Any] | None = None,
        session_id: str | None = None,
    ) -> Session:
        if session_id:
            existing = await self.get_session(
                app_name=app_name,
                user_id=user_id,
                session_id=session_id,
            )
            if existing:
                raise ValueError(f"Session with id {session_id} already exists")

        state_deltas = _session_util.extract_state_delta(state)
        app_state_delta = state_deltas["app"]
        user_state_delta = state_deltas["user"]
        session_state = state_deltas["session"]

        if app_state_delta:
            self._app_state.document(app_name).set({"state": app_state_delta}, merge=True)
        if user_state_delta:
            self._user_state.document(self._user_state_doc_id(app_name, user_id)).set(
                {"app_name": app_name, "user_id": user_id, "state": user_state_delta},
                merge=True,
            )

        resolved_session_id = (
            session_id.strip()
            if session_id and session_id.strip()
            else str(uuid4())
        )
        session = Session(
            app_name=app_name,
            user_id=user_id,
            id=resolved_session_id,
            state=session_state or {},
            last_update_time=time.time(),
        )
        self._sessions.document(
            self._session_doc_id(app_name, user_id, resolved_session_id)
        ).set(self._serialize_session(session))
        return self._merge_state(session)

    async def get_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        config: GetSessionConfig | None = None,
    ) -> Session | None:
        snapshot = self._sessions.document(
            self._session_doc_id(app_name, user_id, session_id)
        ).get()
        if not snapshot.exists:
            return None

        session = self._deserialize_session(snapshot.to_dict() or {})
        return self._merge_state(self._filter_session_events(session, config))

    async def list_sessions(
        self, *, app_name: str, user_id: str | None = None
    ) -> ListSessionsResponse:
        query = self._sessions.where("app_name", "==", app_name)
        if user_id:
            query = query.where("user_id", "==", user_id)

        sessions = []
        for snapshot in query.stream():
            payload = snapshot.to_dict() or {}
            sessions.append(
                Session(
                    id=payload["id"],
                    app_name=payload["app_name"],
                    user_id=payload["user_id"],
                    state={},
                    events=[],
                    last_update_time=payload.get("last_update_time", 0.0),
                )
            )

        sessions.sort(key=lambda session: session.last_update_time, reverse=True)
        return ListSessionsResponse(sessions=sessions)

    async def delete_session(
        self, *, app_name: str, user_id: str, session_id: str
    ) -> None:
        self._sessions.document(self._session_doc_id(app_name, user_id, session_id)).delete()

    async def append_event(self, session: Session, event: Event) -> Event:
        if event.partial:
            return event

        await super().append_event(session=session, event=event)
        session.last_update_time = event.timestamp

        snapshot = self._sessions.document(
            self._session_doc_id(session.app_name, session.user_id, session.id)
        ).get()
        if not snapshot.exists:
            logger.warning("Failed to append event to missing session %s", session.id)
            return event

        stored_session = self._deserialize_session(snapshot.to_dict() or {})
        stored_session.events.append(event)
        stored_session.last_update_time = event.timestamp

        if event.actions and event.actions.state_delta:
            state_deltas = _session_util.extract_state_delta(event.actions.state_delta)
            app_state_delta = state_deltas["app"]
            user_state_delta = state_deltas["user"]
            session_state_delta = state_deltas["session"]

            if app_state_delta:
                self._app_state.document(session.app_name).set(
                    {"state": app_state_delta}, merge=True
                )
            if user_state_delta:
                self._user_state.document(
                    self._user_state_doc_id(session.app_name, session.user_id)
                ).set(
                    {
                        "app_name": session.app_name,
                        "user_id": session.user_id,
                        "state": user_state_delta,
                    },
                    merge=True,
                )
            if session_state_delta:
                stored_session.state.update(session_state_delta)

        self._sessions.document(
            self._session_doc_id(session.app_name, session.user_id, session.id)
        ).set(self._serialize_session(stored_session))
        return event


def create_adk_session_service() -> BaseSessionService:
    """Create the ADK session service from environment configuration."""
    backend = os.getenv("THINKSPACE_ADK_SESSION_BACKEND", "auto").lower()
    project = os.getenv("GOOGLE_CLOUD_PROJECT")
    prefix = os.getenv("THINKSPACE_FIRESTORE_COLLECTION_PREFIX", "thinkspace")
    database = os.getenv("THINKSPACE_FIRESTORE_DATABASE_ID")

    if backend == "memory":
        logger.info("Using in-memory ADK session service")
        return InMemorySessionService()

    if backend in {"auto", "firestore"} and project:
        try:
            logger.info("Using Firestore ADK session service")
            return FirestoreSessionService(
                project=project,
                prefix=prefix,
                database=database,
            )
        except Exception:
            logger.exception("Falling back to in-memory ADK session service")

    logger.info("Using in-memory ADK session service")
    return InMemorySessionService()
