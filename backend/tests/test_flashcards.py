from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

# pylint: disable=import-error,wrong-import-position
sys.path.append(str(Path(__file__).resolve().parents[1] / "app"))

from thinkspace_agent.tools.flashcard_jobs import (  # noqa: E402
    flashcard_job_outbox,
    flashcard_session_store,
)
from thinkspace_agent.tools.flashcards import (  # noqa: E402
    FLASHCARDS_BEGIN_ACTION,
    FLASHCARDS_CLEAR_ACTION,
    FLASHCARDS_CREATE_TOOL,
    FLASHCARDS_NEXT_TOOL,
    FLASHCARDS_REVEAL_ANSWER_TOOL,
    flashcards_create,
    flashcards_end,
    flashcards_next,
    flashcards_reveal_answer,
)


def _tool_context(session_id: str = "session-1", user_id: str = "user-1"):
    return SimpleNamespace(
        user_id=user_id,
        session=SimpleNamespace(id=session_id),
    )


def test_flashcards_create_queues_begin_frontend_action_via_outbox(monkeypatch) -> None:
    async def run() -> None:
        context = _tool_context()
        queue = await flashcard_job_outbox.subscribe(context.user_id, context.session.id)

        async def _noop_generation_job(**_: object) -> None:
            await asyncio.sleep(0)

        monkeypatch.setattr(
            "thinkspace_agent.tools.flashcards._run_flashcard_generation_job",
            _noop_generation_job,
        )

        try:
            result = flashcards_create("water cycle", tool_context=context)
            await asyncio.sleep(0)

            queued_result = queue.get_nowait()

            assert result["status"] == "accepted"
            assert result["tool"] == FLASHCARDS_CREATE_TOOL
            assert "frontend_action" not in result

            assert queued_result["status"] == "accepted"
            assert queued_result["tool"] == FLASHCARDS_CREATE_TOOL
            assert queued_result["frontend_action"]["type"] == FLASHCARDS_BEGIN_ACTION
            assert queued_result["frontend_action"]["source_tool"] == FLASHCARDS_CREATE_TOOL
        finally:
            await flashcard_job_outbox.unsubscribe(
                context.user_id,
                context.session.id,
                queue,
            )
            flashcard_session_store.clear(
                user_id=context.user_id,
                session_id=context.session.id,
            )

    asyncio.run(run())


def test_flashcard_control_tools_queue_frontend_actions_via_outbox() -> None:
    async def run() -> None:
        context = _tool_context()
        queue = await flashcard_job_outbox.subscribe(context.user_id, context.session.id)
        flashcard_session_store.set_active_deck(
            user_id=context.user_id,
            session_id=context.session.id,
            topic="water cycle",
            deck_payload={
                "id": "deck-1",
                "title": "Water Cycle",
                "cards": [
                    {
                        "id": "card-1",
                        "front": "What is evaporation?",
                        "back": "Liquid water becomes vapor.",
                    },
                    {
                        "id": "card-2",
                        "front": "What is condensation?",
                        "back": "Water vapor cools into droplets.",
                    },
                ],
            },
        )

        try:
            next_result = flashcards_next(tool_context=context)
            await asyncio.sleep(0)
            queued_next = queue.get_nowait()

            assert next_result["tool"] == FLASHCARDS_NEXT_TOOL
            assert "frontend_action" not in next_result
            assert queued_next["frontend_action"]["type"] == FLASHCARDS_NEXT_TOOL
            assert queued_next["frontend_action"]["payload"]["current_index"] == 1

            reveal_result = flashcards_reveal_answer(tool_context=context)
            await asyncio.sleep(0)
            queued_reveal = queue.get_nowait()

            assert reveal_result["tool"] == FLASHCARDS_REVEAL_ANSWER_TOOL
            assert "frontend_action" not in reveal_result
            assert queued_reveal["frontend_action"]["type"] == FLASHCARDS_REVEAL_ANSWER_TOOL
            assert (
                queued_reveal["frontend_action"]["payload"]["is_answer_revealed"] is True
            )

            end_result = flashcards_end(tool_context=context)
            await asyncio.sleep(0)
            queued_end = queue.get_nowait()

            assert end_result["tool"] == "flashcards.end"
            assert "frontend_action" not in end_result
            assert queued_end["frontend_action"]["type"] == FLASHCARDS_CLEAR_ACTION
            assert queued_end["frontend_action"]["source_tool"] == "flashcards.end"
        finally:
            await flashcard_job_outbox.unsubscribe(
                context.user_id,
                context.session.id,
                queue,
            )
            flashcard_session_store.clear(
                user_id=context.user_id,
                session_id=context.session.id,
            )

    asyncio.run(run())
