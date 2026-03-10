# Proactive Tutor Architecture

## Status

This document captures the current high-level architecture direction for ThinkSpace's interactive proactive tutor agent.

This is a planning and alignment document, not an implementation spec. The system described here is the intended target architecture based on the current discussion. Large parts of it are not built yet.

## Goal

Build a single interactive tutor system where:

- the voice agent is the main orchestrator and session brain
- the canvas agent is a specialist subagent, not a peer orchestrator
- the frontend is the execution and rendering surface
- the backend owns orchestration, tool calling, and session-level semantic state
- the agent can become context-aware and proactive based on meaningful environment changes

The core product idea is that the tutor should understand what the user is doing across the canvas, gestures, and study surfaces, then decide when to speak, when to stay silent, when to call tools, and when to update the UI.

## Current State

The codebase currently contains useful boilerplate and partial building blocks, but not the final intended system.

What exists today at a high level:

- a websocket-based live voice agent path between frontend and backend
- a tldraw canvas agent starter-kit style implementation on the frontend
- browser-side gesture runtime and debug surfaces
- a sidebar and notch-like UI that can represent agent activity

What is not yet built in the intended form:

- the voice agent as the true top-level orchestrator
- backend-owned tool calling for ThinkSpace-specific actions
- structured frontend action contracts for flashcards, canvas enhancement, images, and HTML outputs
- a unified environment interpreter that turns raw app activity into semantic tutor context
- proactive behavior policy based on meaningful environment changes

## Core Architecture

The intended architecture has five main layers.

### 1. Voice Orchestrator

The websocket voice agent is the single session brain.

It should own:

- conversation state
- tutoring strategy
- session memory
- context awareness across modalities
- proactivity decisions
- tool selection
- coordination of specialist subagents

It should not directly render UI or directly manipulate frontend components through natural language.

### 2. Environment Interpreter

A deterministic app layer should observe raw signals and convert them into semantic events and summaries for the orchestrator.

Inputs may include:

- canvas changes
- screenshots
- viewport changes
- gesture intent and gesture state
- flashcard state changes
- user speech activity
- agent speech activity
- active jobs
- recent user actions
- recent agent actions

This layer is critical because the agent should become proactive based on meaning, not on raw low-level events.

### 3. Tool Router

The voice agent should call typed tools representing domain actions.

Examples:

- flashcard creation and control
- canvas enhancement
- image generation plus placement
- HTML widget generation plus placement
- link or embed insertion

These tools should be semantic and domain-level rather than low-level UI commands.

### 4. Specialist Executors

Specialist subagents or executors carry out narrower tasks.

Examples:

- canvas subagent
- flashcard content subagent
- poster or concept-visual generation subagent
- HTML widget or chart generation subagent

The orchestrator delegates to them and remains the single coordinator.

### 5. Frontend Execution Surface

The frontend should be the renderer and executor for structured actions.

It should:

- display flashcards
- insert images on the canvas
- insert HTML outputs on the canvas
- show job and thinking states in the notch
- acknowledge whether actions were applied successfully

The frontend should not be the source of truth for tutoring semantics. It is the interaction and rendering surface.

## Agent Hierarchy

The target hierarchy is:

- voice agent = top-level orchestrator
- canvas agent = subagent for canvas work
- flashcard subagent = content producer
- image subagent = visual asset producer
- HTML/widget subagent = interactive visual producer

The important design decision is that there should be one tutor mind, not multiple competing agent brains with separate memory and strategy.

The tldraw canvas agent should become a specialist worker that receives a comprehensive prompt from the voice orchestrator and begins work immediately.

## Main Interaction Model

The intended interaction loop is:

1. The user acts in the environment through speech, canvas work, gestures, or study interaction.
2. The environment interpreter converts raw events into semantic context.
3. The orchestrator receives meaningful updates.
4. The orchestrator decides whether to speak, stay silent, or call a tool.
5. A tool may delegate work to a specialist subagent.
6. The backend emits a structured frontend action if UI or canvas output is needed.
7. The frontend executes the action and returns status.
8. The orchestrator updates session state and decides the next step.

## `send_content()` vs `send_realtime()`

The distinction between these two channels is central to the system design.

### `send_realtime()`

Use `send_realtime()` for perceptual or media-like inputs.

Examples:

- audio chunks
- screenshots
- raw image payloads
- other live sensory inputs in the future

Conceptually:

- `send_realtime()` means: see or hear this

### `send_content()`

Use `send_content()` for semantic updates that should force the orchestrator to reason.

Examples:

- `User wants to enhance the canvas`
- `Canvas Digest`
- `Flashcards completed with repeated mistakes on recursion`
- `Canvas subagent finished work`
- `The user reorganized the diagram and is now idle`

Conceptually:

- `send_content()` means: you must now think about this

This is the main lever for proactive behavior.

### Guiding Principle

`send_content()` should be used selectively.

If overused, the agent will become noisy and overly reactive. The system should not force a reasoning turn for every low-level change.

## Proactivity

The tutor should be proactive when there is a meaningful context shift, not merely when any event occurs.

### Good Moments For Proactivity

- a large semantic change in the canvas
- a stable gesture intent that clearly signals user desire
- a flashcard milestone or study-state transition
- a completed subagent job that changes what the user should see next
- a topic shift
- a meaningful pause after active work
- a digest window that contains important new information

### Bad Moments For Proactivity

- while the user is actively speaking
- while the user is in the middle of drawing or dragging
- on every tiny canvas change
- on gesture jitter
- when the change was caused by the agent itself and does not need explicit memory surfacing
- when there is no new decision to make

### Event-Driven First, Timer-Driven Second

The recommended policy is:

- event-driven proactivity first
- periodic digest reasoning second

Potential cadence ideas discussed:

- create semantic digests over short windows such as 15 seconds
- only trigger reasoning after a small inactivity window such as 2 seconds
- optionally use a longer heartbeat window such as 30 seconds for reorientation

Timers should not be the primary trigger. Meaningful state transitions should be.

## Digests

The digest concept is central to context-awareness.

### Canvas Digest

A `Canvas Digest` can summarize the current state and recent changes in a form useful to the orchestrator.

Potential fields:

- summary of current canvas state
- changes since previous digest
- user-originated changes
- agent-originated changes
- whether proactive reasoning should trigger
- current screenshot
- previous screenshot when comparison matters
- important new primitives added
- target region or viewport focus

### Session Digest

Longer term, it may be better to think in terms of a unified `Session Digest` that contains:

- canvas digest
- gesture digest
- flashcard digest
- active jobs
- recent user speech state
- recent agent speech state

This would give the voice agent a single semantic package describing the learning environment.

## Tool Calling Philosophy

The orchestrator should call semantic domain tools, not low-level UI operations.

Good examples:

- `flashcards.create_set`
- `flashcards.show_set`
- `flashcards.flip`
- `flashcards.next`
- `canvas.delegate_task`
- `canvas.enhance_to_poster`
- `canvas.insert_image_output`
- `canvas.insert_html_output`
- `canvas.insert_link_card`

Avoid exposing raw frontend mechanics directly to the main tutor model if a higher-level domain tool can express the intent more clearly.

## Frontend Action Contract

The backend should communicate with the frontend through structured action requests, not freeform model prose.

This should become a common contract used across flashcards, image placement, HTML widgets, and canvas enhancement.

Each action should ideally support:

- `type`
- `request_id`
- `job_id` for long-running actions when needed
- payload
- lifecycle status such as `started`, `applied`, `failed`, or `dismissed`

The frontend should return execution results back to the backend so the orchestrator can update memory and decide the next step.

## Flashcards

Flashcards should be simple and tightly scoped in the first version.

### Intended Flow

1. The voice agent decides flashcards are useful.
2. It tool-calls a flashcard subagent to generate card content.
3. The tool returns structured flashcard data.
4. The backend sends a structured frontend action to show the generated flashcards.
5. The frontend renders the flashcard UI.
6. The voice agent retains the semantic card-set state in session memory.
7. The voice agent can later control the flashcards through more tool calls.

### Important Principle

The frontend owns rendering state, but the orchestrator should still know the semantic study state.

That may include:

- flashcard set id
- card contents
- current card index
- flipped or not flipped
- possibly later, performance summary

### Initial Flashcard Tool Surface

The simplest useful set discussed is:

- `flashcards.create_set`
- `flashcards.show_set`
- `flashcards.flip`
- `flashcards.next`
- `flashcards.previous`
- `flashcards.hide`

The goal is to keep the first version simple and controllable.

## Image Output

Image output is a separate capability from direct canvas editing.

The intended pattern is:

1. The voice orchestrator decides an image would help.
2. It tool-calls an image-generation subagent.
3. The backend receives the generated image plus metadata.
4. The backend emits a structured frontend action to insert that image into the canvas.
5. The frontend places the image.
6. The orchestrator updates memory and decides what to say next, if anything.

### Separation Of Concerns

It may be better to separate:

- visual asset generation
- placement reasoning

This gives better control than asking one subagent to both design the image and fully reason about canvas layout.

## Enhance Canvas

`Enhance canvas` does not mean ordinary shape cleanup.

The intended meaning is:

- read a rough hand-drawn diagram or flowchart
- infer the concept and what the user was trying to express
- generate a polished visual artifact
- place that polished artifact back into the canvas as an enhanced result

Examples:

- rough flowchart to concept poster
- messy concept sketch to polished educational visual
- hand-drawn system diagram to clean explanatory artifact

### Why This Matters

This makes `enhance canvas` a transformation workflow, not just a direct manipulation workflow.

It is closer to:

- understand the rough visual thinking
- synthesize a better teaching artifact
- return it to the canvas

### Recommended First Output Type

For the first version, the enhanced result should usually be an image shape.

That is:

- simpler to generate and place
- visually stable
- well suited for concept posters and polished explanatory visuals

### Replacement Modes

There are several possible behaviors:

- true replacement
- soft replacement
- side-by-side enhancement

A safer initial version is soft replacement, where the original work is preserved in some form rather than being aggressively destroyed.

## HTML Output

HTML output should be treated as a separate tool family from static image output.

It is especially useful for things that are inherently interactive or data-driven.

Examples:

- graphs
- charts
- simulations
- calculators
- interactive explainers
- timelines
- sortable tables
- reference panels
- mini learning widgets

### Static vs Interactive Output Families

The system should distinguish two broad output families.

#### Static Visual Outputs

Best for:

- concept posters
- polished summaries
- replacement visuals
- study sheets
- generated illustrations

These should usually be rendered as image shapes.

#### Interactive HTML Outputs

Best for:

- things the user should manipulate or inspect
- charts and graphs
- small visual tools
- embedded explanations with interaction

These should be rendered as embed or custom preview shapes.

### Decision Rule

At a high level:

- use image output when the goal is polish, summarize, or beautify
- use HTML output when the goal is explore, compare, simulate, or interact

## Relation To Tldraw AI Patterns

The tldraw AI documentation aligns well with the intended ThinkSpace direction.

### `AI agents`

This pattern is useful for understanding the canvas by combining:

- screenshots
- structured shape data
- selection
- recent actions
- chat or session history

This helps the system infer what the rough canvas means.

### `Canvas as output`

This pattern is useful for placing generated artifacts back into the canvas.

That includes:

- generated images
- embeds
- custom HTML preview shapes

This is particularly relevant for:

- concept posters
- visual summaries
- charts
- graphs
- mini interactive explainers

### Combined Pattern

ThinkSpace should not choose between these two patterns.

The intended system should combine them:

- use AI-agent style context gathering to understand the canvas
- use canvas-as-output style rendering to return polished artifacts to the user

## Notch And UX States

The notch or dynamic island is useful for representing orchestration state during tool calls and subagent work.

Potential high-level states include:

- listening
- reasoning
- tool-starting
- subagent-working
- waiting-for-frontend-apply
- speaking
- idle

This is especially important because many tool-driven actions will not produce an immediate verbal answer but should still feel responsive.

## Recommended Design Principles

- one tutor brain: the voice agent
- typed tools only
- frontend actions should be structured, not inferred from prose
- the frontend is the renderer and executor, not the tutor brain
- the backend should preserve semantic session state
- the environment interpreter should convert low-level activity into meaning
- proactivity should be based on meaningful state changes
- the canvas agent should be a specialist worker
- image and HTML outputs should be treated as separate tool families
- flashcards should start simple

## Open Questions

The following questions remain important for later design and implementation.

### Tool Granularity

Should the voice agent call:

- very high-level tools such as `teach_with_flashcards` or `enhance_canvas_for_clarity`

or:

- lower-level domain tools such as `create_flashcards`, `show_flashcards`, `insert_image_output`, `delegate_canvas_task`

Current leaning:

- prefer lower-level domain tools with a strong orchestrator

### Enhancement Intent

When the user asks to enhance the canvas, should the system produce:

- a polished summary of exactly what is already there
- a richer teaching visual that adds explanatory detail
- a hybrid of both

Current leaning:

- enhancement should usually produce a richer teaching artifact, not merely a cosmetic redraw

### HTML Widget Scope

For the first version of HTML outputs, should the system produce:

- self-contained sandboxed widgets

or:

- more complex hosted mini-apps

Current leaning:

- start with self-contained HTML widgets

### Shared Contract Location

The eventual implementation will likely need a shared backend-frontend action schema describing:

- action types
- payloads
- lifecycle statuses
- acknowledgements
- job semantics

That schema will become a key integration boundary in the system.

## Summary

The target ThinkSpace system is a proactive multimodal tutor where:

- the voice agent is the orchestrator
- the canvas agent and other generators are specialist subagents
- the backend owns orchestration and semantic state
- the frontend renders structured actions
- `send_content()` is the main trigger for proactive reasoning
- `send_realtime()` carries perceptual media inputs
- `enhance canvas` is a transformation into polished visual output
- HTML outputs are a separate family for interactive educational artifacts

This document should serve as a shared reference while the actual implementation plan, contracts, and code are designed.
