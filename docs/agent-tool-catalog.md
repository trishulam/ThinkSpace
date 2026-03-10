# ThinkSpace Agent Tool Catalog

## Purpose

This document is the living source of truth for Story A1: defining the
orchestrator-facing tool families for ThinkSpace.

It should be updated as tool-family decisions are discussed and locked.

## Status

- Story A1 is in progress.
- The `canvas.*` family is currently locked for v1.
- Other families such as `flashcards.*` are still under discussion.

## Catalog Principles

These principles apply across the catalog unless later decisions explicitly
change them.

- Tools should be outcome-oriented, not low-level UI command wrappers.
- The top-level ThinkSpace orchestrator should choose tools based on tutoring
  intent, not raw canvas mechanics.
- Canvas perception should not be exposed as a first-class tool family.
- Generated output insertion should use a direct output path when possible.
- Open-ended canvas manipulation should use the tldraw canvas agent path.

## Locked Family: `canvas.*`

The orchestrator-facing `canvas.*` family for v1 is:

- `canvas.generate_visual`
- `canvas.generate_widget`
- `canvas.enhance`
- `canvas.delegate_task`

### `canvas.generate_visual`

Generate a static visual teaching artifact and place it on the canvas.

Examples:

- diagram
- poster
- labeled explainer visual
- concept illustration

Behavior notes:

- placement is primarily viewport-based
- this uses direct output insertion rather than the full tldraw agent path

### `canvas.generate_widget`

Generate an interactive or HTML-based teaching surface and place it on the
canvas.

Examples:

- chart
- comparison widget
- quiz widget
- simulation or explorable

Behavior notes:

- placement is primarily viewport-based
- this uses direct output insertion rather than the full tldraw agent path

### `canvas.enhance`

Transform existing canvas content into a better teaching artifact.

Targeting rules:

- if there is a user selection, the selected content is the enhancement target
- if there is no selection, the current viewport content is the enhancement
  target

Behavior notes:

- enhancement is primarily about producing a better teaching artifact from
  existing canvas material
- this often results in a new visual or widget derived from the source content
- selection matters for understanding what to enhance
- viewport remains the main placement anchor for generated outputs

### `canvas.delegate_task`

Hand off open-ended canvas manipulation to the existing tldraw canvas agent.

Examples:

- reorganize a messy board
- redraw or relayout content
- perform multi-step canvas edits
- manipulate shapes directly over several actions

Behavior notes:

- this is the path for true canvas operations
- this is not the default path for simple generated output placement

## Canvas Perception And Executor Context

Canvas-aware executors should use the existing tldraw-style hybrid context
primitives already present in the frontend codebase.

Current reference primitives:

- `frontend/client/parts/ScreenshotPartUtil.ts`
- `frontend/client/parts/BlurryShapesPartUtil.ts`
- `frontend/client/parts/SelectedShapesPartUtil.ts`
- `frontend/client/parts/AgentViewportBoundsPartUtil.ts`
- `frontend/client/parts/PeripheralShapesPartUtil.ts`

These provide:

- viewport screenshot
- visible shape summaries
- selected shape IDs
- viewport bounds
- peripheral shape clusters

Design rule:

- do not rely on screenshot alone for canvas-aware execution
- reuse the same hybrid perception pattern as the existing tldraw agent

## Placement Direction For Generated Outputs

For generated visuals and widgets, the current v1 direction is:

- placement should be fast and simple
- placement should run in parallel with generation work where possible
- viewport is the primary placement anchor
- selection helps determine enhancement targets, but not the default placement
  anchor for generated outputs

## Current Boundaries

- `canvas.generate_visual` and `canvas.generate_widget` stay separate
- there is no separate top-level canvas perception tool family right now
- direct generated-output insertion and canvas-agent delegation remain separate
  execution paths
- visual and widget generation may internally use specialized workers, but they
  remain `canvas.*` tools at the orchestrator-facing surface

## Locked Family: `flashcards.*`

The orchestrator-facing `flashcards.*` family for v1 is:

- `flashcards.create`
- `flashcards.next`
- `flashcards.reveal_answer`
- `flashcards.end`

### `flashcards.create`

Create a flashcard set asynchronously.

Behavior notes:

- this is an async tool
- the orchestrator requests flashcard creation
- when creation completes, the system should send a semantic update back to the
  orchestrator indicating that flashcards are ready
- the frontend should automatically show the created flashcards once they are
  available
- there is no separate `flashcards.show_set` tool in v1

### `flashcards.next`

Advance to the next flashcard in the active set.

Behavior notes:

- this is a lightweight control action for an active flashcard session
- this avoids introducing broader grading mechanics in v1

### `flashcards.reveal_answer`

Reveal the answer for the current flashcard.

Behavior notes:

- this is the v1 answer-reveal action for an active flashcard
- this intentionally replaces lower-level UI-metaphor naming like `flip`

### `flashcards.end`

End the active flashcard session.

Behavior notes:

- this should clear the active flashcard experience from frontend view state
- this is the lifecycle boundary for dismissing the current flashcard session

## Flashcard Boundaries

The following are intentionally not part of the v1 `flashcards.*` family:

- `flashcards.show_set`
- `flashcards.mark_correct`
- `flashcards.mark_incorrect`
- `flashcards.grade_response`
- `flashcards.flip`

These are omitted to keep the flashcard family small, outcome-oriented, and
light on UI-level mechanics.

## Future Scope Candidates

These are notable additions that may become orchestrator-facing capabilities in a
later phase, but are not part of the locked v1 Story A1 surface yet.

- `knowledge.lookup`
- `research.lookup`
- web-search-backed retrieval, including reuse or adaptation of the current
  Google search demo capability

Current decision:

- do not implement these in v1
- keep them documented as future-scope candidates rather than expanding the
  active v1 tool catalog prematurely

## Story A2: Execution Style

The following execution-style classifications are currently locked for v1.

### Long-Running With Progress

- `canvas.generate_visual`
- `canvas.generate_widget`
- `canvas.enhance`
- `canvas.delegate_task`

Rationale:

- these tools can involve multiple internal steps
- users benefit from visible job progress for heavier canvas work
- canvas delegation is especially likely to produce staged progress

### Long-Running

- `flashcards.create`

Rationale:

- flashcard creation is asynchronous
- v1 does not need granular progress updates for card generation
- a simple job-like lifecycle is sufficient for the initial product flow

### Synchronous

- `flashcards.next`
- `flashcards.reveal_answer`
- `flashcards.end`

Rationale:

- these are lightweight control actions on an already active flashcard session
- they should feel immediate and should not require job-style progress handling

## Story A3: Subagent Ownership

The following ownership classifications are currently locked for v1.

### `canvas.generate_visual`

Ownership:

- multiple sequential workers

Execution shape:

- planner
- visual generator
- placement executor

Notes:

- the orchestrator decides why a visual is needed
- the planner determines the artifact goal and output framing
- the visual generator produces the actual image or teaching visual
- the placement executor determines viewport-based placement for insertion

### `canvas.generate_widget`

Ownership:

- multiple sequential workers

Execution shape:

- planner
- widget generator
- placement executor

Notes:

- the orchestrator decides why an interactive output is needed
- the planner determines widget framing and intended output
- the widget generator produces the HTML or interactive artifact
- the placement executor determines viewport-based placement for insertion

### `canvas.enhance`

Ownership:

- multiple sequential workers

Execution shape:

- planner
- visual enhancement generator
- placement executor

Notes:

- enhancement is not owned by the full tldraw canvas agent in the default path
- if there is a selection, the planner uses it as the enhancement target
- if there is no selection, the planner uses the viewport as the enhancement
  target
- the enhancement generator should receive the viewport screenshot and the
  existing hybrid canvas context primitives so it can understand what to improve
- the enhancement prompt should clearly describe what existing content is trying
  to communicate, what should be preserved, and what should be improved

### `canvas.delegate_task`

Ownership:

- one specialist subagent

Execution shape:

- tldraw canvas agent

Notes:

- this is the path for open-ended canvas manipulation
- this tool owns multi-step shape editing and broader canvas operations

### `flashcards.create`

Ownership:

- one specialist worker

Execution shape:

- flashcard generation worker

Notes:

- the orchestrator decides why flashcards are needed
- the flashcard worker generates the set asynchronously
- completion returns as a semantic update and the frontend auto-shows the deck

### `flashcards.next`

Ownership:

- direct backend and frontend logic

Notes:

- no specialist subagent is needed
- this is a lightweight control action on an active flashcard session

### `flashcards.reveal_answer`

Ownership:

- direct backend and frontend logic

Notes:

- no specialist subagent is needed
- this is a lightweight control action on an active flashcard session

### `flashcards.end`

Ownership:

- direct backend and frontend logic

Notes:

- no specialist subagent is needed
- this clears the active flashcard session from frontend state

## Story Group A Status

Current status for the locked v1 tool surface:

- Story A1 complete enough for v1 planning
- Story A2 complete enough for v1 planning
- Story A3 ownership currently locked for the active v1 tools
