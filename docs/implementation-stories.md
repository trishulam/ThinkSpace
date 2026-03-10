# ThinkSpace Implementation Stories

## Purpose

This document translates the proactive tutor architecture into a practical implementation plan.

It is intended to guide full-speed development over the next two days while preserving the larger system vision. The stories here are not reduced to a hackathon-lite scope. They are sequenced so that the core system can be built aggressively without losing architectural coherence.

This document should be used together with:

- `proactive-tutor-system.md`
- `adk-live-integration.md`

## Planning Principles

These principles shape the story order.

### 1. Capability Before Proactivity

The tutor must first be able to do the right things before it becomes proactive about doing them.

That means:

- first build tools and subagents
- then build execution and rendering
- then build memory and digests
- then add proactive triggers and speaking policy

### 2. Build By Product Surface, Not By Folder

Implementation should be planned by experience slices, not by backend-only or frontend-only work buckets.

Good:

- flashcards end-to-end
- enhancement end-to-end
- HTML output end-to-end

Bad:

- first only backend tools
- then only frontend dispatcher
- then only gestures

### 3. One Tutor Brain

The main voice orchestrator remains the only top-level session brain throughout implementation.

Every story should preserve this assumption.

### 4. Structured Contracts Early

The agent should not directly emit freeform UI instructions.

Typed tool results and typed frontend actions should be introduced early, because all later features depend on them.

### 5. Preserve Momentum

Each major story group should leave the repo in a demoable or at least observably testable state.

## Overall Sequence

The recommended implementation order is:

1. tool catalog and backend tool surface
2. backend-to-frontend action contract
3. flashcards end-to-end
4. image generation and canvas enhancement
5. HTML/widget output
6. canvas worker delegation
7. session state and memory model
8. environment interpreter and digests
9. proactivity engine

This order reflects the philosophy:

- first make the agent capable
- then make capabilities visible
- then make the system aware
- then make it proactive

## Story Groups

The work is organized into story groups. Each group contains one or more concrete implementation stories.

## Story Group A: Tool Catalog And Agent Capability Surface

### Goal

Define the complete tool surface the voice orchestrator can use.

### Why This Comes First

Without a stable tool catalog, implementation will drift and later contracts will become ad hoc.

### Main Deliverable

A shared source of truth describing:

- tool names
- purpose
- sync vs long-running
- subagent involvement
- expected outputs
- frontend actions required
- backend state updates required

### Stories

#### Story A1: Define Tool Families

Create the first formal tool family list.

Expected families:

- `flashcards.*`
- `canvas.*`
- `image.*` or image-related canvas tools
- `widget.*`
- internal orchestration helpers if needed

What needs to be done:

- list every tool the orchestrator should conceptually have
- group tools by domain
- explicitly separate image output from HTML output
- explicitly separate canvas enhancement from generic canvas editing

Done means:

- the team can name the full set of intended agent capabilities
- overlap between tools is reduced
- subagent boundaries become easier to define

#### Story A2: Mark Tool Execution Style

For each tool, decide whether it is:

- synchronous
- long-running
- long-running with progress potential

What needs to be done:

- classify flashcard generation
- classify enhancement
- classify image generation
- classify HTML widget generation
- classify direct canvas delegation

Done means:

- every important tool has lifecycle expectations
- notch and job state design can be grounded in real tool behavior

#### Story A3: Define Subagent Ownership

For each complex tool, define whether it uses:

- direct backend logic
- one specialist subagent
- multiple sequential workers

Examples:

- flashcards likely use a flashcard generation worker
- enhancement likely uses a planner plus image generator
- HTML output likely uses a widget generator

Done means:

- the system has explicit responsibility boundaries
- the voice orchestrator remains the owner of why, not how

### Relevant Resources

- `docs/proactive-tutor-system.md`
- `docs/adk-live-integration.md`
- ADK tool execution docs summarized in `docs/adk-live-integration.md`

### Risks

- tools become too broad and fuzzy
- multiple tools end up meaning the same thing
- subagent roles overlap and create hidden orchestration duplication

### Current Tracking Status

Story Group A now has a living reference in `docs/agent-tool-catalog.md`.

Current planning status:

- Story A1 is locked enough for the v1 tool surface
- Story A2 execution-style decisions are locked for the current v1 tools
- Story A3 ownership decisions are locked for the current v1 tools

Current locked v1 tool surface:

- `canvas.generate_visual`
- `canvas.generate_widget`
- `canvas.enhance`
- `canvas.delegate_task`
- `flashcards.create`
- `flashcards.next`
- `flashcards.reveal_answer`
- `flashcards.end`

Future-scope candidates currently noted but not part of v1:

- `knowledge.lookup`
- `research.lookup`
- web-search-backed retrieval

## Story Group B: Backend Tool Result Contract

### Goal

Standardize what every ThinkSpace tool returns.

### Why This Matters

If tool outputs are inconsistent, the orchestrator cannot reason cleanly and the frontend cannot react predictably.

### Main Deliverable

A shared backend tool result shape.

Potential common fields:

- `status`
- `job_id`
- `summary`
- `semantic_payload`
- `frontend_action`
- `memory_updates`

### Stories

#### Story B1: Define Tool Result Envelope

What needs to be done:

- decide the common result fields
- support both sync and long-running tool outputs
- support optional frontend actions
- support optional session-memory updates

Done means:

- every tool can return results in a uniform way
- orchestrator-side reasoning can be implemented consistently

#### Story B2: Define Job Lifecycle Semantics

What needs to be done:

- define what `started`, `completed`, `failed`, and `accepted` mean
- decide when `job_id` is required
- decide whether a tool can return multiple follow-up events

Done means:

- long-running tools can be tracked reliably
- UI can represent work in progress cleanly

### Relevant Resources

- ADK long-running tool concepts in `docs/adk-live-integration.md`
- existing notch and live-agent UI in the frontend

### Risks

- tool outputs become too custom
- job lifecycle semantics differ per tool and cause orchestration chaos

### Current Tracking Status

Story Group B now has a living reference in `docs/tool-result-contract.md`.

Current planning status:

- Story B1 has a locked v1 baseline result envelope
- Story B2 has a locked v1 baseline lifecycle model

Current locked v1 result envelope:

- `status`
- `tool`
- `job?`
- `summary?`
- `payload?`
- `frontend_action?`

Current locked v1 lifecycle statuses:

- `accepted`
- `completed`
- `failed`

Current v1 contract boundary:

- `memory_updates` is intentionally excluded from the locked v1 result envelope
- memory remains orchestrator-owned for now

## Story Group C: Backend-To-Frontend Action Contract

### Goal

Create the typed action channel that lets backend tool results produce visible product behavior.

### Why This Is Foundational

This is the bridge between “the agent called a tool” and “the user sees something happen”.

### Main Deliverable

A single shared frontend action envelope and acknowledgement model.

### Stories

#### Story C1: Define Action Envelope

Required characteristics:

- action `type`
- `request_id`
- optional `job_id`
- typed `payload`
- source metadata if useful

Examples of action families:

- `flashcards.show_set`
- `flashcards.flip`
- `canvas.insert_image_output`
- `canvas.insert_html_output`
- `canvas.insert_link_card`
- `canvas.apply_canvas_agent_result`

Done means:

- the backend can express UI or canvas changes structurally
- the frontend has one dispatcher shape to support

#### Story C2: Define Frontend Acknowledgement Envelope

Possible statuses:

- `applied`
- `failed`
- `dismissed`
- `user_interacted`

What needs to be done:

- define what comes back after an action is processed
- decide whether frontend errors are surfaced to the orchestrator
- decide what should update memory automatically

Done means:

- the orchestrator can know what actually happened
- state cannot silently diverge between frontend and backend

### Relevant Resources

- `docs/proactive-tutor-system.md`
- existing websocket event handling path in `frontend/client/hooks/useAgentWebSocket.ts`

### Risks

- action formats become fragmented
- backend assumes success without frontend confirmation

### Current Tracking Status

Story Group C now has a living reference in `docs/frontend-action-contract.md`.

Current planning status:

- Story C1 has a locked v1 baseline action envelope
- Story C2 has a locked v1 baseline acknowledgement envelope

Current locked v1 frontend action envelope:

- `type`
- `source_tool`
- `job_id?`
- `payload`

Current locked v1 frontend action types:

- `flashcards.begin`
- `canvas.insert_visual`
- `canvas.insert_widget`
- `flashcards.show`
- `flashcards.next`
- `flashcards.reveal_answer`
- `flashcards.clear`

Current v1 contract boundary:

- `canvas.delegate_task` remains a special execution path rather than being
  forced into a simple single frontend action
- acknowledgements are intentionally limited to `applied` and `failed` in v1

## Story Group D: Flashcards End-To-End

### Goal

Make flashcards a complete agent-controlled product surface.

### Why This Story Is Important

Flashcards are one of the clearest ways to prove that the tutor can both create and control UI beyond voice.

### Current Tracking Status

Story Group D now has a working scratchpad in
`docs/flashcards-end-to-end-scratchpad.md`.

Current implementation status:

- Phase 1 frontend contract alignment is implemented enough for v1
- Phase 2 typed frontend action and acknowledgement transport is implemented
  enough for v1
- Phase 3 backend flashcard tools are implemented enough for the first backend
  slice
- Phase 4 async flashcard generation worker is implemented enough for the first
  real deck-generation path
- Phase 5 end-to-end wiring and cleanup are implemented enough for the typed
  flashcard flow to be the primary path

Current boundary:

- flashcard generation currently uses topic plus requested card count with an
  auto-size heuristic, not yet richer lecture/session context
- completion delivery currently uses an in-memory per-session outbox rather than
  a durable external job system
- flashcard study controls are still agent-driven rather than exposed as a
  dedicated direct user-control surface in the panel
- flashcard frontend acknowledgements are now semantically interpreted by the
  backend as session-state updates, but this bridge is still specific to the
  flashcard flow rather than being generalized across all tool families
- only the deck-created-and-visible milestone currently feeds a semantic update
  back into the live agent loop
- reveal-before-next is currently enforced by prompt policy rather than a strict
  backend-only flashcard state machine

### Stories

#### Story D1: Flashcard Content Generation

What needs to be done:

- define flashcard content schema
- build flashcard generation tool or subagent
- ensure output is normalized, not freeform prose
- store deck semantics in backend memory

Key decisions:

- title fields
- front/back structure
- optional hints or metadata

Done means:

- the orchestrator can create a structured deck from session context

#### Story D2: Flashcard Frontend Rendering

What needs to be done:

- render a deck from structured backend action payload
- support visible current-card state
- support flipped/unflipped state
- support hide/show

Done means:

- backend action can reliably render flashcards

#### Story D3: Flashcard Control Loop

What needs to be done:

- support `flip`
- support `next`
- support `previous`
- support `hide`
- ensure backend session memory stays aligned with frontend state

Done means:

- the tutor can create and control the deck after creation

### Relevant Resources

- `docs/proactive-tutor-system.md`
- current frontend state management patterns

### Risks

- flashcard UI works but backend loses deck state
- frontend-only state creates desynchronization

## Story Group E: Image Output And Enhancement

### Goal

Make the tutor able to create polished visual artifacts and place them into the canvas.

### Why This Story Is Important

This is one of the most magical parts of the product.

### Stories

#### Story E1: Generic Image Output Tool

What needs to be done:

- build tool or subagent for generating support visuals
- decide image return format
- define placement metadata shape
- define insertion action to the frontend

Done means:

- the orchestrator can ask for an explanatory image and place it on canvas

#### Story E2: Enhancement Planner

What needs to be done:

- define what target region or viewport enhancement means
- decide what context is sent to the enhancement system
- transform rough sketch context into a polished-poster prompt or spec

Done means:

- enhancement has a clean planning layer instead of being an opaque single step

#### Story E3: Poster Placement And Canvas Insert

What needs to be done:

- define `canvas.insert_image_output`
- support exact coordinates or region-relative placement
- support initial soft replacement behavior

Done means:

- a generated poster appears on the canvas where the agent intended

### Relevant Resources

- `docs/proactive-tutor-system.md`
- `docs/adk-live-integration.md`
- tldraw AI docs already reviewed for canvas-as-output patterns

### Risks

- enhancement and generic image insertion get mixed together
- placement becomes unreliable because generation and layout are over-coupled

## Story Group F: HTML And Widget Output

### Goal

Make the tutor able to create interactive learning outputs, not just static images.

### Why This Matters

This broadens ThinkSpace from a poster-and-flashcard tutor into a workspace that can materialize explorable artifacts.

### Stories

#### Story F1: HTML Output Contract

What needs to be done:

- define how HTML payloads are represented
- decide sandboxing assumptions
- define placement and rendering metadata

Done means:

- backend can request insertion of a self-contained widget

#### Story F2: First Widget Type

Recommended first type:

- chart
- graph
- comparison widget

What needs to be done:

- make one concrete widget generation path reliable
- render it in the canvas through a dedicated frontend action

Done means:

- the tutor can create one interactive widget type end-to-end

### Relevant Resources

- `docs/proactive-tutor-system.md`
- tldraw canvas-as-output concepts

### Risks

- HTML output becomes too open-ended too early
- unsafe or unstable rendering path

## Story Group G: Canvas Worker Integration

### Goal

Make the canvas agent function as a worker subordinate to the voice orchestrator.

### Why This Matters

The current codebase has canvas-agent-like pieces, but the target system requires them to become subordinate capabilities rather than a parallel agent brain.

### Stories

#### Story G1: Canvas Delegation Contract

What needs to be done:

- define how the voice orchestrator delegates a structured canvas task
- define what context the canvas worker receives
- define what immediate acknowledgement it returns

Done means:

- the orchestrator can tell the canvas worker to begin work and immediately resume conversation flow

#### Story G2: Canvas Worker Result Handling

What needs to be done:

- define result summaries
- define any frontend application output
- feed completion summaries back into session memory

Done means:

- canvas work becomes part of the main tutor's narrative and memory

### Relevant Resources

- current tldraw agent boilerplate
- `docs/proactive-tutor-system.md`

### Risks

- the canvas worker stays too autonomous
- the voice agent loses narrative ownership of the task

## Story Group H: Session State And Memory

### Goal

Create the semantic memory model that keeps the tutor coherent.

### Why This Comes Before Proactivity

Without memory, proactive behavior becomes repetitive, forgetful, and hard to control.

### Stories

#### Story H1: Active Output State

Track:

- flashcard decks
- image outputs
- HTML widgets
- active canvas jobs

Done means:

- the orchestrator knows what currently exists in the learning environment

#### Story H2: Tutor Memory For Recent Actions

Track:

- recent suggestions already made
- recent proactive triggers already used
- recent successful outputs
- current teaching topic or subtopic

Done means:

- the tutor is less likely to repeat itself

### Relevant Resources

- `docs/proactive-tutor-system.md`

### Risks

- memory remains too chat-like and not semantic enough
- proactive triggers repeat because nothing was recorded

## Story Group I: Environment Interpreter

### Goal

Convert raw app activity into meaningful semantic context for the tutor.

### Why This Matters

This is the layer that makes the system proactive rather than merely reactive.

### Stories

#### Story I1: Canvas Digest MVP

What needs to be done:

- decide what changes count as meaningful
- summarize canvas state
- distinguish user vs agent changes
- optionally attach screenshot references

Done means:

- the tutor can receive a semantic summary of canvas evolution

#### Story I2: Gesture Intent Interpretation

What needs to be done:

- map stable gestures to semantic intents
- suppress noisy or unstable gesture signals
- define when a gesture becomes a tutor event

Done means:

- gesture input is meaningful at the orchestrator layer

#### Story I3: Flashcard Digest

What needs to be done:

- summarize current study state
- detect struggle or progress patterns if possible
- emit meaningful updates for the tutor

Done means:

- flashcard interactions can influence future tutoring behavior

#### Story I4: Session Digest

What needs to be done:

- unify canvas, gesture, flashcard, and job context into one semantic package

Done means:

- the orchestrator can reason over a clean high-level session summary

### Relevant Resources

- `docs/proactive-tutor-system.md`
- `docs/adk-live-integration.md`

### Risks

- digests become too verbose
- raw event noise leaks directly to the tutor

## Story Group J: Proactivity Engine

### Goal

Add real proactive behavior after capabilities and awareness are in place.

### Why This Is Last

Proactivity is only meaningful if the system can already:

- reason reliably
- act through tools
- update the frontend
- remember what happened

### Stories

#### Story J1: Trigger Policy

What needs to be done:

- define what events can trigger `send_content()`
- define what cannot
- define suppressions and cooldowns

Done means:

- the agent does not become noisy or random

#### Story J2: Inactivity And Timing Policy

What needs to be done:

- define inactivity windows
- define digest cadence
- define when speaking is appropriate vs silent action

Done means:

- the tutor feels intentional rather than impulsive

#### Story J3: Action Selection Policy

What needs to be done:

- decide when to speak only
- decide when to act silently
- decide when to both speak and trigger a tool

Done means:

- proactivity feels product-like rather than overly chatty

### Relevant Resources

- `docs/proactive-tutor-system.md`
- `docs/adk-live-integration.md`

### Risks

- the tutor talks too much
- the tutor interrupts active work
- the tutor repeats the same helpful suggestions

## Suggested Technical Sequence

If coding begins immediately, the practical order should be:

1. A
2. B
3. C
4. D
5. E
6. F
7. G
8. H
9. I
10. J

This is the clean top-down sequence from capability to proactivity.

## Suggested Two-Day Execution Plan

This is the aggressive, all-out sequence for the next two days.

This is not a guarantee of total completeness, but it is a coherent way to attack the work with maximum momentum.

### Day 1: Capability And Execution

#### Block 1: Tool surface

Primary objective:

- finalize tool families
- define tool contracts
- define job semantics

Must leave with:

- clear tool catalog
- shared tool result envelope

#### Block 2: Frontend action contract

Primary objective:

- define action envelope
- define acknowledgement envelope
- establish one dispatch path

Must leave with:

- backend can emit structured actions
- frontend can receive and acknowledge them

#### Block 3: Flashcards complete slice

Primary objective:

- build flashcard generation
- build flashcard rendering
- build flashcard control actions

Must leave with:

- end-to-end flashcard loop working

#### Block 4: Enhancement path start

Primary objective:

- establish enhancement request flow
- establish image placement flow

Must leave with:

- backend can at least trigger image insertion and track it

### Day 2: Rich Outputs, Memory, And Proactivity

#### Block 5: Enhancement completion

Primary objective:

- complete poster-generation and placement path
- add soft replacement behavior if possible

Must leave with:

- full enhancement end-to-end

#### Block 6: HTML/widget output

Primary objective:

- support one HTML widget type

Must leave with:

- one interactive output path working end-to-end

#### Block 7: Session state and memory

Primary objective:

- track active outputs and recent tutor actions

Must leave with:

- orchestrator knows enough to avoid obvious repetition

#### Block 8: Digests and proactive triggers

Primary objective:

- build canvas digest MVP
- build at least one gesture intent trigger if possible
- implement trigger policy and cooldowns

Must leave with:

- the tutor can proactively react to meaningful session changes

## Resource Map

Use these docs while implementing:

- `docs/proactive-tutor-system.md`
  Main architecture and product behavior reference.

- `docs/adk-live-integration.md`
  Main ADK Live constraints and implications.

- `PROACTIVE_TUTOR_ARCHITECTURE.md`
  Earlier working architecture note for cross-checking ideas discussed earlier.

- tldraw AI docs
  Useful for:
  - canvas-as-output patterns
  - AI agent interpretation patterns
  - image and HTML output placement

- official ADK Live docs
  Useful for:
  - `send_content()`
  - `send_realtime()`
  - `run_live()`
  - event semantics
  - tool execution
  - long-running tools

## Practical Guidance For The Next Two Days

### Stay Ruthless About Boundaries

Do not let:

- flashcards turn into a general study engine
- enhancement turn into arbitrary full-canvas redesign
- HTML output turn into unconstrained app generation

Keep each story narrow enough to finish while preserving the long-term architecture.

### Keep The Orchestrator Clean

The voice agent should remain:

- the only strategic session brain
- the place where memory is coordinated
- the place where tool choices are made

Do not let frontend state or specialist workers become shadow orchestrators.

### Preserve Structured Contracts

Whenever implementation gets fast and messy, the easiest shortcut will be sending freeform strings between layers.

Avoid that if possible.

Typed contracts are what will keep the product coherent as features stack up quickly.

### Proactivity Comes Last For A Reason

Do not rush proactivity before:

- tools work
- outputs render
- memory exists

Otherwise the tutor will proactively talk about things it cannot meaningfully do.

## Can This Be Done In Two Days?

Yes, I think it is possible to make major progress across the full system in two days with focused execution and real grit.

The important condition is that the work must stay sequenced:

- capability first
- rendering and execution next
- memory and interpretation next
- proactivity last

If the work stays on those rails, you can build a surprising amount very quickly because:

- the live voice baseline already exists
- ADK Live already gives us the core streaming and tool execution model
- the repo already contains useful tldraw and gesture groundwork

The risk is not ambition itself. The risk is letting the system become incoherent while moving fast.

This document is meant to prevent that.

## Summary

The right implementation order is:

- define everything the tutor can do
- make those capabilities produce visible outputs
- make the tutor remember what happened
- make the system understand the environment
- then make the tutor proactive

That is the cleanest path from the current repo state to the full proactive ThinkSpace system discussed so far.
