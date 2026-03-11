# Generate Visual Debugging Scratchpad

Temporary working pad for the next implementation round on
`canvas.generate_visual`.

This round is not about expanding tool scope. It is about making the current
generate-visual path debuggable and making placement context fresh at the exact
moment the tool runs.

## Current Observations

- images are being generated successfully
- placement is often collapsing toward viewport-center behavior
- the current placement-context packet is not guaranteed to be fresh at tool
  time
- sidebar trace is too compressed to debug the placement reasoner properly
- backend terminal logs are too noisy to rely on for iterative debugging
- the latest trace pattern suggests fallback placement is often being used

## Locked Direction For This Round

- first priority: proper persistent traces for the entire generate-visual run
- second priority: replace background placement-context pushing with an
  on-demand fetch initiated inside the tool flow
- keep `placement_hint` as free-form semantic text
- do not add normalization layers unless later evidence proves it is necessary
- do not over-engineer a general tracing platform yet; keep this specific to
  `canvas.generate_visual`

## Phase 1: Persistent Trace Capture

Goal:

- make every `canvas.generate_visual` run leave behind a readable trace file

Why first:

- without this, placement debugging is guesswork
- the sidebar should remain a summary surface, not the main inspection tool

Implementation direction:

- create a dedicated trace writer for generate-visual runs
- write one structured file per job id
- keep the format JSON-first so it is machine-readable and easy to inspect

Recommended trace folder:

- `backend/app/debug_traces/generate_visual/`

Recommended file shape:

- filename: `<job-id>.json`
- top-level keys:
  - `job_id`
  - `tool`
  - `started_at`
  - `completed_at`
  - `status`
  - `inputs`
  - `context_summary`
  - `placement_planner`
  - `image_generator`
  - `final_result`
  - `errors`

Recommended trace contents:

- raw tool inputs:
  - `prompt`
  - `aspect_ratio_hint`
  - `placement_hint`
  - `title_hint`
  - `visual_style_hint`
- placement-context summary:
  - `captured_at`
  - viewport bounds
  - number of selected shapes
  - number of blurry shapes
  - number of peripheral clusters
  - number of lints
- placement-planner section:
  - planner model
  - full planner prompt
  - whether screenshot was included
  - raw planner response payload
  - parsed structured plan
  - final clamped geometry
  - whether fallback was used
  - fallback reason if any
- image-generator section:
  - image model
  - generation prompt
  - output mime type
- final result:
  - artifact metadata
  - final `x/y/w/h`
  - frontend payload summary

Done means:

- every generate-visual run produces a trace file
- the trace file is sufficient to debug planner behavior without reading noisy
  terminal output

## Phase 2: Trace Summary In Sidebar

Goal:

- keep the sidebar useful while making the trace file the source of truth

Implementation direction:

- keep a short tool-result summary in the sidebar
- include:
  - planner model
  - whether fallback was used
  - final `x/y/w/h`
  - trace file path or trace id
- avoid dumping full JSON blobs into the sidebar line

Done means:

- the sidebar tells us where to look
- detailed planner debugging moves to the saved trace file

## Phase 3: On-Demand Placement Context Request

Goal:

- ensure placement context is built at actual tool-call time, not opportunistically

Direction:

- remove the assumption that the backend already has a fresh cached context
- when `canvas.generate_visual` starts, the backend should request fresh context
  from the frontend

Proposed flow:

1. orchestrator calls `canvas.generate_visual`
2. backend immediately emits a frontend action such as
   `canvas.context_requested`
3. frontend builds the latest placement context right then
4. frontend responds with the built context
5. backend resumes the job with that fresh context
6. backend runs placement planning and image generation
7. backend emits final `canvas.insert_visual`

Important note:

- this is a targeted request-response flow, not a continuous stream

Done means:

- the placement planner always runs on a context snapshot generated for that
  exact tool invocation

## Phase 4: Frontend Context Request Handling

Goal:

- let the frontend build context only when asked

Implementation direction:

- add a new frontend action type:
  - `canvas.context_requested`
- payload should stay compact and job-oriented:
  - `job_id`
  - optional reason or source tool
- frontend should:
  - build the placement-context packet using the existing helper
  - return it immediately in an acknowledgement or dedicated message
  - include the same `job_id` so the backend can correlate it

Open design question to lock:

- should the response travel as:
  - a specialized `frontend_ack` with attached `context_payload`, or
  - a new app-level websocket message type such as `canvas_context_response`

Current recommendation:

- use a dedicated app-level message like `canvas_context_response`
- keep `frontend_ack` for UI action success/failure only

Done means:

- backend can explicitly ask for context and reliably receive the latest packet

## Phase 5: Backend Job Coordination

Goal:

- make the long-running tool wait for the requested context cleanly

Implementation direction:

- add a per-session/per-job waiting channel for context responses
- `canvas.generate_visual` should:
  - create job id
  - emit `canvas.job_started`
  - emit `canvas.context_requested`
  - await the frontend response for that same job
  - proceed only once context arrives or a timeout occurs

Timeout behavior:

- if context response does not arrive in time:
  - fail the job clearly, or
  - optionally fall back to a no-placement-plan path only if we explicitly
    decide to support it

Current recommendation:

- fail clearly on missing fresh context during this debugging round
- do not silently fall back to stale cached context

Done means:

- there is a deterministic job-time context acquisition flow

## Phase 6: Planner Behavior Re-Verification

Goal:

- only after trace capture and tool-time context freshness are fixed, study
  whether placement reasoning itself is still weak

Test prompts:

- no placement hint
- simple semantic hint like `left`
- richer semantic hint such as `place it to the left of the current notes`
- busy viewport with competing shapes
- selected-cluster scenario
- multiple aspect ratios

Check:

- whether the planner returns structured output consistently
- whether fallback usage drops materially
- whether geometry changes when viewport/selection changes right before tool call
- whether planner prompt and response match the user’s actual canvas state

Done means:

- we can tell whether remaining issues are context freshness problems or true
  planner-quality problems

## Exact Files Likely To Change In This Round

Backend:

- `backend/app/main.py`
- `backend/app/thinkspace_agent/tools/canvas_visuals.py`
- `backend/app/thinkspace_agent/tools/canvas_visual_jobs.py`
- new: `backend/app/thinkspace_agent/tools/canvas_visual_trace.py`
- optionally new: `backend/app/thinkspace_agent/tools/canvas_context_requests.py`

Frontend:

- `frontend/client/pages/SessionCanvas.tsx`
- `frontend/client/hooks/useAgentWebSocket.ts`
- `frontend/client/types/agent-live.ts`
- `frontend/client/canvasPlacementPlannerContext.ts`

Docs to refresh after implementation:

- `docs/generate-visual-debugging-scratchpad.md`
- `docs/frontend-action-contract.md`
- `docs/tool-result-contract.md`
- `docs/implementation-stories.md`

## Recommended Safe Execution Order

1. Phase 1: persistent trace capture
2. Phase 2: sidebar trace summary cleanup
3. Phase 3: on-demand placement context request contract
4. Phase 4: frontend context request handling
5. Phase 5: backend job coordination and waiting
6. Phase 6: planner behavior re-verification

## Open Questions For Discussion

- should trace files include the full placement-context payload, or only a
  summarized version plus a pointer to a sibling context file
- should missing context fail the job immediately or after a short timeout
- should the image generator also wait until fresh context is received, or can
  image generation begin in parallel once the tool starts while only placement
  waits for context
- do we want to keep the old cached-context path temporarily as a backup during
  migration, or remove it immediately to keep behavior simple
