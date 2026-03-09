# Gesture Story 2 Spec: Annotation And Drawing

## Progress Update

Implementation status: complete.

What is working now:

- Story 2 builds on the completed browser-native Story 1 runtime
- the draw gesture is recognized and stabilized in the browser
- the virtual cursor still renders and updates on the canvas
- gesture-driven drawing now uses the native `tldraw` draw tool through public editor APIs
- the runtime switches into `draw`, dispatches pointer lifecycle events, and restores the previous tool afterward
- releasing the draw gesture ends the same native stroke
- tracking loss and runtime stop cancel or finish the native draw session safely
- gesture diagnostics and logs are available in the live agent sidebar under a dedicated `Gestures` tab

Known follow-up:

- the label CSV still does not fully match classifier output count
- native draw feel still needs tuning to better match normal mouse drawing thickness and behavior

Recommended next step:

- Story 3 should focus on viewport pan only, while keeping the native draw path stable and tuning draw feel separately from new navigation gestures

## Story Summary

Story 2 builds on the completed Story 1 virtual cursor pipeline.

The goal is to let the user annotate directly on the `tldraw` canvas using gesture input, while reusing:

- browser camera
- browser hand tracking
- browser-side preprocessing
- browser-side TFLite classification
- gesture stability logic
- virtual cursor rendering
- debug HUD and structured logs

This story should be the first canvas mutation story because it produces the strongest visible result with the least architectural expansion beyond Story 1.

---

## Progress Prerequisite

Story 1 is complete and provides the foundation for this story.

What Story 2 can assume already exists:

- client-side gesture runtime mounted on the real canvas route
- live hand tracking in browser
- working TFLite classification in browser
- cursor gesture activation and smoothing
- virtual cursor overlay
- runtime HUD and logs

Known prerequisite issue to keep in mind:

- the label CSV and model output count do not fully match yet, so gesture naming should be treated carefully before locking Story 2 gesture semantics

---

## User Story

As a user, I want to enter a draw gesture and annotate directly on the canvas so that gesture input feels like a natural drawing tool inside ThinkSpace.

---

## Why This Story Comes Next

Story 2 is the best next story because it reuses almost all of Story 1 and introduces only one major new capability:

- converting stable gesture + cursor movement into a controlled drawing lifecycle

This proves the migration is no longer just showing a cursor. It proves the browser-native gesture stack can create meaningful canvas output.

---

## Story Goal

When the user opens the gesture-enabled canvas page and activates the system:

1. the cursor gesture still works as in Story 1
2. a drawing gesture can be recognized and stabilized
3. entering the drawing gesture starts an annotation stroke
4. holding the drawing gesture continues the stroke
5. moving the hand updates the stroke path
6. releasing or losing the drawing gesture ends the stroke safely
7. drawing feels deliberate enough for a demo
8. the drawing lifecycle is visible in the debug HUD and logs

---

## Non-Goals

To keep Story 2 focused, the following are out of scope:

- viewport panning
- zoom control
- tool switching
- eraser logic
- pressure simulation
- multi-hand drawing
- shape editing after creation
- advanced brush systems
- stroke beautification beyond minimal smoothing and decimation

---

## Primary Product Decision

Story 2 should implement **annotation only**, not “all gestures that affect the canvas.”

That means:

- the story owns only the drawing lifecycle
- pan/zoom/tool switching should be deferred to later stories
- drawing should not depend on broader navigation logic

This keeps the first mutation story coherent and easier to debug.

---

## Story Architecture

Story 2 extends the Story 1 pipeline with a new drawing layer.

### Runtime layers newly in scope

1. draw gesture activation
2. stroke lifecycle state machine
3. native draw-session driver
4. `tldraw` tool dispatch integration
5. stroke-specific HUD and diagnostics

### Existing layers reused from Story 1

1. camera runtime
2. hand tracking runtime
3. preprocessing runtime
4. classifier runtime
5. gesture stability runtime
6. cursor mapping runtime
7. virtual cursor rendering
8. debug visibility layer

---

## High-Level Data Flow

The Story 2 data flow should be:

1. browser camera stream runs
2. hand landmarks are detected
3. landmarks are preprocessed
4. TFLite classifier outputs a raw gesture
5. gesture stability logic determines whether draw mode is active
6. the virtual cursor continues to update
7. draw lifecycle decides whether to start / stream / end the native draw session
8. the runtime dispatches pointer events into the active `tldraw` draw tool
9. a visible native draw stroke appears and grows on the canvas
10. HUD and logs expose the full stroke state

---

## Story Principles

### Principle 1: Reuse the virtual cursor

Do not introduce a second pointer abstraction.

The drawing system should use the already-smoothed virtual cursor position as its main spatial signal.

### Principle 2: Drawing must be stateful

Drawing is not a one-shot action.

It needs:

- enter
- active drawing
- append point
- release
- cancellation or forced finish on tracking loss

### Principle 3: Safer is better than clever

A slightly conservative drawing gesture that starts reliably is better than a clever gesture that produces accidental strokes.

### Principle 4: The canvas owns the stroke

The gesture runtime should decide **when** the user is drawing.

The native `tldraw` draw tool should decide **how** that drawing becomes a stroke on the canvas.

---

## Functional Requirements

## FR1: Story 2 must preserve Story 1 behavior

Drawing must be added without breaking the current cursor workflow.

Expected behavior:

- virtual cursor still works
- camera/tracking/classifier/HUD still function
- the system can remain in cursor mode without drawing until draw gesture activates

Acceptance signals:

- cursor mode remains usable after drawing support is added
- enabling drawing does not degrade runtime initialization

---

## FR2: Draw gesture can be recognized and stabilized

The runtime must identify when the user is intentionally entering draw mode.

Expected behavior:

- draw mode is not activated directly from raw frame-by-frame predictions
- draw activation uses stability thresholds similar to Story 1
- draw deactivation is safe and predictable

Acceptance signals:

- logs show draw gesture enter/exit transitions
- HUD shows raw draw gesture vs stable draw state
- accidental transient classification changes do not start strokes

---

## FR3: Stroke lifecycle is explicit

The system must treat each annotation stroke as a lifecycle, not just a stream of points.

Expected behavior:

- entering draw mode begins a stroke
- remaining in draw mode appends points
- leaving draw mode ends the stroke
- tracking loss during draw mode finalizes safely

Acceptance signals:

- each stroke has a clear start and end
- no “half started forever” stroke state exists
- tracking loss does not leave drawing in a corrupt state

---

## FR4: Stroke points come from the virtual cursor path

The drawing system must use the cursor path already produced by Story 1.

Expected behavior:

- draw points come from the smoothed cursor signal
- raw points may still be inspected for debugging
- the visible stroke should reflect the same pointer the user sees

Acceptance signals:

- the stroke aligns with the visible cursor movement
- there is no mismatch between cursor and drawn line

---

## FR5: Point sampling is controlled

The system must not dump every noisy cursor sample into the stroke unfiltered.

Expected behavior:

- tiny jitter points should be ignored
- duplicated points should be avoided
- very sparse lines should still remain continuous enough for a demo

Acceptance signals:

- strokes look deliberate rather than noisy
- stationary hand does not spray dense artifacts into the line

---

## FR6: Canvas adapter creates real annotation output

Implementation note:

- the shipped Story 2 path now achieves this through the native `tldraw` draw tool, driven by `editor.setCurrentTool(...)`, `editor.dispatch(...)`, `editor.updatePointer(...)`, and explicit completion / cancellation behavior
- the original manual draw-shape adapter approach was replaced because the native tool gives live stroke growth on the canvas

The runtime must produce an actual visible draw shape on the `tldraw` canvas.

Expected behavior:

- drawing should create or update a draw/pen-like shape on the canvas
- the resulting annotation should persist on the canvas after gesture release
- the stroke should be part of the canvas state, not just a temporary overlay

Acceptance signals:

- finished annotations remain on the canvas
- the result behaves like real canvas content

---

## FR7: Tracking loss during drawing is safe

The system must behave correctly when the hand leaves frame mid-stroke.

Expected behavior:

- short tracking drop should not instantly corrupt the stroke
- longer tracking loss should end the stroke
- the system should recover cleanly when the hand returns

Acceptance signals:

- no runaway drawing
- no broken unfinished stroke state
- no jump line from old point to a later reacquired point

---

## FR8: Drawing observability is built in

The story must include strong debugging visibility.

Expected behavior:

- HUD shows draw state and stroke state
- logs show stroke lifecycle
- developers can inspect point counts and stroke transitions

Acceptance signals:

- developers can tell whether failures are in gesture activation, point sampling, or canvas write logic

---

## Recommended Drawing Interaction Model

For the hackathon, use a simple draw interaction model:

1. user is in normal tracking state
2. cursor gesture moves the virtual cursor
3. draw gesture activates draw mode
4. draw mode starts a stroke immediately
5. cursor movement appends points while draw mode remains stable
6. draw gesture release ends the stroke

Important:

- do not add pan/zoom conflicts into this story
- do not mix “draw mode” with “tool switch mode”
- drawing should be the only new persistent interaction

---

## Draw State Model

This story should define explicit draw states.

### Draw mode states

- `idle`
- `draw-arming`
- `drawing`
- `draw-ending`

### Stroke states

- `none`
- `starting`
- `active`
- `finishing`
- `cancelled`

### Tracking interaction states relevant to drawing

- `tracking`
- `tracking-lost-during-draw`

These states should be visible in the HUD and logs.

---

## Recommended Runtime Ownership

### Gesture runtime owns

- whether draw gesture is raw-detected
- whether draw gesture is stably active
- whether draw lifecycle should start or stop

### Drawing runtime owns

- current stroke id
- current point list
- filtering / decimation rules
- stroke start / append / finish decisions

### Canvas adapter owns

- creation or update of the `tldraw` draw shape
- final commit of finished annotation output

This separation prevents gesture logic from becoming tangled with canvas implementation details.

---

## Feature Tasks

Below are the implementation tasks for Story 2.

## Task 1: Lock the draw gesture mapping

Description:

Decide which classifier output represents the draw gesture for Story 2 and treat that mapping as explicit runtime configuration.

Responsibilities:

- choose the draw gesture id
- document the chosen gesture
- ensure it does not conflict with the existing cursor gesture

Done when:

- Story 2 has a clear source-of-truth draw gesture mapping

Notes:

- if the current label mismatch makes gesture naming unreliable, validate by observed behavior rather than label text alone

---

## Task 2: Extend gesture state to represent draw lifecycle

Description:

Add draw-specific state on top of the existing cursor/runtime pipeline.

Responsibilities:

- represent raw draw detection
- represent stable draw activation
- represent current stroke lifecycle status

Done when:

- draw state can be surfaced in the HUD and logs independently of cursor state

---

## Task 3: Implement draw activation stability

Description:

Add stability thresholds for entering and exiting draw mode, similar to cursor activation.

Responsibilities:

- define minimum confirmation window
- define miss tolerance
- avoid accidental stroke starts from flickering predictions

Done when:

- draw mode enters intentionally and does not chatter

---

## Task 4: Create stroke lifecycle controller

Description:

Introduce a dedicated controller that owns stroke start, append, and finish behavior.

Responsibilities:

- create a new stroke on draw enter
- append points while drawing
- finish stroke on release or tracking loss

Done when:

- each annotation stroke has a predictable lifecycle

---

## Task 5: Reuse cursor output as draw input

Description:

Use the Story 1 smoothed cursor as the main path signal for stroke generation.

Responsibilities:

- consume cursor point stream
- ensure stroke follows visible cursor
- keep raw point optional for diagnostics only

Done when:

- the drawn line visually follows the virtual cursor

---

## Task 6: Add point filtering / decimation

Description:

Prevent noisy point spam and improve stroke appearance.

Responsibilities:

- ignore extremely tiny cursor changes
- prevent duplicate consecutive points
- optionally resample large gaps if needed

Done when:

- strokes look reasonably clean during real use

---

## Task 7: Add canvas draw adapter

Description:

Connect the stroke lifecycle to actual `tldraw` draw shape creation/update.

Responsibilities:

- create a stroke shape at draw start
- update it as points are appended
- finalize it when drawing ends

Done when:

- finished annotations remain as canvas content after gesture release

---

## Task 8: Handle draw interruption and tracking loss

Description:

Make the stroke lifecycle robust when the hand disappears or runtime quality drops.

Responsibilities:

- end stroke safely on prolonged tracking loss
- avoid large jump segments after recovery
- prevent the runtime from staying stuck in drawing mode

Done when:

- hand loss does not corrupt canvas output

---

## Task 9: Extend debug HUD for drawing

Description:

Add drawing-specific diagnostics to the existing Story 1 HUD.

Responsibilities:

- show draw mode state
- show current stroke state
- show active stroke point count
- show draw gesture raw/stable state

Done when:

- drawing lifecycle is visible without reading logs

---

## Task 10: Add drawing lifecycle logs

Description:

Provide structured logs for draw behavior.

Responsibilities:

- log draw enter
- log stroke start
- log stroke finish
- log interruption / cancellation

Done when:

- draw failures can be diagnosed by looking at lifecycle logs

---

## Task 11: Tune Story 2 thresholds

Description:

Adjust draw-specific thresholds so annotation feels usable on the target machine.

Responsibilities:

- tune draw enter / exit thresholds
- tune point decimation rules
- tune interaction feel for responsiveness vs noise

Done when:

- the drawing demo feels intentional enough to show live

---

## Suggested Task Order

Tasks should be implemented in this order:

1. Task 1: lock draw gesture mapping
2. Task 2: extend gesture state for draw lifecycle
3. Task 3: implement draw activation stability
4. Task 4: create stroke lifecycle controller
5. Task 5: reuse cursor output as draw input
6. Task 6: add point filtering / decimation
7. Task 7: add canvas draw adapter
8. Task 8: handle interruption and tracking loss
9. Task 9: extend debug HUD
10. Task 10: add draw lifecycle logs
11. Task 11: tune thresholds

---

## Debugging And Visibility Requirements

## Logging strategy

Add the following structured log prefix to the existing Story 1 logging scheme:

- `[gesture:draw]`

Useful events to log:

- draw gesture raw detected
- draw gesture stable entered
- draw gesture stable exited
- stroke started
- stroke appended
- stroke finished
- stroke cancelled
- tracking lost during draw

Default logs should remain transition-based, not per-frame spam.

---

## HUD requirements for Story 2

The existing HUD should be extended with:

- draw gesture raw state
- draw gesture stable state
- draw lifecycle state
- active stroke point count
- whether stroke is currently being created or finalized

Optional:

- current stroke id
- number of filtered points dropped

---

## Visual Debugging Requirements

Useful visual debugging additions for Story 2:

- optional stroke preview while drawing
- visual indicator when draw mode is armed or active
- optional raw cursor ghost vs actual stroke path

This is especially helpful when trying to separate:

- gesture activation problems
- cursor mapping problems
- stroke generation problems

---

## Technical Design Constraints

### Constraint 1: Story 2 must remain fully client-side

No backend participation should be introduced.

### Constraint 2: Story 2 depends on Story 1 runtime

Do not duplicate camera/tracking/classifier logic.

### Constraint 3: Story 2 should use one hand only

Do not add multi-hand complexity here.

### Constraint 4: Story 2 should not expand into navigation

Pan and zoom should remain future stories.

### Constraint 5: Drawing quality should be “demo good,” not perfect

Avoid overengineering brush systems or stroke beautification in this story.

---

## Failure Diagnosis Guide

If Story 2 fails, debug in this order.

### Case 1: Draw gesture never activates

Check:

- label mapping correctness
- draw gesture stability thresholds
- confidence threshold

### Case 2: Draw gesture activates but no stroke appears

Check:

- stroke lifecycle controller
- canvas draw adapter
- whether a stroke is being started but not committed

### Case 3: Stroke appears but does not follow cursor

Check:

- whether draw is using smoothed cursor point or some other signal
- cursor-to-stroke coordinate alignment

### Case 4: Stroke is too noisy

Check:

- point filtering
- cursor smoothing
- draw exit/entry flicker

### Case 5: Stroke never ends

Check:

- draw exit stability logic
- tracking loss finalization rules
- stroke lifecycle cleanup

### Case 6: Tracking loss ruins the annotation

Check:

- interruption handling
- freeze/hide timing
- whether reacquired points are appended to a stale stroke

---

## Acceptance Criteria

Story 2 is complete when all of the following are true:

- Story 1 cursor behavior still works
- a draw gesture can be recognized and stabilized
- entering the draw gesture starts a canvas annotation stroke
- moving the hand while drawing extends the stroke
- releasing the draw gesture ends the stroke
- tracking loss during drawing ends safely
- the resulting stroke remains on the `tldraw` canvas
- sidebar diagnostics and logs make draw lifecycle diagnosable
- drawing quality is good enough for a live demo

---

## MVP Demo Of Story 2

The Story 2 demo should look like this:

1. user opens the canvas page
2. user starts the gesture runtime
3. virtual cursor appears and follows hand movement
4. user performs the draw gesture
5. a stroke begins on the canvas
6. user moves their hand and the stroke extends
7. user releases the draw gesture
8. the stroke ends and remains on the canvas
9. the `Gestures` sidebar tab shows drawing state, preview, and runtime logs throughout

This is the first story that proves the browser-native gesture system can create real application content.

---

## Exit Criteria Before Starting Story 3

Do not move to pan until:

- drawing can start and stop reliably
- strokes look reasonably clean
- tracking loss does not corrupt annotation
- gesture state and stroke lifecycle are both visible in sidebar diagnostics

Story 3 should build on a stable drawing interaction, not compete with an unfinished one.

---

## Recommended Next Story After Completion

After Story 2 is complete, the next recommended story is:

- Story 3: viewport pan

After that:

- Story 4: simple zoom
- Story 5: tool switching
