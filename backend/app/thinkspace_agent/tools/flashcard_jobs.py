"""Async flashcard generation runtime for ThinkSpace."""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from uuid import uuid4

from google.genai import Client
from google.genai import types as genai_types
from pydantic import BaseModel, Field

from thinkspace_agent.config import get_flashcard_generation_model

logger = logging.getLogger(__name__)


class FlashcardCard(BaseModel):
    """Single flashcard item returned by the generator."""

    id: str | None = None
    front: str
    back: str


class FlashcardDeck(BaseModel):
    """Structured flashcard deck returned by the generator."""

    id: str | None = None
    title: str | None = None
    cards: list[FlashcardCard] = Field(min_length=1)


@dataclass
class ActiveFlashcardSession:
    """Backend-owned flashcard session state for a single websocket session."""

    topic: str
    deck: dict[str, object]
    current_index: int = 0
    is_answer_revealed: bool = False
    is_deck_visible_in_ui: bool = False
    visible_index_in_ui: int | None = None
    is_answer_visible_in_ui: bool = False


@dataclass
class _SessionOutbox:
    subscribers: set[asyncio.Queue[dict[str, object]]] = field(default_factory=set)
    pending_results: list[dict[str, object]] = field(default_factory=list)


class FlashcardJobOutbox:
    """Per-session async tool-result outbox for background flashcard jobs."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._sessions: dict[tuple[str, str], _SessionOutbox] = {}

    async def subscribe(
        self, user_id: str, session_id: str
    ) -> asyncio.Queue[dict[str, object]]:
        """Create a result queue for an active websocket session."""

        queue: asyncio.Queue[dict[str, object]] = asyncio.Queue()
        key = (user_id, session_id)

        async with self._lock:
            outbox = self._sessions.setdefault(key, _SessionOutbox())
            outbox.subscribers.add(queue)
            pending_results = list(outbox.pending_results)
            outbox.pending_results.clear()

        for result in pending_results:
            queue.put_nowait(result)

        return queue

    async def unsubscribe(
        self, user_id: str, session_id: str, queue: asyncio.Queue[dict[str, object]]
    ) -> None:
        """Remove a websocket session queue from the outbox."""

        key = (user_id, session_id)
        async with self._lock:
            outbox = self._sessions.get(key)
            if outbox is None:
                return
            outbox.subscribers.discard(queue)
            if not outbox.subscribers and not outbox.pending_results:
                self._sessions.pop(key, None)

    async def publish_result(
        self, user_id: str, session_id: str, result: dict[str, object]
    ) -> None:
        """Fan out a completed async result to active subscribers or backlog it."""

        key = (user_id, session_id)
        async with self._lock:
            outbox = self._sessions.setdefault(key, _SessionOutbox())
            subscribers = list(outbox.subscribers)
            if not subscribers:
                outbox.pending_results.append(result)
                return

        for queue in subscribers:
            queue.put_nowait(result)


flashcard_job_outbox = FlashcardJobOutbox()


class FlashcardSessionStore:
    """In-memory backend source of truth for active flashcard sessions."""

    def __init__(self) -> None:
        self._sessions: dict[tuple[str, str], ActiveFlashcardSession] = {}

    def set_active_deck(
        self,
        *,
        user_id: str,
        session_id: str,
        topic: str,
        deck_payload: dict[str, object],
    ) -> dict[str, object]:
        state = ActiveFlashcardSession(
            topic=topic,
            deck=deck_payload,
            current_index=0,
            is_answer_revealed=False,
            is_deck_visible_in_ui=False,
            visible_index_in_ui=None,
            is_answer_visible_in_ui=False,
        )
        self._sessions[(user_id, session_id)] = state
        return self.snapshot(user_id=user_id, session_id=session_id)

    def get(self, *, user_id: str, session_id: str) -> ActiveFlashcardSession | None:
        return self._sessions.get((user_id, session_id))

    def clear(self, *, user_id: str, session_id: str) -> None:
        self._sessions.pop((user_id, session_id), None)

    def reveal(self, *, user_id: str, session_id: str) -> dict[str, object] | None:
        state = self.get(user_id=user_id, session_id=session_id)
        if state is None:
            return None
        state.is_answer_revealed = True
        state.is_answer_visible_in_ui = False
        return self.snapshot(user_id=user_id, session_id=session_id)

    def advance(self, *, user_id: str, session_id: str) -> dict[str, object] | None:
        state = self.get(user_id=user_id, session_id=session_id)
        if state is None:
            return None
        cards = state.deck.get("cards")
        if not isinstance(cards, list) or not cards:
            return None
        last_index = len(cards) - 1
        if state.current_index < last_index:
            state.current_index += 1
        state.is_answer_revealed = False
        state.is_answer_visible_in_ui = False
        return self.snapshot(user_id=user_id, session_id=session_id)

    def mark_deck_rendered(
        self, *, user_id: str, session_id: str
    ) -> dict[str, object] | None:
        state = self.get(user_id=user_id, session_id=session_id)
        if state is None:
            return None
        state.is_deck_visible_in_ui = True
        state.visible_index_in_ui = state.current_index
        state.is_answer_visible_in_ui = False
        return self.snapshot(user_id=user_id, session_id=session_id)

    def mark_answer_rendered(
        self, *, user_id: str, session_id: str
    ) -> dict[str, object] | None:
        state = self.get(user_id=user_id, session_id=session_id)
        if state is None:
            return None
        state.is_deck_visible_in_ui = True
        state.visible_index_in_ui = state.current_index
        state.is_answer_visible_in_ui = bool(state.is_answer_revealed)
        return self.snapshot(user_id=user_id, session_id=session_id)

    def mark_next_rendered(
        self, *, user_id: str, session_id: str
    ) -> dict[str, object] | None:
        state = self.get(user_id=user_id, session_id=session_id)
        if state is None:
            return None
        state.is_deck_visible_in_ui = True
        state.visible_index_in_ui = state.current_index
        state.is_answer_visible_in_ui = False
        return self.snapshot(user_id=user_id, session_id=session_id)

    def snapshot(self, *, user_id: str, session_id: str) -> dict[str, object] | None:
        state = self.get(user_id=user_id, session_id=session_id)
        if state is None:
            return None

        cards = state.deck.get("cards")
        title = state.deck.get("title")
        deck_id = state.deck.get("id")
        if not isinstance(cards, list) or not cards:
            return None

        safe_index = min(max(state.current_index, 0), len(cards) - 1)
        current_card_raw = cards[safe_index]
        if not isinstance(current_card_raw, dict):
            return None

        current_card = {
            "id": current_card_raw.get("id"),
            "front": current_card_raw.get("front"),
            "back": current_card_raw.get("back"),
            "index": safe_index,
            "position": safe_index + 1,
            "total_cards": len(cards),
            "is_answer_revealed": state.is_answer_revealed,
        }

        return {
            "id": deck_id,
            "title": title,
            "cards": cards,
            "current_index": safe_index,
            "is_answer_revealed": state.is_answer_revealed,
            "current_card": current_card,
            "topic": state.topic,
            "total_cards": len(cards),
            "ui": {
                "deck_visible": state.is_deck_visible_in_ui,
                "visible_index": state.visible_index_in_ui,
                "answer_visible": state.is_answer_visible_in_ui,
            },
        }


flashcard_session_store = FlashcardSessionStore()


def _build_client() -> Client:
    api_key = os.getenv("GOOGLE_API_KEY")
    return Client(api_key=api_key) if api_key else Client()


def _build_flashcard_prompt(topic: str, target_card_count: int) -> str:
    return (
        "You create concise study flashcards for ThinkSpace.\n"
        "Generate a helpful beginner-friendly deck for the topic below.\n"
        "Requirements:\n"
        f"- Aim for exactly {target_card_count} cards.\n"
        "- Keep each front short and question-like.\n"
        "- Keep each back accurate, compact, and directly explanatory.\n"
        "- Avoid duplicate cards and avoid filler.\n"
        "- Do not mention JSON, schemas, or formatting instructions.\n"
        "- If the topic is broad, choose the most foundational concepts.\n\n"
        f"Topic: {topic}"
    )


def choose_flashcard_count(topic: str) -> int:
    """Pick a sensible default deck size from topic breadth."""

    normalized = topic.strip().lower()
    breadth_score = 0

    if len(normalized.split()) >= 4:
        breadth_score += 1

    broad_topic_markers = (
        "introduction",
        "basics",
        "overview",
        "fundamentals",
        "systems",
        "history",
        "theory",
        "architecture",
        "biology",
        "physics",
        "chemistry",
        "math",
    )
    if any(marker in normalized for marker in broad_topic_markers):
        breadth_score += 1

    if "," in normalized or " and " in normalized or ":" in normalized:
        breadth_score += 1

    if breadth_score <= 0:
        return 4
    if breadth_score == 1:
        return 5
    if breadth_score == 2:
        return 6
    return 7


def _normalize_deck(
    topic: str, target_card_count: int, generated_deck: FlashcardDeck
) -> dict[str, object]:
    normalized_cards: list[dict[str, str]] = []
    for index, card in enumerate(generated_deck.cards[:target_card_count], start=1):
        front = card.front.strip()
        back = card.back.strip()
        if not front or not back:
            continue
        normalized_cards.append(
            {
                "id": card.id.strip() if card.id and card.id.strip() else f"flashcard-{index}",
                "front": front,
                "back": back,
            }
        )

    if not normalized_cards:
        raise ValueError("Flashcard generator returned no valid cards")

    normalized_title = (
        generated_deck.title.strip()
        if generated_deck.title and generated_deck.title.strip()
        else f"{topic.strip().title()} Flashcards"
    )

    deck_id = (
        generated_deck.id.strip()
        if generated_deck.id and generated_deck.id.strip()
        else f"deck-{uuid4()}"
    )

    return {
        "id": deck_id,
        "title": normalized_title,
        "cards": normalized_cards,
        "current_index": 0,
        "is_answer_revealed": False,
    }


def _generate_flashcard_deck(topic: str, target_card_count: int) -> dict[str, object]:
    client = _build_client()
    response = client.models.generate_content(
        model=get_flashcard_generation_model(),
        contents=_build_flashcard_prompt(topic, target_card_count),
        config=genai_types.GenerateContentConfig(
            temperature=0.4,
            response_mime_type="application/json",
            response_schema=FlashcardDeck,
        ),
    )

    if response.parsed is None:
        raise ValueError("Flashcard generator returned no structured payload")

    generated_deck = FlashcardDeck.model_validate(response.parsed)
    return _normalize_deck(topic, target_card_count, generated_deck)


async def generate_flashcard_deck(
    topic: str, target_card_count: int
) -> dict[str, object]:
    """Generate a normalized flashcard deck without blocking the event loop."""

    return await asyncio.to_thread(
        _generate_flashcard_deck,
        topic,
        target_card_count,
    )


async def publish_flashcard_job_result(
    *,
    user_id: str,
    session_id: str,
    result: dict[str, object],
) -> None:
    """Publish a background flashcard job result to the owning session."""

    logger.debug(
        "Publishing flashcard job result: user_id=%s session_id=%s status=%s tool=%s",
        user_id,
        session_id,
        result.get("status"),
        result.get("tool"),
    )
    await flashcard_job_outbox.publish_result(user_id, session_id, result)
