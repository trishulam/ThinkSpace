# Canvas Generation Tool Reference

This document captures the implementation lessons from
`canvas.generate_visual` so future canvas-generation-style tools can reuse the
same proven pattern instead of rediscovering it.

Primary future reuse targets:

- `canvas.enhance`
- `canvas.generate_widget`

## What Was Proven In E1

The `canvas.generate_visual` path now works end to end with:

- a long-running backend tool
- a deterministic frontend insertion action
- a planner that returns final bounded `x/y/w/h`
- fresh placement context pulled from the frontend at tool time
- per-job trace files for debugging

This means E1 should be treated as the baseline implementation pattern for any
future tool that:

- generates a new artifact for the canvas
- needs canvas-aware placement
- requires multiple internal workers or reasoning steps

## Reusable Contract Pattern

For future generation-style tools, prefer the same shape:

1. orchestrator calls one high-level tool
2. backend returns an immediate accepted result
3. frontend shows lightweight job status
4. backend requests fresh canvas context if placement depends on current state
5. backend runs internal workers
6. backend emits one deterministic insertion action
7. frontend applies exactly what it was told
8. frontend acknowledgement flows back into the live agent loop

Do not invent a different transport path unless there is a clear reason.

## Tool Design Lessons

### 1. Keep The Orchestrator Tool High Level

The orchestrator should call one semantic tool such as
`canvas.generate_visual`, not separately manage:

- prompt planning
- image generation
- placement reasoning
- insertion logic

Those are internal backend responsibilities.

### 2. Keep Semantic Hints Free-Form

Inputs like `placement_hint` should remain semantic text rather than being
over-constrained to a tiny enum at the tool boundary.

Reason:

- the planner is the component that should interpret richer intent
- the orchestrator should express user-facing meaning, not protocol-perfect
  internal literals

### 3. Require Explicit Aspect Ratio

If the artifact has visual geometry, pass an `aspect_ratio_hint`.

Reason:

- both generation and placement need a shared geometry assumption
- this avoids mismatches between image shape and planned bounding box

## Placement Lessons

### 4. Pull Fresh Context At Tool Time

Do not rely on opportunistic background streaming of placement context.

Preferred pattern:

- backend emits a context request action
- frontend builds the latest context at that exact moment
- backend waits for the matching response before planning

This is the most important lesson from E1.

### 5. Frontend Should Be A Thin Executor

The frontend should not decide placement.

Instead:

- backend planner decides final `x/y/w/h`
- frontend inserts the artifact exactly there

This keeps the product deterministic and debuggable.

### 6. Use Real Page-Space Geometry

The final insertion payload should contain exact page-space coordinates:

- `x`
- `y`
- `w`
- `h`

Do not fall back to vague placement intents once the planner exists.

## Worker Architecture Lessons

### 7. Internal Workers Can Run In Parallel

For generation-style tools, the backend can run:

- artifact generation
- placement planning

in parallel, as long as both share the right semantic assumptions such as aspect
ratio and current context.

### 8. Keep Model Response Schemas Simple

Use minimal structured response schemas for planner outputs.

Reason:

- richer schema constraints can break model response handling in subtle ways
- it is safer to validate stricter conditions in backend code after parsing

## Debugging Lessons

### 9. Add Per-Job Trace Files From Day One

Any generation-style tool with internal reasoning should write a trace file per
job.

Recommended contents:

- tool inputs
- timing
- context summary
- planner prompt
- raw planner output
- parsed planner output
- final clamped geometry
- generator prompt/model metadata
- final emitted payload
- failure reasons

This is much more useful than relying on terminal logs.

### 10. Keep Sidebar Debugging Lightweight

The live sidebar should show a short summary only.

The source of truth for deep debugging should be the trace file.

## What To Reuse Later For `canvas.enhance`

When `canvas.enhance` is revisited, reuse:

- the same long-running tool contract
- the same fresh-context request-response flow
- the same trace-file pattern
- the same exact-geometry insertion path

New logic specific to `enhance` should mostly be:

- target selection semantics
- enhancement planning
- transformation prompt/spec generation

## What To Reuse Later For `canvas.generate_widget`

When `canvas.generate_widget` is revisited, reuse:

- accepted/completed tool-result pattern
- fresh-context request at tool time
- backend-owned placement planning
- per-job trace files

New logic specific to widgets should mostly be:

- widget artifact format
- HTML/runtime sandbox assumptions
- frontend widget execution/rendering

## Current Product Priority

Although `canvas.enhance` and `canvas.generate_widget` can reuse this pattern,
they are not the current next implementation target.

The next product-facing focus should be:

1. `canvas.delegate_task`
2. tutor environment awareness
3. tutor proactivity

That is the path that makes the product feel complete before adding more canvas
generation breadth.
