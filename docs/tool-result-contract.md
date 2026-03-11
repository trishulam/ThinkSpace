# ThinkSpace Tool Result Contract

## Purpose

This document is the living source of truth for Story Group B: standardizing the
backend tool result contract for ThinkSpace.

It should be updated as the common result envelope and job-lifecycle semantics
become more precise.

## Status

- Story B1 has a locked v1 baseline.
- Story B2 has a locked v1 baseline for initial job lifecycle semantics.
- The contract is intentionally small and can expand later if real needs appear.

## V1 Contract Goals

The v1 result envelope should:

- work for both synchronous and long-running tools
- support optional frontend-visible actions
- support async job tracking
- keep memory ownership centralized in the orchestrator or backend

## Locked V1 Result Envelope

Every tool result should fit this common envelope:

- `status`
- `tool`
- `job?`
- `summary?`
- `payload?`
- `frontend_action?`

## Field Definitions

### `status`

Required.

Indicates what happened at the current step of tool execution.

Locked v1 values:

- `accepted`
- `completed`
- `failed`

### `tool`

Required.

The fully-qualified tool name that produced the result.

Examples:

- `canvas.generate_visual`
- `canvas.enhance`
- `flashcards.create`

### `job`

Optional.

Used for long-running tools.

Locked v1 baseline:

- `job.id`

Optional future extensions may include phase or progress metadata, but those are
not required for the initial contract.

### `summary`

Optional but strongly recommended.

A short human-readable description of what happened.

Examples:

- `Flashcard generation started`
- `Enhanced visual created from current viewport`
- `Canvas delegation failed`

### `payload`

Optional.

Tool-specific semantic result data.

Examples:

- generated flashcard deck metadata
- generated visual asset reference
- widget output metadata
- active flashcard state information

This remains tool-specific in v1 rather than being over-normalized too early.

### `frontend_action`

Optional.

The typed action that the frontend should execute as a consequence of the tool
result.

Examples:

- insert generated image into the canvas
- insert generated widget into the canvas
- reveal the current flashcard answer
- advance to the next flashcard
- clear the active flashcard session

## Explicit V1 Exclusion: `memory_updates`

`memory_updates` is intentionally not part of the locked v1 result envelope.

Current decision:

- tools should report what happened
- the orchestrator or backend should decide how memory changes in response

Reasoning:

- this keeps memory ownership centralized
- this avoids splitting memory semantics between tools and orchestrator logic
- this reduces coupling while the memory model is still evolving

The idea can be revisited later if memory mapping becomes repetitive enough to
justify a dedicated optional field.

## Locked V1 Job Lifecycle Semantics

### `accepted`

The tool has accepted the request and work will continue asynchronously.

Expected behavior:

- a `job.id` is present
- no final payload is required yet
- a summary should usually indicate that work has started

### `completed`

The tool has finished successfully for the current result.

Expected behavior:

- synchronous tools may return `completed` immediately
- long-running tools may return `completed` in a later follow-up result using
  the same `job.id`
- `payload` and `frontend_action` may be present if relevant

### `failed`

The tool could not complete successfully.

Expected behavior:

- include a useful summary when possible
- include `job.id` if the failure belongs to an existing long-running job

## Initial Contract Examples

### Synchronous example: `flashcards.next`

- `status`: `completed`
- `tool`: `flashcards.next`
- `summary`: `Moved to the next flashcard`
- `frontend_action`: advance active flashcard view

### Long-running example: `flashcards.create`

Initial result:

- `status`: `accepted`
- `tool`: `flashcards.create`
- `job.id`: generated job identifier
- `summary`: `Flashcard generation started`
- `frontend_action`: enter the frontend flashcard creating state, typically via
  `flashcards.begin`

Later completion:

- `status`: `completed`
- `tool`: `flashcards.create`
- `job.id`: same job identifier
- `summary`: `Flashcards created`
- `payload`: generated deck metadata
- `frontend_action`: show created flashcards

### Long-running example: `canvas.generate_visual`

Initial result:

- `status`: `accepted`
- `tool`: `canvas.generate_visual`
- `job.id`: generated job identifier
- `summary`: `Visual generation started`
- `payload`: includes the requested `prompt`, required `aspect_ratio_hint`, and
  resolved `placement_hint`
- `frontend_action`: enter a lightweight canvas loading toast, typically via
  `canvas.job_started`

Later completion:

- `status`: `completed`
- `tool`: `canvas.generate_visual`
- `job.id`: same job identifier
- `summary`: `Visual generated and ready for insertion`
- `payload`: generated visual metadata plus planned `x/y/w/h` placement
  geometry
- `frontend_action`: insert the generated visual into the canvas

## Async Delivery Note

For background jobs that complete after the original ADK tool-call event has
already returned, the backend may relay the same result envelope over the
websocket inside an app-level message such as:

- `type`: `tool_result`
- `result`: full tool result envelope

This does not change the result contract itself. It only defines how a later
async completion can be delivered back to the active frontend session.

## Open For Later Expansion

Possible later additions, if justified by real product needs:

- richer `job` metadata
- progress-phase details
- error detail structures
- optional `memory_updates`
- more normalized payload schemas per tool family
