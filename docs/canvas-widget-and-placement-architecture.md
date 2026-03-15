# Canvas Widget And Placement Architecture

## Purpose

This document is the focused technical reference for the generated canvas output
pipeline that now powers:

- `canvas.generate_visual`
- `canvas.generate_graph`
- `canvas.generate_notation`

It explains the shared placement system, the compact geometry preprocessor, the
center-point planner contract for visuals and graphs, and the split of sizing responsibility across the
backend and frontend.

## High-Level Model

ThinkSpace now treats generated canvas artifacts as a two-stage problem:

1. Generate the artifact content.
2. Place it semantically and geometrically on the current viewport.

The important architectural change is that the placement model is no longer
asked to solve full geometry from raw canvas context. Instead:

- deterministic code computes occupied and free regions first
- the model chooses the best semantic free region using compact geometry and the
  screenshot
- the planner returns only a semantic center point for visuals and graphs
- backend or frontend code computes the final size

## Tool Family

### `canvas.generate_visual`

Produces a static teaching image.

- image generation runs in parallel with placement planning
- the planner returns `center_x/center_y`
- the backend applies one exact size preset per aspect ratio and repairs the
  final rect deterministically
- the frontend inserts the resulting image shape

### `canvas.generate_graph`

Produces a structured graph widget through the shared widget reasoner.

- the reasoner turns the prompt into a typed graph spec
- the planner returns `center_x/center_y`
- the backend applies one exact graph size preset and repairs the final rect
  deterministically
- the frontend inserts the graph widget through `canvas.insert_widget`

### `canvas.generate_notation`

Produces a notation widget for equations, derivations, and proof-like steps.

- the reasoner turns the prompt into a typed notation spec
- the planner still returns top-left `x/y`
- the frontend renders the notation content off-screen and measures best-fit
  size from the actual DOM output
- the frontend inserts the notation widget through `canvas.insert_widget`

## End-To-End Flow

### Common execution shape

All three tools share the same broad runtime loop:

1. The orchestrator calls the tool.
2. The backend returns `accepted`.
3. The backend sends `canvas.context_requested`.
4. The frontend captures fresh placement context.
5. The backend worker receives that fresh context.
6. Content generation and placement planning run in parallel where applicable.
7. The backend publishes a completed result with a frontend insertion action.
8. The frontend inserts the artifact.
9. The frontend sends a focused screenshot through `send_realtime(...)`.
10. The frontend sends `frontend_ack`.
11. The backend converts the ack into semantic tutor grounding through
    `send_content(...)`.

### Why the ack matters

The tool is not considered semantically complete when the worker finishes. It
is considered semantically complete when the frontend confirms the learner can
actually see the result.

This is the reason the tutor can safely say "the graph is now on the canvas"
only after `canvas.insert_visual` or `canvas.insert_widget` is acknowledged.

## Placement Inputs

Placement workers receive fresh context from
`frontend/client/canvasPlacementPlannerContext.ts`.

Important raw fields include:

- `captured_at`
- `user_viewport_bounds`
- `agent_viewport_bounds`
- `screenshot_data_url`
- `selected_shape_ids`
- `selected_shape_details`
- `blurry_shapes`
- `peripheral_clusters`
- `canvas_lints`

The full raw context is useful to the backend, but the planner itself does not
see the entire payload anymore.

## Compact Geometry Preprocessor

The shared preprocessor lives in
`backend/app/thinkspace_agent/tools/canvas_placement_geometry.py`.

Its job is to turn noisy canvas state into a compact planner payload.

### Algorithm

1. Coerce supported canvas shapes into normalized rectangles.
2. Inflate each occupied rectangle by a safety padding.
3. Clip padded rectangles to the viewport.
4. Merge overlapping occupied rectangles into consolidated blocked regions.
5. Build cut coordinates from viewport and occupied-rect edges.
6. Turn the viewport into a finite blocked/free grid.
7. Enumerate maximal empty rectangles.
8. Rank those free rectangles by fit and usefulness.
9. Trim the list to a small planner-facing set.

### Planner-facing payload

The placement planner now receives only:

- `viewport_bounds`
- `desired_size`
- `occupied_rects`
- `free_rects`

This sharply reduces prompt size while preserving the information needed for
good placement decisions.

## Screenshot-Assisted Semantic Placement

Compact geometry alone is good for fast spatial reasoning, but it cannot tell
the model whether the best region is semantically above, below, beside, or away
from existing content clusters.

That is why the planner can also receive the current viewport screenshot.

Current design intent:

- geometry handles rectangle math deterministically
- the screenshot helps the planner choose the most semantically appropriate free
  region
- the planner does not waste tokens reconstructing geometry from pixels

## Planner Output Contract

For visuals and graphs, the planner now returns only:

- `center_x`
- `center_y`

These coordinates are the intended semantic center of the new artifact.

For notation, the planner still returns:

- `x`
- `y`

because notation stays on the render-measured anchor flow.

The planner is explicitly not responsible for:

- choosing final `w/h`
- preserving exact final size constraints
- resolving DOM-measured notation size

## Final Size Ownership

### Visuals

Visual sizing is backend-owned.

Rules:

- use one exact preset per aspect ratio
- do not resize during post-pass repair
- repair placement to reduce overlap and maximize visible area
- do not require full containment inside the viewport

Current visual presets:

- `1:1` -> `560 x 560`
- `4:3` -> `640 x 480`
- `3:4` -> `480 x 640`
- `16:9` -> `768 x 432`
- `9:16` -> `432 x 768`

### Graphs

Graph sizing is backend-owned.

Rules:

- use one exact fixed graph size
- do not resize during post-pass repair
- repair placement to reduce overlap and maximize visible area
- do not require full containment inside the viewport

Current graph preset:

- `720 x 475`

### Notation

Notation sizing is frontend-owned.

Rules:

- the backend supplies only the anchor
- the frontend renders the notation card content off-screen
- the frontend measures the true DOM size after layout and font readiness
- the measured dimensions become final widget `w/h`

This fixes the earlier failure mode where backend-estimated notation dimensions
caused clipping or excess whitespace.

## Post-Planner Repair Pass

Once the planner returns a center point, the backend deterministically repairs
the final rect against the compact geometry payload.

Current behavior:

- build the raw rect from `center - size / 2`
- choose the containing or nearest free rect
- evaluate the raw rect plus a small deterministic set of nudged candidates
- score candidates by:
  - zero-overlap if available
  - maximum visible area
  - minimum overlap area
  - minimum movement from the planned center
- emit final repaired top-left `x/y` with unchanged preset `w/h`

This gives the backend deterministic control over the final geometry while still
letting the model choose the semantically right region.

## Frontend Insertion Path

### Visual insertion

The frontend receives `canvas.insert_visual` and:

- validates the payload
- inserts the image into the tldraw canvas
- captures a focused screenshot of the inserted bounds
- sends `frontend_ack`

### Widget insertion

The frontend receives `canvas.insert_widget` and:

- validates whether the payload is graph or notation
- inserts the widget through the custom ThinkSpace widget shape
- captures a focused screenshot of the inserted bounds
- sends `frontend_ack`

For notation specifically, insertion is asynchronous because measurement must
finish before the final shape can be created.

## Toast And Status UX

The frontend normalizes backend progress copy into simpler learner-facing
language.

Examples:

- "Creating graph" becomes "Preparing graph"
- "Creating notation" becomes "Preparing notation"
- "Refreshing canvas view" becomes "Reviewing canvas"

This keeps backend operational wording separate from learner-facing status UX.

## Traces And Observability

### Visual traces

`canvas.generate_visual` trace files record:

- inputs
- context wait timing
- geometry-prep details
- planner trace
- image-generation trace
- final geometry
- final result and errors

### Widget traces

`canvas.generate_graph` and `canvas.generate_notation` trace files record:

- inputs
- context wait timing
- geometry-prep details
- planner trace
- reasoner trace
- final geometry or anchor payload
- final result and errors

## Key Files

- `backend/app/thinkspace_agent/tools/canvas_visuals.py`
- `backend/app/thinkspace_agent/tools/canvas_visual_jobs.py`
- `backend/app/thinkspace_agent/tools/canvas_widgets.py`
- `backend/app/thinkspace_agent/tools/canvas_widget_jobs.py`
- `backend/app/thinkspace_agent/tools/canvas_placement_geometry.py`
- `backend/app/thinkspace_agent/widgets/models.py`
- `backend/app/thinkspace_agent/widgets/reasoner.py`
- `frontend/client/pages/SessionCanvas.tsx`
- `frontend/client/components/widgets/ThinkspaceWidgetShapeUtil.tsx`
- `frontend/client/components/widgets/NotationWidget.tsx`
