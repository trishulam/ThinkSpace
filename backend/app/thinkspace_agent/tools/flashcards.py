"""Flashcard tools for the ThinkSpace agent."""

from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from google.adk.tools import FunctionTool, LongRunningFunctionTool
from google.adk.tools import ToolContext

from .flashcard_jobs import (
    choose_flashcard_count,
    flashcard_session_store,
    generate_flashcard_deck,
    publish_flashcard_job_result,
)

logger = logging.getLogger(__name__)

FLASHCARDS_CREATE_TOOL = "flashcards.create"
FLASHCARDS_NEXT_TOOL = "flashcards.next"
FLASHCARDS_REVEAL_ANSWER_TOOL = "flashcards.reveal_answer"
FLASHCARDS_END_TOOL = "flashcards.end"
FLASHCARDS_BEGIN_ACTION = "flashcards.begin"
FLASHCARDS_SHOW_ACTION = "flashcards.show"
FLASHCARDS_CLEAR_ACTION = "flashcards.clear"


def _build_frontend_action(
    action_type: str,
    source_tool: str,
    payload: object,
    *,
    job_id: str | None = None,
) -> dict[str, object]:
    action: dict[str, object] = {
        "type": action_type,
        "source_tool": source_tool,
        "payload": payload,
    }
    if job_id:
        action["job_id"] = job_id
    return action


def _build_tool_result(
    *,
    status: str,
    tool: str,
    summary: str,
    payload: object | None = None,
    frontend_action: dict[str, object] | None = None,
    job_id: str | None = None,
) -> dict[str, object]:
    result: dict[str, object] = {
        "status": status,
        "tool": tool,
        "summary": summary,
    }
    if payload is not None:
        result["payload"] = payload
    if frontend_action is not None:
        result["frontend_action"] = frontend_action
    if job_id is not None:
        result["job"] = {"id": job_id}
    return result


def _get_session_identity(
    tool_context: ToolContext | None,
) -> tuple[str | None, str | None]:
    session = tool_context.session if tool_context else None
    user_id = tool_context.user_id if tool_context else None
    session_id = session.id if session else None
    return user_id, session_id


def _get_flashcard_state_payload(
    *, user_id: str, session_id: str
) -> dict[str, object] | None:
    return flashcard_session_store.snapshot(user_id=user_id, session_id=session_id)


def _get_flashcard_session_state(
    *, user_id: str, session_id: str
):
    return flashcard_session_store.get(user_id=user_id, session_id=session_id)


def _build_flashcard_control_payload(
    payload: dict[str, object] | None,
) -> dict[str, object] | None:
    if not isinstance(payload, dict):
        return None

    control_payload: dict[str, object] = {}

    current_index = payload.get("current_index")
    if isinstance(current_index, int):
        control_payload["current_index"] = current_index

    total_cards = payload.get("total_cards")
    if isinstance(total_cards, int):
        control_payload["total_cards"] = total_cards

    is_answer_revealed = payload.get("is_answer_revealed")
    if isinstance(is_answer_revealed, bool):
        control_payload["is_answer_revealed"] = is_answer_revealed

    return control_payload or None


def _build_flashcard_grounding_base(
    payload: dict[str, object] | None,
) -> dict[str, object] | None:
    if not isinstance(payload, dict):
        return None

    grounding_base: dict[str, object] = {}

    topic = payload.get("topic")
    if isinstance(topic, str) and topic.strip():
        grounding_base["topic"] = topic.strip()

    title = payload.get("title")
    if isinstance(title, str) and title.strip():
        grounding_base["title"] = title.strip()

    total_cards = payload.get("total_cards")
    if isinstance(total_cards, int):
        grounding_base["total_cards"] = total_cards

    ui_state = payload.get("ui")
    if isinstance(ui_state, dict):
        normalized_ui_state: dict[str, object] = {}
        deck_visible = ui_state.get("deck_visible")
        if isinstance(deck_visible, bool):
            normalized_ui_state["deck_visible"] = deck_visible
        answer_visible = ui_state.get("answer_visible")
        if isinstance(answer_visible, bool):
            normalized_ui_state["answer_visible"] = answer_visible
        visible_index = ui_state.get("visible_index")
        if isinstance(visible_index, int):
            normalized_ui_state["visible_index"] = visible_index
        if normalized_ui_state:
            grounding_base["ui"] = normalized_ui_state

    return grounding_base or None


def _build_flashcards_next_grounding_payload(
    payload: dict[str, object] | None,
) -> dict[str, object] | None:
    grounding_payload = _build_flashcard_grounding_base(payload)
    if grounding_payload is None or not isinstance(payload, dict):
        return grounding_payload

    current_card = payload.get("current_card")
    if isinstance(current_card, dict):
        current_answer = current_card.get("back")
        current_position = current_card.get("position")
        current_index = current_card.get("index")
        is_answer_revealed = current_card.get("is_answer_revealed")

        normalized_current_card: dict[str, object] = {}
        if isinstance(current_answer, str) and current_answer.strip():
            normalized_current_card["answer"] = current_answer.strip()
        if isinstance(current_position, int):
            normalized_current_card["position"] = current_position
        if isinstance(current_index, int):
            normalized_current_card["index"] = current_index
        if isinstance(is_answer_revealed, bool):
            normalized_current_card["is_answer_revealed"] = is_answer_revealed
        if normalized_current_card:
            grounding_payload["current_card"] = normalized_current_card

    next_card = payload.get("next_card")
    if isinstance(next_card, dict):
        next_question = next_card.get("front")
        next_position = next_card.get("position")
        next_index = next_card.get("index")

        normalized_next_card: dict[str, object] = {}
        if isinstance(next_question, str) and next_question.strip():
            normalized_next_card["question"] = next_question.strip()
        if isinstance(next_position, int):
            normalized_next_card["position"] = next_position
        if isinstance(next_index, int):
            normalized_next_card["index"] = next_index
        if normalized_next_card:
            grounding_payload["next_card"] = normalized_next_card

    return grounding_payload or None


async def _run_flashcard_generation_job(
    *,
    user_id: str,
    session_id: str,
    job_id: str,
    topic: str,
    target_card_count: int,
) -> None:
    try:
        deck_payload = await generate_flashcard_deck(topic, target_card_count)
        active_payload = flashcard_session_store.set_active_deck(
            user_id=user_id,
            session_id=session_id,
            topic=topic,
            deck_payload=deck_payload,
        )
        result = _build_tool_result(
            status="completed",
            tool=FLASHCARDS_CREATE_TOOL,
            summary=(
                "Flashcards created. Wait for the UI confirmation before referring "
                "to any card content."
            ),
            payload=_build_flashcard_grounding_base(active_payload),
            frontend_action=_build_frontend_action(
                FLASHCARDS_SHOW_ACTION,
                FLASHCARDS_CREATE_TOOL,
                payload=active_payload,
                job_id=job_id,
            ),
            job_id=job_id,
        )
    except Exception as exc:  # pragma: no cover - defensive async boundary
        logger.exception(
            "Flashcard generation failed: user_id=%s session_id=%s job_id=%s",
            user_id,
            session_id,
            job_id,
        )
        result = _build_tool_result(
            status="failed",
            tool=FLASHCARDS_CREATE_TOOL,
            summary=f"Flashcard generation failed: {exc}",
            frontend_action=_build_frontend_action(
                FLASHCARDS_CLEAR_ACTION,
                FLASHCARDS_CREATE_TOOL,
                payload={},
                job_id=job_id,
            ),
            job_id=job_id,
        )

    await publish_flashcard_job_result(
        user_id=user_id,
        session_id=session_id,
        result=result,
    )


def flashcards_create(
    topic: str,
    target_card_count: int = 0,
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Create a flashcard deck for a topic.

    This is a long-running tool. It accepts the request, allocates a job
    identifier, immediately transitions the frontend into the creating state,
    and completes through a background generator job.
    """

    normalized_topic = topic.strip() or "current study topic"
    normalized_card_count = (
        choose_flashcard_count(normalized_topic)
        if target_card_count <= 0
        else max(1, min(10, target_card_count))
    )
    job_id = f"flashcards-{uuid4()}"
    user_id, session_id = _get_session_identity(tool_context)

    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            tool=FLASHCARDS_CREATE_TOOL,
            summary="Flashcard generation requires an active session context",
            frontend_action=_build_frontend_action(
                FLASHCARDS_CLEAR_ACTION,
                FLASHCARDS_CREATE_TOOL,
                payload={},
                job_id=job_id,
            ),
            job_id=job_id,
        )

    asyncio.get_running_loop().create_task(
        _run_flashcard_generation_job(
            user_id=user_id,
            session_id=session_id,
            job_id=job_id,
            topic=normalized_topic,
            target_card_count=normalized_card_count,
        ),
        name=f"flashcards-create-{job_id}",
    )

    payload = {
        "topic": normalized_topic,
        "target_card_count": normalized_card_count,
        "target_card_count_source": (
            "auto" if target_card_count <= 0 else "explicit"
        ),
    }
    return _build_tool_result(
        status="accepted",
        tool=FLASHCARDS_CREATE_TOOL,
        summary=(
            f"Starting flashcard generation for {normalized_topic} "
            f"with {normalized_card_count} cards. Do not ask any flashcard "
            "question until the deck is created and the UI confirms it is visible."
        ),
        payload=payload,
        frontend_action=_build_frontend_action(
            FLASHCARDS_BEGIN_ACTION,
            FLASHCARDS_CREATE_TOOL,
            payload={},
            job_id=job_id,
        ),
        job_id=job_id,
    )


def flashcards_next(tool_context: ToolContext | None = None) -> dict[str, object]:
    """Advance the active flashcard session to the next card."""

    user_id, session_id = _get_session_identity(tool_context)
    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            tool=FLASHCARDS_NEXT_TOOL,
            summary="Cannot move to the next flashcard without an active session",
        )

    current_payload = _get_flashcard_state_payload(user_id=user_id, session_id=session_id)
    if current_payload is None:
        return _build_tool_result(
            status="failed",
            tool=FLASHCARDS_NEXT_TOOL,
            summary="There is no active flashcard deck to advance",
        )

    current_card = current_payload.get("current_card")
    if not isinstance(current_card, dict):
        return _build_tool_result(
            status="failed",
            tool=FLASHCARDS_NEXT_TOOL,
            summary="The active flashcard deck is missing current card context",
            payload=_build_flashcards_next_grounding_payload(current_payload),
        )

    current_index = current_payload.get("current_index")
    total_cards = current_payload.get("total_cards")
    if not isinstance(current_index, int) or not isinstance(total_cards, int):
        return _build_tool_result(
            status="failed",
            tool=FLASHCARDS_NEXT_TOOL,
            summary="The active flashcard deck state is incomplete",
            payload=_build_flashcards_next_grounding_payload(current_payload),
        )

    ui_state = current_payload.get("ui")
    visible_index = (
        ui_state.get("visible_index")
        if isinstance(ui_state, dict) and isinstance(ui_state.get("visible_index"), int)
        else None
    )
    if visible_index is not None and visible_index < current_index:
        return _build_tool_result(
            status="completed",
            tool=FLASHCARDS_NEXT_TOOL,
            summary=(
                "The next flashcard is already being shown. Wait until it is visible "
                "in the UI before calling `flashcards.next` again."
            ),
            payload=_build_flashcards_next_grounding_payload(current_payload),
        )

    if current_index >= total_cards - 1:
        return _build_tool_result(
            status="completed",
            tool=FLASHCARDS_NEXT_TOOL,
            summary="Already at the final flashcard",
            payload=_build_flashcards_next_grounding_payload(current_payload),
        )

    next_payload = flashcard_session_store.advance(
        user_id=user_id,
        session_id=session_id,
    )
    control_payload = _build_flashcard_control_payload(next_payload)

    return _build_tool_result(
        status="completed",
        tool=FLASHCARDS_NEXT_TOOL,
        summary=(
            "Requested the next flashcard. Wait until the UI confirms the next card "
            "is visible before asking it."
        ),
        payload=_build_flashcards_next_grounding_payload(next_payload),
        frontend_action=_build_frontend_action(
            FLASHCARDS_NEXT_TOOL,
            FLASHCARDS_NEXT_TOOL,
            payload=control_payload or {},
        ),
    )


def flashcards_reveal_answer(
    tool_context: ToolContext | None = None,
) -> dict[str, object]:
    """Reveal the answer for the current flashcard."""

    user_id, session_id = _get_session_identity(tool_context)
    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            tool=FLASHCARDS_REVEAL_ANSWER_TOOL,
            summary="Cannot reveal a flashcard answer without an active session",
        )

    current_payload = _get_flashcard_state_payload(user_id=user_id, session_id=session_id)
    if current_payload is None:
        return _build_tool_result(
            status="failed",
            tool=FLASHCARDS_REVEAL_ANSWER_TOOL,
            summary="There is no active flashcard deck to reveal",
        )

    if current_payload.get("is_answer_revealed") is True:
        session_state = _get_flashcard_session_state(
            user_id=user_id,
            session_id=session_id,
        )
        if session_state is not None and not session_state.is_answer_visible_in_ui:
            return _build_tool_result(
                status="completed",
                tool=FLASHCARDS_REVEAL_ANSWER_TOOL,
                summary=(
                    "The current flashcard answer is already being revealed. "
                    "Wait until it is visible in the UI."
                ),
            )
        return _build_tool_result(
            status="completed",
            tool=FLASHCARDS_REVEAL_ANSWER_TOOL,
            summary="The current flashcard answer is already revealed",
        )

    revealed_payload = flashcard_session_store.reveal(
        user_id=user_id,
        session_id=session_id,
    )
    control_payload = _build_flashcard_control_payload(revealed_payload)

    return _build_tool_result(
        status="completed",
        tool=FLASHCARDS_REVEAL_ANSWER_TOOL,
        summary=(
            "Requested answer reveal. Wait until the UI confirms the answer is "
            "visible before explaining it."
        ),
        frontend_action=_build_frontend_action(
            FLASHCARDS_REVEAL_ANSWER_TOOL,
            FLASHCARDS_REVEAL_ANSWER_TOOL,
            payload=control_payload or {},
        ),
    )


def flashcards_end(tool_context: ToolContext | None = None) -> dict[str, object]:
    """End the active flashcard session."""

    user_id, session_id = _get_session_identity(tool_context)
    if not user_id or not session_id:
        return _build_tool_result(
            status="failed",
            tool=FLASHCARDS_END_TOOL,
            summary="Cannot end flashcards without an active session",
        )

    current_payload = _get_flashcard_state_payload(user_id=user_id, session_id=session_id)
    if current_payload is None:
        return _build_tool_result(
            status="completed",
            tool=FLASHCARDS_END_TOOL,
            summary="There is no active flashcard session to clear",
        )

    flashcard_session_store.clear(user_id=user_id, session_id=session_id)

    return _build_tool_result(
        status="completed",
        tool=FLASHCARDS_END_TOOL,
        summary="Cleared the active flashcard session",
        payload=_build_flashcard_grounding_base(current_payload),
        frontend_action=_build_frontend_action(
            FLASHCARDS_CLEAR_ACTION,
            FLASHCARDS_END_TOOL,
            payload={},
        ),
    )


def get_flashcard_tools() -> list[FunctionTool | LongRunningFunctionTool]:
    """Return the flashcard tools registered for ThinkSpace."""

    return [
        LongRunningFunctionTool(flashcards_create),
        FunctionTool(flashcards_next),
        FunctionTool(flashcards_reveal_answer),
        FunctionTool(flashcards_end),
    ]
