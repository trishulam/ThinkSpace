# Gemini Live Tool Integration Reference

## Purpose

This document is the practical end-to-end reference for integrating new tools
into the ThinkSpace Gemini Live agent stack.

It captures:

- the current implementation shape that is working in this repo
- the backend and frontend responsibilities for tool-driven UI behavior
- the message contracts used between ADK, backend, and frontend
- the lessons learned while implementing flashcards
- the recommended pattern to follow for future tool families

Use this together with:

- `adk-live-integration.md`
- `agent-tool-catalog.md`
- `tool-result-contract.md`
- `frontend-action-contract.md`

This document is not a replacement for those architecture docs. It is the
"how to actually build it here" reference.

## Current End-To-End Model

ThinkSpace uses three distinct layers during a live session:

1. ADK live session layer
2. app-level backend/frontend action layer
3. selective semantic feedback layer back into the agent

The important design rule is:

- keep the raw ADK stream intact
- add a small typed app-level action channel beside it
- send semantic feedback back to the model only when a UI milestone is
  meaningfully complete

## The Three Channels

### 1. Raw ADK event stream

This is the direct downstream output of `runner.run_live(...)`.

It contains:

- model text
- model audio
- transcriptions
- usage metadata
- tool call / tool response structures

In this codebase, the backend relays raw ADK events to the frontend unchanged.

Why we keep it:

- it preserves normal Gemini Live behavior
- it avoids building a second conversation runtime
- it gives the frontend direct access to transcripts, audio, and metadata

### 2. Typed frontend action channel

This is the additive app-level channel used for deterministic UI actions.

Backend to frontend:

- `type: "frontend_action"`
- `action: { type, source_tool, job_id?, payload }`

Frontend to backend:

- `type: "frontend_ack"`
- `ack: { status, action_type, source_tool, job_id?, summary? }`

Why we added it:

- raw tool response parsing alone is not reliable enough for product UI behavior
- frontend UI changes need a deterministic contract
- acknowledgements let the backend know what actually became visible

### 3. Selective semantic feedback back to the agent

This uses `LiveRequestQueue.send_content()`.

This is not the raw perceptual stream. It is a semantic trigger.

The key product rule is:

- use `send_content()` sparingly
- only send it when something important has become true in product terms

Current flashcard examples:

- after `flashcards.show` is applied:
  - "The flashcards are now visible in the UI. The first question is: ..."
- after `flashcards.reveal_answer` is applied:
  - "The current flashcard answer is now visible in the UI. The revealed answer is: ..."
- after `flashcards.next` is applied:
  - "The next flashcard is now visible in the UI. Ask the learner this question: ..."

What we learned:

- sending semantic updates for every frontend event makes the agent too reactive
- sending them only for meaningful milestones works much better

## Current Tool Integration Pattern

For tools that produce visible UI changes, the implementation pattern is:

1. The model calls a backend tool.
2. The tool returns a contract-compliant tool result.
3. The result may include a `frontend_action`.
4. The backend relays the raw ADK event and separately emits a typed
   `frontend_action` message.
5. The frontend applies the action deterministically.
6. The frontend sends a typed `frontend_ack`.
7. The backend updates any backend-owned session state.
8. If the UI milestone matters semantically, the backend sends a concise
   `send_content()` update back into the live session.
9. The agent reasons from that new confirmed state.

This is the core pattern to copy for future tools.

## Contracts Used In Practice

### Backend tool result envelope

Every backend tool should return:

- `status`
- `tool`
- `job?`
- `summary?`
- `payload?`
- `frontend_action?`

Status values currently used:

- `accepted`
- `completed`
- `failed`

Design rule:

- keep the envelope small and stable
- do not over-normalize payloads too early

### Frontend action envelope

Every frontend action should contain:

- `type`
- `source_tool`
- `job_id?`
- `payload`

Design rule:

- frontend actions describe deterministic execution
- they are not high-level tutoring instructions

### Frontend acknowledgement envelope

Every acknowledgement should contain:

- `status`
- `action_type`
- `source_tool`
- `job_id?`
- `summary?`

Acknowledgement statuses currently used:

- `applied`
- `failed`

## Flashcards Case Study

Flashcards are the first complete tool family implemented with this pattern.

### Tool surface

- `flashcards.create`
- `flashcards.next`
- `flashcards.reveal_answer`
- `flashcards.end`

### Execution style

- `flashcards.create`: long-running
- `flashcards.next`: synchronous
- `flashcards.reveal_answer`: synchronous
- `flashcards.end`: synchronous

### Backend state ownership

Flashcards are stateful, so the backend keeps a session store.

Current backend-owned state includes:

- active deck
- current index
- whether answer is revealed logically
- whether deck is visible in UI
- which card index is visible in UI
- whether answer is visible in UI

Why this matters:

- the model should not be the source of truth for active UI state
- the frontend reducer alone is not enough for tool dedupe or semantic feedback

## Flashcard Create Flow

`flashcards.create` is the reference for a long-running tool.

Flow:

1. Agent calls `flashcards.create`.
2. Backend returns `status: accepted` with a generated `job.id`.
3. Backend includes `frontend_action: flashcards.begin`.
4. Frontend enters visible creating state.
5. Background worker generates the deck.
6. Backend publishes async completion through the session outbox.
7. Completion result includes `frontend_action: flashcards.show`.
8. Frontend shows the deck.
9. Frontend sends `frontend_ack`.
10. Backend marks the deck as visible and sends one semantic update back to the
    agent with the first question.

Important product learning:

- loading state needed a dedicated `flashcards.begin` action
- overloading `flashcards.show` for both loading and display caused a poor UX

## Flashcard Reveal Flow

`flashcards.reveal_answer` is the reference for a synchronous UI-control tool.

Current design:

1. Agent calls `flashcards.reveal_answer`.
2. Backend updates backend-owned logical state to "revealed but not yet visible".
3. Tool returns a minimal control result and a `flashcards.reveal_answer`
   frontend action.
4. Frontend flips the card using its own stored deck state.
5. Frontend sends `frontend_ack`.
6. Backend marks answer as visible in UI.
7. Backend sends semantic confirmation back to the agent including the revealed
   answer.
8. Agent explains the answer.

Important product learning:

- do not rely on the tool result alone for explanation timing
- the reliable time to talk is after frontend ack

### Why the tool result is intentionally minimal

For `flashcards.reveal_answer`, the immediate tool result should not contain the
full answer text that would encourage the model to explain too early.

Instead, it should communicate:

- the reveal was requested
- the agent should wait for the UI confirmation

The actual revealed answer arrives through the semantic ack path.

## Flashcard Next Flow

`flashcards.next` is the reference for a synchronous "advance UI state" tool.

Current design:

1. Agent calls `flashcards.next`.
2. Backend advances the active backend session state.
3. Tool returns a minimal control result and a `flashcards.next` frontend action.
4. Frontend advances to the next card using its own deck state.
5. Frontend sends `frontend_ack`.
6. Backend marks the new card as visible in UI.
7. Backend sends semantic confirmation back to the agent including the next
   question.
8. Agent asks the learner the confirmed next question.

### Duplicate-next prevention

We hit a real bug where the model sometimes called `flashcards.next` twice in
quick succession.

Current prevention is intentionally small:

- backend compares `current_index` with `ui.visible_index`
- if backend has already advanced but UI has not yet caught up, `flashcards.next`
  returns a no-op result
- in that case it does not emit another `frontend_action`

Why this is the right size:

- it fixes the concrete bug
- it does not add stream gating or a large state machine
- it uses state we already own

## Flashcard End Flow

`flashcards.end` is the simplest control tool.

Flow:

1. Agent calls `flashcards.end`.
2. Backend clears active flashcard session state.
3. Tool returns `flashcards.clear`.
4. Frontend clears the flashcard UI.
5. Frontend acknowledges completion.

No extra semantic feedback is currently required for `flashcards.clear`.

## Backend Responsibilities

For future tool integrations, the backend usually needs to implement four
concerns.

### 1. Tool implementation

Each tool should:

- validate active session context if needed
- return the shared result envelope
- emit a typed `frontend_action` when visible UI work is required
- keep summaries concise and product-meaningful

### 2. Backend-owned state when the tool is stateful

Only add backend session state when it solves a real problem.

Good reasons:

- active deck or active artifact ownership
- dedupe of control actions
- knowing what the UI should now be showing
- semantic feedback after frontend confirmation

Bad reasons:

- mirroring every frontend field without need
- building a full duplicate UI store in the backend

### 3. Websocket relay logic

The backend websocket layer currently does four important things:

- accepts user text and sends it to `send_content()`
- accepts user images/audio and sends them to `send_realtime()`
- relays raw ADK events downstream
- emits additive app-level `frontend_action` and `tool_result` messages

### 4. Ack interpretation

When a `frontend_ack` arrives, the backend may:

- validate the envelope
- update backend-owned session state
- emit a semantic `send_content()` message if the UI milestone matters to
  reasoning

That last part is what makes the model reason from confirmed UI state instead of
assumed UI state.

## Frontend Responsibilities

For future tool integrations, the frontend usually needs three pieces.

### 1. Typed action parsing

The websocket hook should:

- recognize `frontend_action` messages
- enqueue them in arrival order
- keep the raw ADK stream handling separate

### 2. Deterministic action application

The UI state owner should:

- apply known action types one by one
- use a reducer or similarly deterministic state transition path
- send a typed `frontend_ack` after application

Current flashcard implementation applies queued actions one at a time inside
`SessionCanvas`.

### 3. Small idempotency protections

The frontend should guard against easy duplicates.

Current flashcard examples:

- ignore stale `flashcards.begin`
- ignore stale `flashcards.show` for a job already active
- process the current head action only once before dequeuing it
- keep a minimum visible creating duration for `flashcards.begin`

This is enough to handle real UI timing issues without introducing a large
client-side action framework.

## What We Learned

These are the main implementation lessons worth preserving.

### 1. Keep the raw ADK stream intact

We briefly tried gating or suppressing model output at the websocket layer.

That was a bad direction.

Why:

- it changed the semantics of the live stream itself
- it made behavior harder to reason about
- it created surprising interactions with model turns

Current rule:

- do not gate the raw live stream unless there is no simpler alternative

### 2. Use `send_content()` only for meaningful semantic milestones

We also learned that semantic feedback is powerful but easy to overuse.

Bad pattern:

- send semantic feedback for every small frontend acknowledgement

Better pattern:

- send semantic feedback only when the UI state change creates a new reasoning
  fact the agent should act on

Examples that made sense:

- deck is now visible
- answer is now visible
- next card is now visible

Examples that did not justify a new reasoning turn:

- every intermediate ack
- every local reducer transition

### 3. Separate "loading" from "showing real data"

`flashcards.begin` exists because loading and showing a populated deck are not
the same UI state.

Current rule:

- use distinct action types when UX states are meaningfully different

### 4. Use minimal tool outputs for UI-dependent synchronous control tools

For tools like `flashcards.reveal_answer` and `flashcards.next`:

- the immediate tool result should not over-share content that depends on the UI
  having visibly changed
- let frontend ack be the point where that content becomes semantically
  available to the model

This keeps timing cleaner without mutating the transport.

### 5. Add small dedupe checks instead of big orchestration layers

When we saw duplicate `next` calls, the right fix was not a large barrier or
queueing system.

The right fix was:

- inspect existing backend state
- detect "already in flight"
- return a no-op result without emitting another frontend action

Current rule:

- prefer small idempotency checks over transport complexity

### 6. Prompt policy still matters

Contracts and state checks help, but prompt policy remains part of the final
behavior.

The current prompt shape should reinforce:

- do the UI action first
- wait for confirmation
- then talk about what is now visible
- avoid duplicate control calls in one learner turn

Tool contracts and prompt policy should support each other.

## Recommended Implementation Recipe For A New Tool

Use this checklist when integrating a future tool family.

### Step 1: Lock the tool semantics first

Before coding, decide:

- tool name
- whether it is synchronous or long-running
- whether it needs frontend-visible behavior
- whether it needs backend-owned session state
- what semantic milestone, if any, should trigger a follow-up `send_content()`

### Step 2: Add or confirm the contract entries

Update the appropriate docs:

- `agent-tool-catalog.md`
- `tool-result-contract.md`
- `frontend-action-contract.md`

Do this before code drifts.

### Step 3: Implement the backend tool

Create the tool function and ensure it:

- returns the shared tool envelope
- emits a `frontend_action` if needed
- keeps summaries short and clear

If the tool is long-running:

- allocate a `job.id`
- return `accepted`
- finish later through the outbox

### Step 4: Add backend-owned state only if needed

Introduce backend session state only for stateful tools.

Examples:

- active flashcard deck
- current artifact being edited
- current canvas job in flight

Do not build backend state just because it feels architecturally neat.

### Step 5: Relay the action over the websocket

The websocket layer should:

- continue relaying raw ADK events
- additionally emit `frontend_action` messages when detected in tool outputs

For async jobs:

- send the result envelope as `type: "tool_result"`
- separately emit the corresponding `frontend_action`

### Step 6: Implement frontend action handling

Frontend should:

- recognize the new action type
- apply it deterministically
- send back `frontend_ack`

If the action is stateful or timing-sensitive:

- add a small idempotency guard if needed

### Step 7: Add selective semantic ack handling

In the backend ack handler, decide whether successful application of the action
should produce a semantic update for the agent.

Ask:

- does the UI now expose new information the model should reason from
- is this a meaningful new tutoring fact

If yes:

- send a concise `send_content()` message

If no:

- just update backend state and stop there

### Step 8: Add prompt guidance

Update the instruction policy if the tool changes conversational sequencing.

Do not rely only on prompts.
Do not rely only on runtime checks.

Use both where appropriate.

### Step 9: Test the full loop

For every new tool, verify:

- the model can call it successfully
- the backend emits the expected result envelope
- the frontend applies the action
- the frontend sends ack
- backend state updates correctly
- semantic follow-up happens only when intended
- duplicate action paths do not create extra UI transitions

## Concrete Anti-Patterns To Avoid

These were the main dead ends or near-dead ends from flashcards.

### 1. Do not overuse raw event-log parsing for product state

Use typed frontend actions instead.

### 2. Do not overload one action type with multiple UX meanings

Use separate actions like `flashcards.begin` and `flashcards.show`.

### 3. Do not gate or suppress the raw Gemini Live stream unless absolutely forced

Keep the transport simple.

### 4. Do not send semantic `send_content()` updates for every UI acknowledgement

That makes the agent noisy and unpredictable.

### 5. Do not expose too much content too early

This is especially important when the UI has not yet confirmed the state change.

For UI-dependent synchronous control tools, prefer minimal control payloads first,
semantic detail after ack.

### 6. Do not add large coordination state when a small idempotency check is enough

Prefer a one-condition guard over a new subsystem.

## Current Flashcard Implementation Summary

The current flashcard implementation is intentionally modest:

- one long-running creation tool with async completion
- three synchronous control tools
- backend-owned active session store
- typed frontend action and ack channel
- selective semantic `send_content()` after meaningful UI confirmation
- minimal immediate tool payloads for `reveal_answer` and `next`
- small duplicate-next protection using `current_index` and `ui.visible_index`

This is the baseline pattern to reuse for future stateful tool families.

## Future Tool Integration Guidance

The likely next families such as `canvas.generate_visual`,
`canvas.generate_widget`, and `canvas.enhance` should follow the same structure:

- backend tool returns shared result envelope
- frontend executes deterministic insertion action
- frontend acknowledges application
- backend optionally emits semantic follow-up only if the agent needs to reason
  again from the confirmed result

The exact payloads will differ, but the transport pattern should stay the same.

## Final Principle

Keep the integration boring.

The best shape we found was not the most clever one. It was:

- stable contracts
- small backend state where needed
- deterministic frontend actions
- acknowledgements for visible completion
- selective semantic feedback
- small dedupe checks for real bugs

That is the pattern future ThinkSpace tools should follow.
