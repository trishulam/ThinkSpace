# Story I Environment Interpreter Scratchpad

Working pad for scoping and locking the first implementation slice of
`Story Group I: Environment Interpreter`.

This document is for discussion-first planning. It should be updated as we lock
decisions about canvas digestion, freshness, proactive triggering, and queueing
behavior.

## Current Scope Direction

For hackathon scope, keep Story `I` tightly focused on the canvas.

In scope right now:

- canvas change tracking
- canvas digest generation
- `send_realtime()` policy for fresh canvas perception
- `send_content()` policy for semantic canvas updates
- queueing and interruption rules so proactive behavior feels natural
- proactive-candidate signalling from canvas changes

Explicitly out of scope for this round unless later needed:

- flashcard digesting
- gesture digesting
- long-term session memory / compaction systems
- broad backend memory architecture beyond what is strictly needed for this
  canvas-driven environment interpreter slice

## Main Discussion Points

1. canvas change tracking
2. canvas digest schema
3. `send_realtime()` policy
4. `send_content()` policy
5. queueing and interruption rules
6. meaningfulness threshold
7. proactive trigger handoff

## Locked Decisions So Far

- do not send `send_realtime()` on every canvas state change
- use structured canvas changes as the primary tracking signal
- use screenshot/perceptual context as digest-time input rather than as the
  primary change tracker
- for hackathon scope, restrict Story `I` to the canvas only
- avoid interrupting active user speech or active tutor speech just to push a
  canvas digest
- prefer queueing/coalescing over immediate interruption when a digest becomes
  available during active speech

## Discussion Notes

### Canvas Change Tracking

Current direction:

- track structural canvas changes rather than relying on transcript history
- reason over a short activity window rather than every tiny mutation
- attribute changes to user vs agent where possible

Open questions:

- which exact editor/store events should feed the tracker
- how to define a stable inactivity window
- what minimal delta representation is enough for digestion

### Canvas Digest

Candidate digest contents:

- summary of current canvas state
- meaningful changes from previous state
- user changes
- agent changes
- proactive candidate flag
- proactive reason
- confidence
- timestamps / time window

Open question:

- which parts should be computed heuristically vs inferred by an LLM digest step

### `send_realtime()` Policy

Current direction:

- do not stream realtime updates for every change
- send fresh perceptual context only after a meaningful digest checkpoint
- use `send_realtime()` when the tutor needs to freshly perceive the resulting
  canvas state

Open questions:

- whether `send_realtime()` should always accompany a meaningful canvas digest
- what exact screenshot/context packet should be sent at digest time

### `send_content()` Policy

Current direction:

- use `send_content()` for semantic canvas digests, not raw edit noise
- emit only when the change window is meaningful enough to matter for tutoring

Open questions:

- whether all meaningful digests should be sent to the live model or only those
  that pass a proactive-candidate gate

### Queueing And Interruption

Current direction:

- do not interrupt active speech
- hold digests until neither side is speaking
- keep at most a small number of pending digests, ideally coalescing to the
  latest meaningful one

Open questions:

- exact flush conditions
- whether stale pending digests should be dropped or merged

### Meaningfulness Threshold

Examples that likely count:

- a new diagram takes shape
- a major relayout occurs
- a tutor-created artifact is inserted
- several meaningful new objects are added in one window

Examples that likely do not count:

- a tiny move
- a minor resize
- transient drag noise
- a small wording correction without semantic impact

## Next Discussion Step

Start with `1. canvas change tracking` and lock:

- event source
- actor tagging
- inactivity window
- delta representation

## Reframed Story Direction

Story `I` is no longer just a digest pipeline.

It is now:

- a canvas interpreter that acts like a second reasoning layer over the board
- an explicit viewport snapshot tool for freshness when the orchestrator is
  unsure
- selective visual grounding via paired `send_realtime()` screenshots on major
  canvas events
- compacted lesson/session context so interpreter reasoning stays grounded
  without replaying the full raw transcript

The orchestrator remains the main tutor brain, but the canvas interpreter is now
allowed to proactively inject steering/context via `send_content()` when it has
something meaningful to contribute.

## Reframed Phase-By-Phase Implementation Plan

### Phase 1: Canvas Change Tracking Foundation

Goal:

- detect structured canvas activity cheaply and reliably

Implementation direction:

- use frontend tldraw side-effect shape hooks as the primary event source
- track only create, update, and delete mutations
- attribute each event to `user`, `agent`, or `system`
- keep a lightweight primitive event stream for later windowing
- do not involve screenshot capture at this layer

Expected output:

- a stable structured change stream that later phases can window, summarize, and
  interpret

Status:

- implemented

### Phase 2: Tutor Provenance Metadata

Goal:

- make tutor-created canvas outputs attributable and interpretable

Implementation direction:

- stamp persistent metadata on tutor-created assets/shapes

For `canvas.generate_visual`:

- `thinkspace_actor: "agent"`
- `thinkspace_source_tool: "canvas.generate_visual"`
- `thinkspace_artifact_id`
- `thinkspace_created_at`

For `canvas.delegate_task`:

- add prompt-scoped creation metadata for newly created shapes:
  - `thinkspace_actor: "agent"`
  - `thinkspace_source_tool: "canvas.delegate_task"`
  - `thinkspace_delegate_job_id`
  - `thinkspace_created_at`

Important rule:

- only stamp creation metadata on newly created records
- do not overwrite ownership/source metadata on later edits to existing shapes

Why this phase matters:

- lets the interpreter distinguish tutor-built artifacts from learner-built
  content more reliably

Status:

- implemented

### Phase 3: Focused Visual Grounding On Major Tool Completions

Goal:

- visually ground the orchestrator after important tutor-caused canvas changes

Implementation direction:

- after successful `canvas.generate_visual` completion:
  - send a focused screenshot of the inserted visual region via
    `send_realtime()`
  - then let the backend process the normal semantic update via
    `send_content()`
- after successful `canvas.delegate_task` completion:
  - send a focused screenshot of the changed/created shapes region via
    `send_realtime()`
  - then let the backend process the normal semantic update via
    `send_content()`

Important rule:

- this is selective grounding for major tool completions, not continuous canvas
  streaming

Status:

- implemented

### Phase 4: Viewport Snapshot Tool

Goal:

- give the orchestrator an explicit freshness mechanism when it is unsure about
  the current viewport

Implementation direction:

- add a new orchestrator-facing tool to request current viewport understanding
- use a backend/frontend request-response flow similar to
  `canvas.context_requested`
- use the fresh-short-async version, not a cached sync read
- send the fresh screenshot through `send_realtime()`
- return the structured viewport packet as the tool result payload
- keep the raw screenshot blob out of the tool result payload
- return a fresh viewport packet containing:
  - viewport bounds
  - selected shapes
  - visible shape summaries
  - optional lints/peripheral summaries if useful

Important rule:

- this should be a tool call, not a blind periodic push
- do not use `send_content()` in the normal success path

Why this phase matters:

- the orchestrator can explicitly look again instead of relying on stale canvas
  state

Status:

- implemented

### Phase 5: Canvas Activity Windowing

Goal:

- turn low-level canvas changes into interpreter-sized activity windows

Implementation direction:

- maintain active windows over the Phase 1 event stream
- soft trigger after `2s` inactivity
- hard trigger after about `15s`
- allow only one interpreter job at a time
- if new changes happen while an interpreter job is running:
  - mark the window dirty
  - queue one successor window
  - coalesce multiple new changes into the latest successor

Window contents should include:

- start/end timestamps
- changed primitives
- actor counts
- changed ids
- aggregate change statistics

Why this phase matters:

- this becomes the trigger boundary for the interpreter

Status:

- implemented

### Phase 6: Compacted Lesson And Session Context

Goal:

- give the interpreter enough lesson/conversation context without flooding it

Implementation direction:

- keep full transcript turns in persistent storage
- maintain a rolling semantic lesson/session summary
- use `SessionRecord.summary` as the human-readable mirror of the rolling
  compacted summary
- keep compaction cursor/state in semantic checkpoint payload, not in
  `SessionRecord.summary` alone
- keep only a recent relevant raw transcript window alongside that summary
- use this threshold policy:
  - keep up to `10` finalized turns raw before the first compaction
  - after compaction, keep the newest `5` raw turns
  - recompact once the raw suffix grows back to `10` turns
- periodically compact older turns into the semantic summary

Use existing seams:

- `session_store` transcript turns
- `SessionRecord.summary`
- `semantic` / `hybrid` checkpoints
- `SessionContext` / `build_runtime_context()`

Interpreter context should include:

- lesson goal / objective
- compacted lesson/session summary
- recent relevant transcript
- current topic / subtopic
- recent tutor interventions

Important rule:

- do not replay the full raw transcript every time
- do not use ADK conversation memory as the source of truth for compaction

Status:

- implemented

### Phase 7: Interpreter Input Builder

Goal:

- assemble the complete reasoning packet for the canvas interpreter model

Implementation direction:

- combine:
  - previous interpreter summary stub
  - current activity window
  - latest cached canvas snapshot/context
  - tutor provenance-aware canvas data carried by the window/context
  - compacted lesson/session context
  - recent relevant transcript
  - lesson topic/goal metadata
  - learning objective stub for now
- receive closed canvas activity windows from the frontend over a dedicated
  websocket message
- assemble the packet on the backend
- store the latest packet per session for Phase 8 and debugging
- expose the latest packet through the existing debug seam

Important rule:

- build the packet only; do not run reasoning or send `send_content()` yet

This is the point where the older digest concept becomes a full interpreter
input rather than just a change summary.

Status:

- implemented

### Phase 8: Canvas Interpreter Reasoning Step

Goal:

- let a stronger reasoning model analyze the canvas in educational context

Implementation direction:

- run an asynchronous interpreter reasoning step over the Phase 7 packet
- expect structured output, not free-form prose
- require the latest cached screenshot as mandatory visual grounding
- start reasoning immediately for every eligible latest packet
- apply latest-packet-wins when newer windows supersede older in-flight runs
- write one persistent trace per reasoning run under
  `backend/app/debug_traces/interpreter_reasoning/`

Locked structured output:

- `status`
- `run_id`
- `packet_window_id`
- `reasoning_model`
- `canvas_change_summary`
- `learner_state`
- `pedagogical_interpretation`
- `proactivity`
- `steering`
- `confidence`
- `safety_flags`

Important rule:

- this is pedagogical interpretation, not just summarization
- do not call `send_content()` yet in this phase

Status:

- implemented

### Phase 9: Interpreter-To-Orchestrator Delivery

Goal:

- let the interpreter proactively influence the main tutor

Implementation direction:

- interpreter is allowed to initiate proactive reasoning turns via
  `send_content()`
- payload should include:
  - interpreter summary
  - steering suggestions
  - proactive signal
  - confidence
  - lesson-context grounding
- pair with `send_realtime()` only when fresh visual grounding is materially
  useful

Important rule:

- the canvas interpreter may proactively inject context, but the orchestrator
  remains the main tutor surface

### Phase 10: Non-Interrupting Delivery Policy

Goal:

- make interpreter-driven proactivity feel natural

Implementation direction:

- do not interrupt user speech
- do not interrupt tutor speech
- queue/coalesce interpreter outputs when needed
- prefer the latest meaningful interpreter signal
- allow interpreter-triggered `send_content()` only when timing is appropriate

This is where Story `I` lightly overlaps with Story `J`, but only the minimum
timing policy needed for natural delivery should be built here.

### Phase 11: Observability And Traces

Goal:

- make the canvas interpreter debuggable from day one

Implementation direction:

- save one trace per interpreter run
- include:
  - trigger reason
  - activity window summary
  - compacted context used
  - recent transcript slice used
  - snapshot references
  - reasoning prompt/model
  - structured interpreter output
  - whether it triggered `send_content()` (`not_applicable` in this phase)
  - whether it paired `send_realtime()` (`not_applicable` in this phase)
- add a subtle below-the-notch cue for interpreter lifecycle
- cue meaning:
  - the tutor is understanding progress from the learner's latest canvas work
  - the tutor is quietly steering the lesson
- cue behavior:
  - visible to all users by default
  - start copy: `Understanding your progress`
  - start message: `Using your latest canvas work to guide the lesson`
  - success clears quietly
  - failure shows a subtle short-lived error state
- keep trace files as the durable review source of truth for now
- keep latest in-memory interpreter state exposed through the existing debug seam

Status:

- implemented

## Recommended Build Order

1. Phase 2: tutor provenance metadata
2. Phase 4: viewport snapshot tool
3. Phase 5: canvas activity windowing
4. Phase 6: compacted lesson and session context
5. Phase 7: interpreter input builder
6. Phase 8: canvas interpreter reasoning step
7. Phase 11: observability and traces
8. Phase 9: interpreter-to-orchestrator delivery
9. Phase 10: non-interrupting delivery policy

## First Meaningful Slice

For the first strong Story `I` slice, stop after:

- Phase 2
- Phase 4
- Phase 5
- Phase 6
- Phase 7
- Phase 8
- Phase 11

That gives:

- attributed tutor artifacts
- explicit freshness access via a viewport tool
- interpreter trigger windows
- compacted lesson/session context
- real pedagogical canvas interpretation
- traces for tuning before enabling interpreter-driven proactive delivery

## Implementation Order We Should Proceed With

We should proceed in this order:

1. Phase 2
2. Phase 4
3. Phase 5
4. Phase 6
5. Phase 7
6. Phase 8
7. Phase 11
8. Phase 9
9. Phase 10
