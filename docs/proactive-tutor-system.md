# Proactive Tutor System

## Purpose

This document captures the intended target architecture for ThinkSpace's interactive proactive tutor. It is a shared reference for future design and implementation work across the frontend and backend.

This is not a low-level API contract or a coding task breakdown. It is the system-level reference for:

- the main agent hierarchy
- the tutoring interaction model
- environment awareness
- proactivity behavior
- tool calling strategy
- frontend execution patterns
- output types such as flashcards, polished image outputs, and HTML widgets

## Status

This is a target architecture document.

The repository currently contains useful boilerplate and partial building blocks, but the full system described here is not yet implemented.

Current code provides:

- a live websocket-based voice agent path
- a tldraw canvas agent starter pattern
- gesture runtime plumbing
- a sidebar and notch-like live-agent UI

What is still to be designed and implemented:

- the voice agent as the actual top-level orchestrator
- ThinkSpace-specific tool calling from the backend
- frontend action contracts for rendered outputs
- app-level semantic context interpretation
- reliable proactive behavior policy
- subagent job lifecycle handling

## High-Level Product Goal

ThinkSpace should feel like a single multimodal tutor that:

- listens to the user
- watches the learning environment
- understands canvas activity
- understands gestures
- can produce teaching surfaces like flashcards, posters, charts, and widgets
- proactively helps when the context calls for it

The experience should not feel like multiple disconnected agents bolted together. It should feel like one tutor with multiple capabilities.

## Core Principles

### One Tutor Brain

There should be one top-level tutor brain for the session: the voice agent.

That voice agent owns:

- the conversation
- session memory
- tutoring strategy
- context awareness
- proactivity
- tool selection
- coordination of specialist workers

### Specialists, Not Competing Minds

Other agents should exist as specialists, not peer orchestrators.

Examples:

- canvas subagent
- flashcard content subagent
- image generation subagent
- HTML widget subagent

These specialists carry out focused work after being delegated to by the voice orchestrator.

### Structured Actions Over Freeform UI Commands

The model should not directly control the frontend through natural-language instructions.

Instead:

- the orchestrator calls semantic tools
- tools return structured outputs
- the backend emits typed frontend actions
- the frontend renders or applies them deterministically

### Meaning Before Motion

The system should react to semantic meaning, not just raw low-level events.

For example:

- not every shape change should trigger the tutor
- not every gesture frame should trigger the tutor
- not every pause should trigger the tutor

The system should become proactive when the environment meaningfully changes.

## System Layers

The intended architecture has five main layers.

### 1. Voice Orchestrator

The websocket voice agent is the main session orchestrator.

Its responsibilities:

- keep the session coherent
- decide when to speak and when not to speak
- decide which tools to call
- track ongoing tool and subagent jobs
- maintain semantic memory of what happened
- interpret digests from the app layer

It should not directly mutate the canvas or render widgets itself.

### 2. Environment Interpreter

The environment interpreter is a deterministic app-level layer that turns raw environment activity into semantic tutor context.

This layer should observe:

- canvas changes
- gesture changes
- screenshots
- viewport changes
- flashcard state changes
- job completion events
- user speech activity
- agent speech activity
- explicit user commands

Then it should produce meaningful summaries or signals like:

- `Canvas Digest`
- `Flashcard Digest`
- `Gesture Digest`
- `User wants to enhance the canvas`
- `Canvas subagent completed enhancement`

This layer is essential because it prevents the main tutor from having to reason over noisy raw event streams.

### 3. Tool Router

The tool router exposes semantic capabilities to the voice orchestrator.

These tools should represent learning and canvas domain actions, not raw UI operations.

Examples:

- `flashcards.create_set`
- `flashcards.show_set`
- `flashcards.flip`
- `canvas.enhance_to_poster`
- `canvas.delegate_task`
- `canvas.insert_image_output`
- `canvas.insert_html_output`
- `canvas.insert_link_card`

### 4. Specialist Executors

Specialist executors perform work that is narrower or more intensive than general tutoring reasoning.

Examples:

- interpreting a rough concept sketch and turning it into a polished poster
- generating a flashcard deck
- generating a chart widget
- planning exact canvas placement

These may be implemented as:

- dedicated tools
- subagents
- long-running tool-backed jobs

### 5. Frontend Execution Surface

The frontend is the rendering and execution layer.

It should:

- display flashcards
- render images on the canvas
- render HTML widgets on the canvas
- reflect live activity in the notch
- handle frontend action lifecycle
- return success or failure back to the backend

The frontend should not be the tutor's long-term semantic memory.

## Agent Hierarchy

### Top-Level

- `voice orchestrator`

### Subordinate Specialists

- `canvas agent`
- `flashcard generator`
- `poster generator`
- `widget generator`

### Important Rule

The canvas agent is not a second session brain.

It should receive a comprehensive prompt from the main orchestrator, begin work, and return progress or completion. The tutor decides why that work is happening and how it fits into the larger learning experience.

## Session Memory Model

The orchestrator should remember semantic state, not just chat text.

Important categories of memory:

- recent user intent
- current topic or subtopic
- important canvas concepts already created
- flashcard deck state
- active or completed enhancement jobs
- recent tutor interventions
- current teaching mode

Examples of useful semantic memory:

- current flashcard set id
- current flashcard index
- whether the current card is flipped
- whether a poster was already generated for a region
- whether the user previously rejected a suggestion
- whether a gesture-driven enhancement just happened

This memory is what keeps the tutor coherent over time.

## Interaction Model

The broad intended loop is:

1. The user acts through voice, canvas edits, gestures, or study interaction.
2. Raw app activity is observed by the environment interpreter.
3. The environment interpreter emits meaningful semantic updates.
4. The voice orchestrator reasons over the latest session state.
5. The orchestrator decides whether to speak, stay silent, or call a tool.
6. Tool calls may delegate to specialist workers.
7. The backend emits structured frontend actions when UI or canvas output is needed.
8. The frontend applies those actions and returns status.
9. The orchestrator updates memory and decides the next step.

This is the core loop that should unify the entire system.

## `send_content()` vs `send_realtime()`

This distinction is central to the final product.

### `send_realtime()`

Use `send_realtime()` for perceptual or media-like inputs.

Examples:

- microphone audio
- screenshots
- image frames
- video frames later if needed

Think of this as:

- "see this"
- "hear this"

### `send_content()`

Use `send_content()` for semantic updates that should force a reasoning turn.

Examples:

- `User wants to enhance the canvas`
- `Canvas Digest`
- `Flashcards completed with repeated mistakes`
- `Canvas subagent finished poster generation`
- `User reorganized the diagram and is now idle`

Think of this as:

- "you must reason about this now"

### Design Implication

`send_content()` is the main app-level mechanism for proactive tutor behavior.

`send_realtime()` provides perception. `send_content()` provides meaning.

## Proactivity

The tutor should be proactive when there is a meaningful context shift.

It should not be proactive just because something technically changed.

### Good Moments For Proactivity

- a large semantic canvas change
- a stable gesture that clearly signals intent
- a flashcard milestone or study transition
- a finished subagent job
- a meaningful period of user inactivity after active work
- a topic shift
- a digest window containing important new information

### Bad Moments For Proactivity

- while the user is actively speaking
- while the user is still drawing or dragging
- on every tiny canvas mutation
- on gesture jitter
- while the agent is already in the middle of a useful response
- when there is no new decision to make

### Event-Driven First

The tutor should be proactive based primarily on events and semantic transitions.

Timers can still be useful, but only as secondary support. For example:

- emit digest reasoning every 15 seconds only if something important happened
- wait for 2 seconds of inactivity before triggering a reasoning turn
- use a longer 30-second reorientation window only when appropriate

### Built-In Proactivity vs App Proactivity

Model-native proactive audio is useful, but it should not be the main product-level orchestration mechanism.

Think of the split as:

- built-in proactivity: conversational naturalness
- app-driven `send_content()`: deterministic tutoring triggers

## Digests

Digests are the bridge between raw environment activity and semantic reasoning.

### Canvas Digest

A `Canvas Digest` may include:

- summary of the current canvas state
- important changes since the previous digest
- user-originated changes
- agent-originated changes
- current screenshot
- previous screenshot when comparison matters
- important new primitives added
- current focus region
- whether proactive reasoning should be triggered

### Flashcard Digest

A `Flashcard Digest` may include:

- active deck id
- current card id
- current index
- flipped state
- correctness or performance summary
- whether the user is struggling or progressing

### Gesture Digest

A `Gesture Digest` may include:

- stable gesture intent
- whether the gesture is confidence-worthy
- duration or stability window
- whether it should be interpreted as a command or ignored

### Session Digest

Long term, the most useful model may be a single `Session Digest` that contains:

- canvas digest
- gesture digest
- flashcard digest
- active jobs
- recent user speech state
- recent agent speech state
- recent tutor interventions

This gives the orchestrator one semantic package to reason over.

## Tool Calling Strategy

The orchestrator should call semantic domain tools.

Avoid making the model issue raw canvas or DOM instructions directly when a higher-level tool can represent the intent more clearly.

### Good Tool Examples

- `flashcards.create_set`
- `flashcards.show_set`
- `flashcards.flip`
- `flashcards.next`
- `flashcards.previous`
- `flashcards.hide`
- `canvas.delegate_task`
- `canvas.enhance_to_poster`
- `canvas.insert_image_output`
- `canvas.insert_html_output`
- `canvas.insert_link_card`

### Tool Granularity

Current leaning:

- prefer lower-level domain tools plus a strong orchestrator

That means:

- not one giant `teach_with_flashcards` tool
- not one giant `do_everything_to_canvas` tool

Instead, the tutor should compose behavior out of clearer domain capabilities.

## Frontend Action Contract

The backend should communicate with the frontend through typed action requests.

Each frontend-facing action should ideally include:

- `type`
- `request_id`
- `job_id` when applicable
- payload
- lifecycle status

Common statuses may include:

- `started`
- `applied`
- `failed`
- `dismissed`

The frontend should send result or acknowledgement messages back to the backend so the orchestrator can update memory and decide what to do next.

## Tool-Driven UX States

The notch or dynamic-island style UX is especially useful when tools or subagents are involved.

Useful conceptual states include:

- `idle`
- `listening`
- `reasoning`
- `tool-starting`
- `subagent-working`
- `waiting-for-frontend-apply`
- `speaking`

This helps the system feel responsive even when the next visible output is not an immediate spoken reply.

## Flashcards

Flashcards should be simple and explicit in the first version.

### Intended Flow

1. The voice orchestrator decides flashcards would help.
2. It tool-calls a flashcard content generator.
3. The generator returns structured card content.
4. The backend emits a frontend action such as `flashcards.show_set`.
5. The frontend renders the flashcards.
6. The orchestrator stores semantic deck state in memory.
7. Later, the orchestrator may control the deck with further tool calls.

### Initial Surface

The simplest useful flashcard surface is:

- `create_set`
- `show_set`
- `flip`
- `next`
- `previous`
- `hide`

### Semantic Memory To Track

The orchestrator should remember at least:

- deck id
- ordered cards
- current index
- flipped state

The frontend should render and animate; the orchestrator should remember meaning.

## Image Output

Image output is a first-class tool family separate from direct canvas editing.

### Intended Flow

1. The orchestrator decides an image would help.
2. It tool-calls an image generation specialist.
3. The specialist returns a visual asset and metadata.
4. The backend emits a structured frontend action to place the image.
5. The frontend inserts it on the canvas.
6. The orchestrator updates session memory.

### Separation Of Concerns

It may be useful to separate:

- image generation
- placement reasoning

This gives better control than forcing one worker to both design the asset and perfectly understand canvas layout.

## Enhance Canvas

`Enhance canvas` is not ordinary canvas cleanup.

It means:

- inspect a rough hand-drawn sketch, flowchart, or concept map
- infer what the user was trying to express
- generate a polished educational artifact
- place that artifact back into the canvas

### Examples

- rough flowchart to polished concept poster
- messy concept sketch to educational infographic
- rough system diagram to clear presentation visual

### Why This Is Important

This makes enhancement a transformation workflow, not a shape-editing workflow.

The system is not merely cleaning up strokes. It is:

- understanding rough thinking
- synthesizing a clearer artifact
- returning the artifact to the canvas

### Recommended First Output

For the first version, the enhancement result should usually be a generated image placed as a tldraw image shape.

Why:

- simple to place
- visually stable
- fits the "concept poster" use case well

### Replacement Modes

Possible behaviors:

- true replacement
- soft replacement
- side-by-side enhancement

Current leaning:

- begin with soft replacement or otherwise preserve the original sketch safely

This is more trustworthy during early product development.

## HTML Output

HTML output is a distinct tool family from image output.

It should be used for things that are inherently interactive or data-driven.

### Good HTML Use Cases

- charts
- graphs
- simulations
- calculators
- interactive explainers
- timelines
- sortable tables
- study dashboards
- reference panels

### Output Family Split

#### Static Visual Outputs

Best for:

- concept posters
- polished summaries
- educational illustrations
- replacement visuals

These should usually be image-based.

#### Interactive HTML Outputs

Best for:

- exploration
- manipulation
- simulation
- comparison
- inspecting data

These should be embed or custom-preview based.

### Decision Rule

At a high level:

- use image output for polish, summarization, beautification, and replacement visuals
- use HTML output for interaction, exploration, comparison, and simulation

## Tldraw Alignment

The tldraw AI patterns are a strong fit for ThinkSpace.

### AI Agent Pattern

Useful for understanding the canvas by combining:

- screenshots
- structured shape data
- selection
- recent user actions
- chat or session history

This helps the system interpret rough visual meaning.

### Canvas-As-Output Pattern

Useful for placing generated artifacts back onto the canvas:

- images
- embeds
- HTML previews

ThinkSpace should combine both patterns:

- use agent-style reading to understand
- use canvas-as-output rendering to return polished artifacts

## Suggested Tool Families

These are conceptual families, not finalized APIs.

### `flashcards.*`

- create deck content
- show or hide set
- flip current card
- move next or previous
- possibly grade later

### `canvas.*`

- delegate canvas task
- insert image output
- insert HTML output
- insert link card
- enhance selected region or current focus

### `widget.*`

- build interactive chart
- build graph or simulation
- build study dashboard or panel

### `session.*`

Potential helpers later:

- record digest
- acknowledge job completion
- summarize recent work

## Example End-To-End Flows

### Flow 1: Gesture-Driven Enhance Canvas

1. Gesture system detects a stable gesture such as fist.
2. Environment interpreter classifies it as a semantic intent.
3. App emits `send_content("User wants to enhance the canvas")`.
4. Relevant screenshot or region image may be sent via `send_realtime()`.
5. Voice orchestrator reasons over session context.
6. Voice orchestrator calls `canvas.enhance_to_poster`.
7. Tool returns `started`.
8. Notch shows a working state.
9. Specialist generates the poster and placement metadata.
10. Backend emits structured frontend action to insert the image.
11. Frontend applies the action and acknowledges result.
12. Orchestrator updates memory and optionally narrates outcome.

### Flow 2: Flashcard Generation

1. Tutor decides flashcards would help.
2. Tutor calls `flashcards.create_set`.
3. Flashcard generator produces structured cards.
4. Backend emits `flashcards.show_set`.
5. Frontend displays the set.
6. Orchestrator stores deck state.
7. Later the tutor calls `flashcards.flip` or `flashcards.next`.

### Flow 3: Interactive Graph Or Chart

1. Tutor decides the concept is better explained interactively.
2. Tutor calls a widget or HTML generation tool.
3. Tool returns HTML payload and placement metadata.
4. Backend emits `canvas.insert_html_output`.
5. Frontend renders the widget on the canvas.
6. Orchestrator remembers that the widget exists and can refer to it later.

## Open Questions

### Tool Granularity

Should the tutor mostly compose lower-level domain tools, or should some high-level teaching tools exist?

Current leaning:

- favor lower-level domain tools with a strong orchestrator

### Enhancement Fidelity

Should enhancement:

- preserve only what is already drawn
- expand with richer teaching detail
- combine both

Current leaning:

- combine preservation with additional teaching value

### HTML Widget Scope

Should the first version support:

- self-contained sandboxed widgets
- richer hosted mini-apps

Current leaning:

- start with self-contained sandboxed widgets

### Shared Contract Location

The eventual implementation will likely require a shared schema describing:

- action types
- payloads
- job lifecycle semantics
- acknowledgements

This should become a first-class integration boundary across frontend and backend.

## Development Guidance

When implementation starts, future docs and development cycles should preserve these assumptions:

- voice agent is the only top-level orchestrator
- `send_content()` is the main semantic trigger
- `send_realtime()` is for perceptual inputs
- frontend actions are structured
- output families remain distinct
- proactivity is based on meaningful state transitions
- the environment interpreter is treated as a first-class system component

## Summary

ThinkSpace is heading toward a proactive multimodal tutor where:

- the voice agent is the orchestrator
- specialist subagents perform focused work
- the backend owns semantic session state and tool calling
- the frontend renders structured outputs
- flashcards, enhanced posters, images, and HTML widgets are all tool-driven surfaces
- proactivity is governed by app semantics rather than raw event noise

This document should serve as the shared product-and-architecture reference for future design and implementation work.
