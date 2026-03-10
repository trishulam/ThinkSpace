# Flashcards End-to-End Scratchpad

## Purpose

This is the working scratchpad for Story Group D: flashcards end-to-end.

Use this document as the current thinking pad while we scope, sequence, and
implement the first fully backend-driven ThinkSpace product surface.

This is intentionally more tactical than the architecture docs. It should help
answer:

- what exactly we are building in v1
- what order to build it in
- what files are likely to change
- what should be deferred

## Current Goal

Build flashcards as the first complete backend-driven tutor surface using the
contracts already locked in Story Groups A, B, and C.

## Current Execution Status

- Phase 1 is now implemented enough to align the frontend flashcard domain with
  the locked contract names.
- The frontend now uses `flashcards.show` and `flashcards.clear` as the active
  action names.
- Temporary compatibility for legacy `flashcards.create` and `flashcards.end`
  parsing still exists in the frontend reducer/parser path.
- Phase 2 is now implemented enough to introduce typed frontend action and
  acknowledgement transport alongside the raw ADK websocket event stream.
- Phase 3 is now implemented enough to register the real backend flashcard tools
  and emit contract-compliant tool results.
- Phase 4 is now implemented enough to run real async flashcard generation in
  the backend and publish completion back to the owning websocket session.
- `flashcards.create` now enters the frontend creating state, allocates a job
  id, and launches a background Gemini-backed deck generator.
- Completed async jobs now publish a tool result plus `flashcards.show` to the
  active session, while failures publish `failed` plus `flashcards.clear`.
- The next phase is cleanup and removal of temporary demo compatibility.

The intended v1 flow is:

1. The orchestrator calls `flashcards.create`.
2. Backend accepts a long-running flashcard generation job.
3. When generation completes, backend emits a tool result with a
   `frontend_action`.
4. Frontend applies the action and shows the flashcard deck.
5. The active flashcard session can then be controlled through:
   - `flashcards.next`
   - `flashcards.reveal_answer`
   - `flashcards.end`
6. Frontend acknowledges whether the action was applied successfully.

## Locked Inputs From Earlier Story Groups

### Tool Surface

- `flashcards.create`
- `flashcards.next`
- `flashcards.reveal_answer`
- `flashcards.end`

### Tool Result Envelope

- `status`
- `tool`
- `job?`
- `summary?`
- `payload?`
- `frontend_action?`

### Frontend Action Envelope

- `type`
- `source_tool`
- `job_id?`
- `payload`

### Frontend Action Types For Flashcards

- `flashcards.begin`
- `flashcards.show`
- `flashcards.next`
- `flashcards.reveal_answer`
- `flashcards.clear`

### Frontend Acknowledgement Envelope

- `status`
- `action_type`
- `source_tool`
- `job_id?`
- `summary?`

### Frontend Acknowledgement Statuses

- `applied`
- `failed`

## Scope Guardrails

Keep v1 small.

Do not add yet:

- grading or correctness tracking
- `mark_correct` / `mark_incorrect`
- spaced repetition
- multiple active decks
- advanced flashcard analytics
- rich memory semantics specific to flashcards
- broader study-session orchestration beyond the active deck

## Existing Code Surface

### Frontend

- `frontend/client/components/FlashcardPanel.tsx`
  Presentational flashcard overlay. Already useful for v1.

- `frontend/client/flashcards.ts`
  Current flashcard state model, parser, and reducer. This is the main frontend
  flashcard domain module.

- `frontend/client/pages/SessionCanvas.tsx`
  Current flashcard state owner and render host. Also contains temporary demo
  logic and current raw log parsing.

- `frontend/client/hooks/useAgentWebSocket.ts`
  Current websocket event source. Needs a typed action path, not just raw logs.

### Backend

- `backend/app/main.py`
  Current websocket relay. Needs explicit app-level messages for
  `frontend_action` and `frontend_ack`.

- `backend/app/thinkspace_agent/tools/registry.py`
  Current tool registry. Needs real flashcard tool registration.

- new flashcard tool module(s)`
  Need to be added under `backend/app/thinkspace_agent/tools/`.

## Step-By-Step Build Plan

### Phase 1: Frontend Flashcard Contract Alignment

Goal:

Align the existing flashcard reducer and UI state to the locked contract names.

Why start here:

- this is the smallest, clearest slice
- the existing UI already works
- it makes the rest of the backend and transport work target a stable frontend
  surface

What changes:

- `flashcards.create` loading semantics use `flashcards.begin`
- populated deck display semantics use `flashcards.show`
- `flashcards.end` frontend action semantics become `flashcards.clear`
- flashcard state remains:
  - `idle`
  - `creating`
  - `active`

Expected result:

- the frontend flashcard domain reflects the contract docs
- the panel remains visually usable
- action naming stops drifting from the architecture

### Phase 2: Typed Frontend Action + Ack Transport

Goal:

Introduce a real typed action path between backend and frontend.

What changes:

- backend can emit `frontend_action` messages explicitly
- frontend can apply them explicitly
- frontend can send back `frontend_ack`

Expected result:

- flashcard state is no longer driven primarily by raw `tool-result` log parsing
- `useAgentWebSocket` becomes the proper integration seam

Implementation status:

- implemented enough for the v1 transport layer
- backend now supports additive websocket messages for `frontend_action` and
  `frontend_ack`
- frontend now listens for typed `frontend_action` messages and sends back typed
  acknowledgements

### Phase 3: Backend Flashcard Tools

Goal:

Implement the first real ThinkSpace flashcard tools behind the orchestrator.

What changes:

- register `flashcards.create`
- register `flashcards.next`
- register `flashcards.reveal_answer`
- register `flashcards.end`

Expected result:

- the backend can produce contract-compliant tool results
- the flashcard lifecycle is no longer demo-only

Implementation status:

- implemented enough for the first backend tool slice
- `flashcards.create`, `flashcards.next`, `flashcards.reveal_answer`, and
  `flashcards.end` are now registered in the ThinkSpace tool registry
- `flashcards.create` is long-running and currently returns `accepted`, a `job`
  id, and a `flashcards.begin` frontend action that enters the creating state
- real deck generation and completion with populated deck payloads still belong
  to Phase 4

### Phase 4: Flashcard Generation Worker

Goal:

Support asynchronous deck creation for `flashcards.create`.

What changes:

- add a flashcard generation worker/subagent path
- normalize generated deck content into a stable deck shape

Expected result:

- `flashcards.create` behaves like a real long-running tool
- completion can emit `flashcards.show`

Implementation status:

- implemented enough for the first real worker path
- generation now uses the Google GenAI client directly with structured JSON
  output constrained by a `FlashcardDeck` schema
- the worker currently uses topic plus requested card count, with backend-side
  auto card-count selection when the tool call omits an explicit target
- async completion is delivered through a lightweight per-session in-memory
  outbox that the websocket endpoint subscribes to

### Phase 5: End-To-End Wiring And Cleanup

Goal:

Replace the current demo and compatibility flow with the typed flashcard flow.

What changes:

- `SessionCanvas` stops using raw log parsing as the main source of truth
- demo buttons and temporary wiring are either removed or clearly isolated
- flashcard UI is driven by typed backend action messages

Expected result:

- flashcards become the first true end-to-end ThinkSpace product surface

Implementation status:

- implemented enough for the current typed flashcard flow
- `SessionCanvas` now consumes typed `frontend_action` messages as the
  authoritative flashcard state input instead of keeping a local flashcard demo
  path alive
- flashcard acknowledgements now reflect whether the requested state transition
  was actually valid and applied
- the websocket hook now drains the frontend-action queue instead of letting it
  grow indefinitely during a long session
- backend flashcard tools now keep an in-memory active flashcard session so the
  orchestrator gets current-card context back on create, reveal, next, and end
- loading and deck-display are now split into separate frontend actions
  (`flashcards.begin` and `flashcards.show`) so a stale loading action cannot
  overwrite a rendered deck
- the frontend now processes flashcard actions sequentially, allowing
  `flashcards.begin` to render a visible creating state before the populated
  `flashcards.show` action is applied
- a semantic agent update is now reintroduced only for the creation-complete
  milestone when `flashcards.show` is applied and the deck is actually visible
- successful flashcard frontend acknowledgements are now interpreted as backend
  semantic state updates so the system knows when cards or answers are actually
  visible in the UI without forcing a fresh live-agent response
- reveal-before-next is now guided primarily through prompting and UI-aware
  sequencing policy rather than a hard backend block on `flashcards.next`

## Recommended Starting Point

Start with **Phase 1: Frontend Flashcard Contract Alignment**.

Reason:

- it is narrow
- it is already close to working
- it creates the cleanest base for the transport and backend work

Concrete first changes when implementation begins:

- update `frontend/client/flashcards.ts`
- update `frontend/client/pages/SessionCanvas.tsx`
- keep `frontend/client/components/FlashcardPanel.tsx` unchanged unless the new
  contract reveals a UI mismatch

## Key Risks To Watch

- keeping the old raw `tool-result` parsing path alive too long
- trying to solve richer study mechanics too early
- mixing frontend execution acknowledgements with user interaction semantics
- expanding the flashcard schema before the active flow is proven

## Questions To Resolve Before Coding Each Phase

### Before Phase 1

- Do we want temporary backward compatibility for old action names, or should we
  cut over cleanly?

### Before Phase 2

- What exact websocket message shape should carry `frontend_action`?
- Should typed actions and raw ADK events share the same socket stream or be
  separated by message `type`?

### Before Phase 4

- What is the minimal v1 flashcard deck schema the generator must return?

## Definition Of Success For Story Group D

Story Group D is successful when:

- the orchestrator can trigger flashcard creation through a real backend tool
- the deck appears in the existing `FlashcardPanel`
- the frontend applies `show`, `next`, `reveal_answer`, and `clear` through the
  typed action contract
- the frontend sends `applied` / `failed` acknowledgements
- the flow works without relying on ad hoc raw log parsing as the main protocol
