# Image Output And Enhancement Scratchpad

## Purpose

This is the tactical working pad for Story Group E.

It exists to scope and sequence image-output and enhancement work before coding,
using the proven live-tool integration pattern now documented in
`docs/gemini-live-tool-integration-reference.md`.

This scratchpad is intentionally more implementation-facing than
`docs/implementation-stories.md`.

## Current Goal

E1 is now implemented enough to validate the first full canvas-output loop.

The current goal is to treat this scratchpad as the execution reference for the
completed E1 slice and the handoff point into **Story E2: enhancement
planning**.

The completed objective of E1 is:

- add one long-running visual-generation tool
- show a lightweight loading toast while the job is running
- insert one static visual artifact into the canvas
- use the same typed tool/action/ack loop as flashcards
- keep placement simple and deterministic

## Anchor Docs

This scratchpad should be read together with:

- `docs/gemini-live-tool-integration-reference.md`
- `docs/agent-tool-catalog.md`
- `docs/tool-result-contract.md`
- `docs/frontend-action-contract.md`
- `docs/implementation-stories.md`

## Why E1 Comes First

E1 is the smallest image/canvas slice that proves the full loop:

1. agent calls tool
2. backend accepts a long-running job
3. backend finishes with a typed frontend action
4. frontend inserts the artifact
5. frontend acknowledges completion
6. backend sends one semantic completion update back to Gemini Live

This is the same architecture that flashcards validated, adapted for canvas
output instead of deck control.

## Locked E1 Scope

### In scope

- one orchestrator-facing tool: `canvas.generate_visual`
- one generic canvas loading toast action: `canvas.job_started`
- one typed frontend action: `canvas.insert_visual`
- one static visual artifact inserted into the canvas
- one internal planner that receives hybrid canvas context
- one internal visual generator
- one placement executor with simple viewport-based insertion
- one selective semantic completion update after insertion succeeds

### Out of scope

- `canvas.enhance`
- `canvas.generate_widget`
- `canvas.delegate_task`
- replacing or editing existing canvas visuals
- open-ended relayout or cleanup of the board
- full tldraw-agent delegation
- complex spatial reasoning
- durable background job infrastructure
- rich progress streaming
- multiple insertion strategies

## Locked E1 Product Behavior

The intended user-visible behavior is:

1. learner asks for a helpful visual, or the tutor decides a visual would help
2. orchestrator calls `canvas.generate_visual`
3. backend accepts the job
4. planner decides what visual to generate and a simple placement intent
5. visual generator produces a static image artifact
6. backend emits a completed result with `frontend_action: canvas.insert_visual`
7. frontend inserts the image into the canvas
8. frontend sends `frontend_ack`
9. backend sends one semantic update such as:
   - "The visual is now inserted on the canvas."
10. the agent can then talk about the inserted visual from confirmed UI state

## Locked E1 Execution Shape

`canvas.generate_visual` remains one orchestrator-facing tool, but its internal
execution shape is:

- planner
- visual generator
- placement executor

### Planner responsibilities

- understand why a visual is needed
- turn tutoring intent into a visual brief
- inspect hybrid canvas context
- choose a simple placement intent

### Visual generator responsibilities

- generate the static artifact
- return a stable asset reference

### Placement executor responsibilities

- convert placement intent into deterministic insertion metadata
- keep v1 simple and viewport-based

## Canvas Context Direction

The planner should receive the same hybrid style of context already discussed for
canvas-aware execution.

The intent is to align with the same primitives used by the tldraw agent path,
not to invent a screenshot-only model.

Current reference primitives remain:

- `frontend/client/parts/ScreenshotPartUtil.ts`
- `frontend/client/parts/BlurryShapesPartUtil.ts`
- `frontend/client/parts/SelectedShapesPartUtil.ts`
- `frontend/client/parts/AgentViewportBoundsPartUtil.ts`
- `frontend/client/parts/PeripheralShapesPartUtil.ts`

For E1, this context should inform planning, but not explode into a complicated
coordinate-selection system.

## E1 Contract Direction

## Tool

- `canvas.generate_visual`

### Recommended model-facing input shape

Keep the first version small.

Recommended shape:

- `prompt: string`
- `title_hint?: string`
- `visual_style_hint?: string`
- `aspect_ratio_hint?: string`
- `placement_hint?: string`

Do not expose:

- low-level canvas IDs as required arguments
- frontend-specific placement fields

The orchestrator should describe the teaching need, not final pixel geometry.
It may also provide:

- an aspect-ratio hint shared by both image generation and placement planning
- an optional semantic placement hint for the placement planner

## Tool Result Envelope

Use the shared v1 envelope:

- `status`
- `tool`
- `job?`
- `summary?`
- `payload?`
- `frontend_action?`

### Accepted result

Recommended meaning:

- job accepted
- background placement planning and image generation have started
- a lightweight canvas loading toast can be shown

Recommended example:

```json
{
  "status": "accepted",
  "tool": "canvas.generate_visual",
  "job": { "id": "visual-123" },
  "summary": "Starting visual generation for the requested teaching artifact",
  "payload": {
    "prompt": "Create a labeled diagram of the human heart",
    "visual_style_hint": "diagram",
    "aspect_ratio_hint": "4:3",
    "placement_hint": "viewport_right"
  },
  "frontend_action": {
    "type": "canvas.job_started",
    "source_tool": "canvas.generate_visual",
    "job_id": "visual-123",
    "payload": {
      "title": "Creating visual",
      "message": "Generating a teaching visual for the canvas"
    }
  }
}
```

### Completed result

Recommended meaning:

- visual artifact generated successfully
- ready for deterministic insertion using planned bounded geometry

Recommended example:

```json
{
  "status": "completed",
  "tool": "canvas.generate_visual",
  "job": { "id": "visual-123" },
  "summary": "Generated the requested visual and prepared it for canvas insertion",
  "payload": {
    "artifact_id": "visual-123",
    "title": "Human Heart Overview",
    "placement": {
      "x": 1280,
      "y": 240,
      "w": 960,
      "h": 720
    }
  },
  "frontend_action": {
    "type": "canvas.insert_visual",
    "source_tool": "canvas.generate_visual",
    "job_id": "visual-123",
    "payload": {
      "artifact_id": "visual-123",
      "image_url": "https://example.invalid/assets/visual-123.png",
      "title": "Human Heart Overview",
      "caption": "Labeled overview of the heart's main structures",
      "x": 1280,
      "y": 240,
      "w": 960,
      "h": 720
    }
  }
}
```

### Failed result

Recommended meaning:

- planning or generation failed
- nothing should be inserted into the canvas

Recommended example:

```json
{
  "status": "failed",
  "tool": "canvas.generate_visual",
  "job": { "id": "visual-123" },
  "summary": "Visual generation failed"
}
```

## Frontend Action Direction

### Generic loading action

- `canvas.job_started`

Recommended first-cut payload:

- `title`
- `message`

### Action type

- `canvas.insert_visual`

### Recommended payload shape

Lock the first-cut payload to:

- `artifact_id`
- `image_url`
- `title`
- `caption?`
- `x`
- `y`
- `w`
- `h`

### Placement hint vocabulary for E1

Keep this deliberately tiny.

Locked recommendation:

- `auto`
- `viewport_center`
- `viewport_right`
- `viewport_left`
- `viewport_top`
- `viewport_bottom`

Possible later additions, but not part of the initial lock:

- `below_selection`

### Default placement behavior

If no strong placement cue is provided, the placement planner should:

- inspect the current viewport context
- choose a bounded `x/y/w/h` region inside the current viewport
- minimize overlap with existing visible content while keeping the image useful

### Why this should stay compact

Placement complexity is one of the easiest ways to overengineer this story.

E1 should prove a strong bounded-placement path without solving all board-layout
intelligence.

## Placement Planner Direction

The placement planner should reuse the same hybrid bounded context style already
used by the tldraw canvas agent.

Recommended serialized context packet:

- `screenshot`
- `userViewportBounds`
- `agentViewportBounds`
- `blurryShapes`
- `peripheralShapes`
- `selectedShapes`
- optionally `canvasLints`

Important design direction:

- do not invent a new screenshot-only placement model
- do not ask the orchestrator to provide final geometry
- do reuse the same prompt-part semantics already trusted by the tldraw path

### Placement planner output shape

Recommended first-cut output:

- `x`
- `y`
- `w`
- `h`
- optional `reason`

This means the planner returns final bounded geometry rather than only a coarse
semantic intent.

## Semantic Completion Direction

Use the same principle that worked for flashcards:

- do not gate the raw ADK stream
- do not send semantic updates for every small frontend event
- send one semantic update only after insertion is confirmed

Recommended semantic completion text:

- "The visual is now inserted on the canvas."

Optional addition if helpful:

- include the inserted title

Recommended richer form:

- "The visual is now inserted on the canvas. Title: Human Heart Overview."

## Backend State Direction

E1 should avoid heavy backend session state.

Recommended backend state shape:

- reuse the lightweight per-session async job outbox pattern
- do not add a large canvas artifact session store yet

Rationale:

- insertion is one-shot
- there is no active control loop like flashcards
- the frontend and tldraw become the source of truth after insertion

Only add backend-owned canvas artifact state later if a real follow-up use case
demands it.

## Phase 1: Contract Locking

This is the current active phase.

### Goal

Lock the exact contract and execution semantics for E1 before implementation.

### What must be decided now

1. orchestrator-facing tool input shape
2. accepted/completed/failed result examples
3. generic loading-toast payload shape
4. `canvas.insert_visual` payload shape
5. placement hint vocabulary for v1
6. placement-planner context packet and output shape
7. semantic completion text after successful insertion

### What should not be done yet

- real image generation
- backend worker code
- frontend insertion code
- tldraw integration details
- coordinate math

### Done means

- docs reflect one agreed E1 shape
- implementation can proceed mechanically from the docs

## Proposed Implementation Phases After Phase 1

## Phase 2: Backend Tool Skeleton

Goal:

- get `canvas.generate_visual` flowing end to end with a stub artifact first

Tasks:

- register the tool
- allocate job id
- return `accepted`
- finish later through the async outbox
- emit `canvas.insert_visual` using a placeholder asset

Done means:

- the tool loop works without real generation

## Phase 3: Frontend Insert Path

Goal:

- make `canvas.insert_visual` place an image into the canvas and send ack

Tasks:

- extend frontend typing
- implement deterministic canvas insertion
- send `frontend_ack`

Done means:

- a placeholder visual appears in the canvas through the typed action path

## Phase 4: Planner And Canvas Context

Goal:

- replace hardcoded stub metadata with planner output

Tasks:

- define placement-planner input schema
- gather hybrid canvas context
- have the placement planner emit bounded `x/y/w/h`

Done means:

- E1 becomes canvas-aware without becoming overcomplicated

## Phase 5: Real Visual Generation

Goal:

- replace the placeholder with real image generation

Tasks:

- integrate real image generation backend path
- preserve the already-locked frontend action contract
- keep placement path unchanged

Done means:

- the only thing changing is artifact production, not the transport pattern

## Risks To Control

### 1. Mixing E1 with enhancement

Avoid by keeping `canvas.enhance` fully out of the first implementation slice.

### 2. Overbuilding placement

Avoid by keeping the placement hint vocabulary small while still letting the
planner choose final bounded geometry.

### 3. Introducing too much backend canvas state

Avoid by keeping E1 one-shot and artifact-insertion focused.

### 4. Letting the orchestrator describe placement mechanics directly

Avoid by keeping placement inside the internal planner/executor path.

### 5. Adding a second transport model

Avoid by reusing the exact tool/action/ack pattern from the Gemini Live
integration reference.

## Open Questions To Confirm Before Coding

These are the final decisions worth explicitly confirming before implementation:

1. Which semantic placement hints do we want in the first cut?
2. Should accepted-state UX remain silent, or do we want a lightweight visual
   loading affordance now?
3. Should the semantic completion update include only confirmation, or
   confirmation plus inserted title?
4. Do we want the initial tool input shape to be only:
   - `prompt`
   - `title_hint?`
   - `visual_style_hint?`
   - `aspect_ratio_hint?`
   - `placement_hint?`

## Current Recommendation

If we want to stay disciplined and avoid overengineering, the recommended lock is:

- one tool: `canvas.generate_visual`
- one loading action: `canvas.job_started`
- one action: `canvas.insert_visual`
- the orchestrator provides the full visual brief
- image generation and placement planning run in parallel
- the orchestrator may provide `aspect_ratio_hint` and `placement_hint`
- the placement planner reuses the same hybrid bounded context style as the
  tldraw canvas agent
- the placement planner returns final bounded `x/y/w/h`
- a lightweight toast-style loading affordance at accept time
- one semantic completion update after successful ack
- no extra backend canvas session store

That is the cleanest first slice.

## Refined E1 Implementation Plan

This section is the implementation reference for the refined
`canvas.generate_visual` direction that was locked after the first working E1
slice.

### Refined Direction

- the orchestrator provides the full visual brief
- `aspect_ratio_hint` should be treated as a required semantic input
- `placement_hint` remains optional semantic steering
- image generation and placement planning should run in parallel
- the placement planner should reuse the same hybrid bounded context style as
  the tldraw canvas agent
- the placement planner should return final bounded `x/y/w/h`
- the frontend should execute the returned geometry directly

### Phase 1: Contract Lock

Goal:

- lock the refined tool input and exact-geometry output contract

Scope:

- `canvas.generate_visual` input becomes:
  - `prompt`
  - `aspect_ratio_hint`
  - `title_hint?`
  - `visual_style_hint?`
  - `placement_hint?`
- `canvas.insert_visual` output becomes:
  - `artifact_id`
  - `image_url`
  - `title`
  - `caption?`
  - `x`
  - `y`
  - `w`
  - `h`

Done means:

- docs reflect the refined contract
- no implementation ambiguity remains about semantic input vs final geometry

### Phase 2: Frontend Placement Context Builder

Goal:

- build one reusable frontend helper that produces the placement-planner context
  packet from the live editor

Implementation direction:

- add a helper such as
  `frontend/client/canvas/buildPlacementPlannerContext.ts`
- reuse existing logic from:
  - `frontend/client/parts/ScreenshotPartUtil.ts`
  - `frontend/client/parts/UserViewportBoundsPartUtil.ts`
  - `frontend/client/parts/AgentViewportBoundsPartUtil.ts`
  - `frontend/client/parts/BlurryShapesPartUtil.ts`
  - `frontend/client/parts/PeripheralShapesPartUtil.ts`
  - `frontend/client/parts/SelectedShapesPartUtil.ts`
  - optionally `frontend/client/parts/CanvasLintsPartUtil.ts`

Context packet shape:

- `screenshot`
- `userViewportBounds`
- `agentViewportBounds`
- `blurryShapes`
- `peripheralShapes`
- `selectedShapes`
- optionally `canvasLints`

Done means:

- the frontend can produce a plain JSON placement-context packet on demand

### Phase 3: Placement Context Transport

Goal:

- send the placement-context packet to the backend without bloating the
  orchestrator-facing tool schema

Implementation direction:

- frontend sends an app-level websocket message such as:
  - `type: "canvas_context"`
  - `context: { ...placement context packet... }`
- backend stores the latest context per `user_id + session_id`

Files likely involved:

- `frontend/client/hooks/useAgentWebSocket.ts`
- `frontend/client/pages/SessionCanvas.tsx`
- `backend/app/main.py`
- new lightweight store module such as
  `backend/app/thinkspace_agent/tools/canvas_context_store.py`

Done means:

- the backend can look up the latest placement context for the active session

### Phase 4: Refine Tool Schema

Goal:

- update the tool signature to the refined model-facing contract while keeping
  the current end-to-end loop intact

Implementation direction:

- update `backend/app/thinkspace_agent/tools/canvas_visuals.py`
- require `aspect_ratio_hint`
- keep `placement_hint` optional
- accepted payload should include:
  - `prompt`
  - `aspect_ratio_hint`
  - `title_hint?`
  - `visual_style_hint?`
  - `placement_hint?`

Done means:

- the orchestrator-facing contract is correct
- existing visual generation still works

### Phase 5: Placement Planner

Goal:

- add a backend placement planner that returns exact bounded geometry

Implementation direction:

- extend `backend/app/thinkspace_agent/tools/canvas_visual_jobs.py`
- add a placement planner schema, for example:
  - `x`
  - `y`
  - `w`
  - `h`
  - `reason?`
- build a dedicated placement-planner prompt
- planner inputs should be:
  - `prompt`
  - `aspect_ratio_hint`
  - `placement_hint`
  - placement-context packet

Planner prompt requirements:

- use current viewport context
- minimize overlap with visible content
- keep composition useful and legible
- respect the requested aspect ratio
- honor semantic placement hints when reasonable
- return exact bounded `x/y/w/h`

Done means:

- backend can compute planned geometry independently of image generation

### Phase 6: Run Planner And Image Generation In Parallel

Goal:

- upgrade the job runtime so placement planning and image generation happen
  concurrently

Implementation direction:

- in `backend/app/thinkspace_agent/tools/canvas_visuals.py`
- load the latest placement context from the session store
- run:
  - image generation task
  - placement planner task
- merge both results into one completed tool result

Completed result should contain:

- artifact metadata
- planned geometry
- `frontend_action: canvas.insert_visual`

Fallback rule:

- if no context exists, use a conservative fallback placement path
- log that the planner had to degrade

Done means:

- backend emits exact geometry rather than only a placement intent

### Phase 7: Frontend Geometry Execution

Goal:

- make the frontend apply backend-planned geometry directly

Implementation direction:

- update `frontend/client/types/agent-live.ts`
- update `frontend/client/pages/SessionCanvas.tsx`
- `canvas.insert_visual` payload should be normalized as:
  - `x`
  - `y`
  - `w`
  - `h`
- remove the current viewport-center insertion math from the executor

Done means:

- frontend becomes a thin deterministic executor for planned image placement

### Phase 8: Prompt And Policy Alignment

Goal:

- align the orchestrator instructions with the refined tool contract

Implementation direction:

- update `backend/app/thinkspace_agent/instructions/tool_policy.md`
- update `backend/app/thinkspace_agent/instructions/response_policy.md`

Guidance to add:

- `aspect_ratio_hint` should usually be supplied
- `placement_hint` is semantic steering, not final geometry
- the agent should describe the teaching need, not perform placement math in
  natural language

Done means:

- prompt policy matches the implemented tool behavior

### Phase 9: End-To-End Verification

Goal:

- verify that the refined generate-visual loop works reliably

Test cases:

- no placement hint
- semantic placement hint such as `viewport_right`
- busy viewport with likely overlap
- missing or stale placement context
- multiple aspect ratios such as `1:1`, `4:3`, and `16:9`

Check:

- accepted result
- `canvas.job_started`
- completed result
- `canvas.insert_visual`
- frontend ack
- semantic completion update

Done means:

- the refined placement loop is stable enough for normal product use

### Phase 10: Cleanup And Doc Sync

Goal:

- make docs reflect the actual implemented refined E1 path

Files to refresh:

- `docs/image-output-and-enhancement-scratchpad.md`
- `docs/frontend-action-contract.md`
- `docs/tool-result-contract.md`
- `docs/implementation-stories.md`

Done means:

- scratchpad and reference docs match real code behavior

### Exact Files Likely To Change

Backend:

- `backend/app/main.py`
- `backend/app/thinkspace_agent/tools/canvas_visuals.py`
- `backend/app/thinkspace_agent/tools/canvas_visual_jobs.py`
- `backend/app/thinkspace_agent/config.py`
- `backend/app/thinkspace_agent/instructions/tool_policy.md`
- `backend/app/thinkspace_agent/instructions/response_policy.md`
- new: `backend/app/thinkspace_agent/tools/canvas_context_store.py`

Frontend:

- `frontend/client/pages/SessionCanvas.tsx`
- `frontend/client/hooks/useAgentWebSocket.ts`
- `frontend/client/types/agent-live.ts`
- new: `frontend/client/canvas/buildPlacementPlannerContext.ts`

Reference-only reuse sources:

- `frontend/client/parts/ScreenshotPartUtil.ts`
- `frontend/client/parts/UserViewportBoundsPartUtil.ts`
- `frontend/client/parts/AgentViewportBoundsPartUtil.ts`
- `frontend/client/parts/BlurryShapesPartUtil.ts`
- `frontend/client/parts/PeripheralShapesPartUtil.ts`
- `frontend/client/parts/SelectedShapesPartUtil.ts`
- `frontend/client/parts/CanvasLintsPartUtil.ts`
- `frontend/worker/prompt/sections/intro-section.ts`
- `frontend/worker/prompt/sections/rules-section.ts`

### Recommended Safe Execution Order

If we want the lowest-risk coding sequence, implement in this order:

1. Phase 2
2. Phase 3
3. Phase 4
4. Phase 5
5. Phase 6
6. Phase 7
7. Phase 8
8. Phase 9
9. Phase 10

This keeps:

- context available before planning
- planning available before geometry payload changes
- frontend geometry execution thin and deterministic once backend is ready
