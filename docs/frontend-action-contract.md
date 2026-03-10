# ThinkSpace Frontend Action Contract

## Purpose

This document is the living source of truth for Story Group C: the typed action
channel between backend tool results and visible frontend behavior.

It should be updated as the action envelope, action families, and acknowledgement
contract become more precise.

## Status

- Story C1 has a locked v1 baseline.
- Story C2 has a locked v1 baseline.

## V1 Contract Goals

The v1 frontend action contract should:

- provide one predictable envelope for frontend execution
- represent deterministic UI or canvas actions
- stay aligned with the locked v1 tool surface
- avoid over-generalizing before real product needs appear

## Locked V1 Action Envelope

Every frontend action should fit this common envelope:

- `type`
- `source_tool`
- `job_id?`
- `payload`

## Field Definitions

### `type`

Required.

Identifies the frontend action the client should apply.

### `source_tool`

Required.

The fully-qualified backend tool name that produced the action.

Examples:

- `canvas.generate_visual`
- `canvas.enhance`
- `flashcards.create`

### `job_id`

Optional.

Useful when a long-running tool later emits the frontend action that should be
applied after completion.

### `payload`

Required.

Action-specific data needed by the frontend to execute the action.

## Locked V1 Action Types

- `canvas.insert_visual`
- `canvas.insert_widget`
- `flashcards.show`
- `flashcards.next`
- `flashcards.reveal_answer`
- `flashcards.clear`

## Action Meanings

### `canvas.insert_visual`

Insert a generated visual artifact into the canvas.

Typical sources:

- `canvas.generate_visual`
- `canvas.enhance`

Payload will likely need:

- visual asset reference or URL
- placement data
- size data
- optional title or label metadata

### `canvas.insert_widget`

Insert a generated widget or HTML artifact into the canvas.

Typical source:

- `canvas.generate_widget`

Payload will likely need:

- widget artifact reference or HTML payload
- placement data
- size data
- optional widget metadata

### `flashcards.show`

Show the created flashcard deck in the frontend.

Typical source:

- `flashcards.create`

This is why there is no separate `flashcards.show_set` tool in the locked v1
tool surface.

### `flashcards.next`

Advance the active flashcard view to the next card.

Typical source:

- `flashcards.next`

### `flashcards.reveal_answer`

Reveal the answer for the active flashcard.

Typical source:

- `flashcards.reveal_answer`

### `flashcards.clear`

Clear the active flashcard session from frontend view state.

Typical source:

- `flashcards.end`

## Explicit V1 Boundary: `canvas.delegate_task`

`canvas.delegate_task` does not currently map to one simple frontend action in
the same way as the other v1 tools.

Current decision:

- treat it as a special execution path tied to the tldraw canvas agent
- do not force it into a simple single-action insertion model

This can be revisited later if a normalized canvas-agent result action becomes
useful.

## Design Rule

Frontend actions should describe deterministic UI or canvas execution, not
high-level tutoring intent.

Good examples:

- insert this visual at this placement
- reveal the current flashcard answer
- clear the active flashcard session

Not a frontend action:

- help the user understand recursion better

## Locked V1 Acknowledgement Envelope

Every frontend acknowledgement should fit this common envelope:

- `status`
- `action_type`
- `source_tool`
- `job_id?`
- `summary?`

## Locked V1 Acknowledgement Statuses

- `applied`
- `failed`

## Acknowledgement Field Definitions

### `status`

Required.

Indicates whether the frontend successfully applied the requested action.

Locked v1 values:

- `applied`
- `failed`

### `action_type`

Required.

The frontend action type that this acknowledgement refers to.

Examples:

- `canvas.insert_visual`
- `flashcards.show`

### `source_tool`

Required.

The backend tool that originally caused the frontend action.

### `job_id`

Optional.

Useful when the acknowledgement refers to an action emitted after completion of
a long-running tool.

### `summary`

Optional but recommended.

A short human-readable description of what happened.

Examples:

- `Visual inserted into canvas`
- `Flashcard deck shown`
- `Failed to render widget`

## V1 Scope Boundary

The acknowledgement envelope is intentionally narrow in v1.

Current decision:

- use acknowledgements only to confirm whether frontend execution succeeded or
  failed
- do not mix user-interaction semantics into this same envelope yet
- do not add dismissal or analytics-style statuses yet

Possible later additions, if justified:

- dismissal acknowledgements
- user interaction events
- richer frontend error payloads
