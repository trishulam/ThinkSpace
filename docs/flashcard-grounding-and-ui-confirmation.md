# Flashcard Grounding And UI Confirmation

## Purpose

This document explains the current flashcard architecture after the grounding
fixes that made flashcard tutoring deterministic.

The core idea is simple:

- the orchestrator should always know the current visible question
- it should also know the current answer
- it should also know the following question
- but it must still wait for UI confirmation before talking as if the state is
  visible

## Why This Exists

The earlier flashcard loop relied too much on conversational memory and event
timing. That created a failure mode where the tutor could:

- ask the wrong card
- reveal an answer too early
- talk about the next card before the UI had actually advanced

The fix was to make flashcard state explicit and deterministic in both:

- tool payloads
- ack-derived semantic updates

## Core State Model

The backend flashcard session store now tracks enough information to describe:

- the active topic and title
- total card count
- the current card
- the next card
- whether the answer is revealed
- whether the deck and answer are visible in the UI

The important architectural addition is the inclusion of `next_card` in the
session snapshot.

## Grounding Payload Contract

Flashcard tools now emit a compact grounding payload built from the active
session snapshot.

Current payload shape:

- `topic`
- `title`
- `total_cards`
- `current_card`
- `next_card`
- `ui`

### `current_card`

Contains the current study target:

- `question`
- `answer`
- `position`
- `index`
- `is_answer_revealed`

### `next_card`

Contains the immediate following study target:

- `question`
- `position`
- `index`

### `ui`

Contains visibility state:

- `deck_visible`
- `answer_visible`
- `visible_index`

## Tool Semantics

### `flashcards.create`

Behavior:

1. Accept the request and start generation.
2. Generate the deck in the background.
3. Set the active deck in the session store.
4. Return a completed result with grounding payload.
5. Send `flashcards.show` to the frontend.
6. Wait for UI acknowledgement before the tutor treats the first card as visible.

Important point:

- the tool payload already includes first-question, first-answer, and next
  question grounding
- the tutor still waits for the ack-derived semantic update before asking the
  first card

### `flashcards.next`

Behavior:

1. Advance backend session state.
2. Return a completed result immediately.
3. Include grounding for the newly current card and the card after that.
4. Send `flashcards.next` to the frontend.
5. Wait for ack-derived semantic confirmation before the tutor asks the new
   question.

Important point:

- the tool payload is deterministic even before the UI is confirmed
- the tutor must still not get ahead of the UI

### `flashcards.reveal_answer`

Behavior:

1. Reveal the current answer in backend session state.
2. Return a completed result immediately.
3. Include current question, current answer, and following question grounding.
4. Send `flashcards.reveal_answer` to the frontend.
5. Wait for ack-derived semantic confirmation before the tutor explains the
   answer.

### `flashcards.end`

Behavior:

1. Clear the active backend session.
2. Return the last known grounding payload.
3. Send `flashcards.clear` to the frontend.
4. Stop the flashcard loop cleanly.

## Why Tool Payload And Ack Both Matter

The architecture intentionally uses both signals.

### Tool payload gives deterministic state

This solves memory drift and makes the current/next card relationship explicit.

### Ack-derived semantic update gives visibility truth

This solves the "backend knows but learner cannot yet see it" problem.

Together they let the tutor be:

- grounded
- deterministic
- synchronized with the visible UI

## Ack-Derived Semantic Updates

The backend turns `frontend_ack` messages into tutoring-safe semantic guidance.

### `flashcards.show`

After ack, the backend tells the tutor that:

- the flashcards are now visible
- the current question is now the exact one to ask
- the answer and following card should not be described yet

### `flashcards.next`

After ack, the backend tells the tutor that:

- the next flashcard is now visible
- the current visible question is now the exact one to ask

### `flashcards.reveal_answer`

After ack, the backend tells the tutor that:

- the current answer is now visible
- it should explain that answer briefly
- it should then pause

## Interpreter And Runtime Context

Flashcard grounding is not only for the tutor tool loop. It also feeds broader
runtime context.

Important integrations:

- `backend/app/main.py` builds semantic suffixes that include current question,
  current answer, and following question
- `backend/app/thinkspace_agent/context/interpreter_packet.py` includes richer
  flashcard surface summary content
- policy files instruct the tutor to treat flashcard payloads as authoritative
  grounding while a deck is active

## Design Rules

- current visible question is the source of truth for what the tutor asks
- current answer is the source of truth for what the tutor explains
- following question is available for deterministic continuity
- tool payloads provide grounded state
- acks provide visibility confirmation
- the tutor must never rely on conversational memory alone for active
  flashcards

## Key Files

- `backend/app/thinkspace_agent/tools/flashcards.py`
- `backend/app/thinkspace_agent/tools/flashcard_jobs.py`
- `backend/app/main.py`
- `backend/app/thinkspace_agent/context/interpreter_packet.py`
- `backend/app/thinkspace_agent/instructions/tool_policy.md`
- `backend/app/thinkspace_agent/instructions/response_policy.md`
- `frontend/client/pages/SessionCanvas.tsx`
