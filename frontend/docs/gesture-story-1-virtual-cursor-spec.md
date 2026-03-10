# Gesture Story 1 Spec: Virtual Cursor

## Progress Update

Implementation status: complete.

What is working now:

- camera start/stop from the browser
- one-hand tracking in the browser
- browser-side preprocessing compatible with the Python runtime
- browser-side TFLite classifier loading and inference
- stable cursor gesture activation
- virtual cursor rendering on the canvas
- gesture diagnostics with live preview, timings, cursor state, and runtime warnings
- diagnostics rendered in the live agent sidebar under the `Gestures` tab instead of floating over the canvas

Known follow-up:

- the label CSV currently does not fully match the classifier output count, so gesture naming needs one cleanup pass before expanding into more gesture stories
- Story 2 native drawing works, but draw-feel tuning is still needed to better match normal mouse drawing
- Story 3 pan is now complete, but its interaction model may still be refined from simple hand-following into a more anchored grab-and-pull feel

Recommended next step:

- Story 4 should focus on simple zoom, while label cleanup and draw-feel tuning continue as follow-up polish on the completed cursor, draw, and pan foundation

## Story Summary

Story 1 is the first implementation milestone for browser-native gestures in `frontend/`.

The goal is to build the entire realtime pipeline up to a visible, stable, debuggable virtual cursor on the `tldraw` canvas.

This story does **not** include:

- drawing
- pan
- zoom
- tool switching
- gesture-driven canvas mutations

Those will depend on the foundations established here.

---

## User Story

As a user, I want my hand to control a virtual cursor inside the canvas so that I can aim at the canvas naturally without moving the real OS cursor.

---

## Why This Story Comes First

The virtual cursor story is the smallest complete vertical slice of the migrated architecture.

It proves:

- browser camera access
- browser hand tracking
- browser-side preprocessing parity with Python
- browser-side gesture classification
- stable gesture activation
- reliable coordinate mapping into the canvas
- visible feedback and debugging from the start

If this story is weak, everything built on top of it will feel unstable.

---

## Story Goal

When the user opens the gesture-enabled canvas page:

1. the camera can be started from the browser
2. one hand can be tracked in real time
3. the browser can run the existing gesture classifier
4. the cursor gesture can be detected stably
5. a virtual cursor appears inside the canvas
6. the cursor moves smoothly and predictably
7. tracking loss is handled safely
8. all stages are visible through logs and a debug HUD

---

## Non-Goals

To keep the first story focused, the following are out of scope:

- draw gesture lifecycle
- canvas stroke creation
- viewport panning
- zoom control
- tool switching
- multiple hands
- browser-to-backend gesture streaming
- desktop wrapper support
- browser control of the real OS cursor

---

## Primary Product Decision

The system will use a **virtual cursor**, not the real browser or OS cursor.

### Rationale

- browsers should not be relied on to move the real OS cursor
- a virtual cursor is app-owned and canvas-scoped
- smoothing and bounds control become easier
- tracking loss can be handled safely
- later gesture actions can be built around the same pointer abstraction

---

## Story Architecture

Story 1 should be built as a client-side gesture pipeline mounted from the canvas page.

### Runtime layers in scope

1. camera runtime
2. hand tracking runtime
3. preprocessing runtime
4. classifier runtime
5. gesture stability runtime
6. cursor mapping runtime
7. virtual cursor rendering
8. debug/visibility layer

---

## High-Level Data Flow

The data flow for Story 1 should be:

1. browser camera stream starts
2. frame is read by the hand-tracking layer
3. hand landmarks are returned
4. landmarks are converted into the classifier input vector
5. browser TFLite classifier returns a gesture prediction
6. stability logic determines whether the cursor gesture is active
7. a control landmark is mapped into canvas coordinates
8. cursor smoothing is applied
9. virtual cursor is rendered
10. debug HUD and structured logs reflect the current pipeline state

---

## Functional Requirements

## FR1: Gesture system can be initialized from the canvas page

The gesture runtime must be mountable from the main canvas experience in `frontend/`.

Expected behavior:

- the gesture feature initializes only in the canvas experience
- the gesture feature can start in a controlled way
- failures are surfaced clearly to the developer and user

Acceptance signals:

- the gesture runtime reports initialization lifecycle in logs
- the page can expose whether the runtime is off, loading, ready, or failed

---

## FR2: Camera acquisition works fully client-side

The browser must request camera permission and start a local webcam stream.

Expected behavior:

- user is prompted for camera permission
- successful access yields a usable video stream
- denied access is surfaced clearly
- camera readiness state is visible

Acceptance signals:

- camera state is visible in a debug panel
- camera dimensions are known once ready
- permission denial produces a visible error state

---

## FR3: One-hand tracking works in real time

The runtime must track a single hand in the browser.

Expected behavior:

- only one hand is needed for the MVP
- hand presence and loss are distinguishable
- tracking state is updated continuously
- confidence state is available for debugging

Acceptance signals:

- debug HUD shows whether a hand is present
- system can distinguish no-hand vs tracking
- inference timing can be surfaced

---

## FR4: Browser preprocessing matches Python preprocessing semantics

The current Python preprocessing logic should be treated as the source of truth.

Expected behavior:

- the same landmark ordering is used
- coordinates are converted to relative coordinates in the same way
- the vector is flattened to the same shape
- normalization semantics match the Python path as closely as possible

Acceptance signals:

- the produced vector length matches the expected model input shape
- preprocessing errors are surfaced clearly
- invalid vectors do not silently proceed

---

## FR5: Existing classifier runs client-side in the browser

The current `Gesture/` TFLite classifier should be reused in-browser.

Expected behavior:

- the model loads on the client
- inference runs without backend round-trips
- live gesture labels can be surfaced
- prediction confidence is visible where possible

Acceptance signals:

- debug HUD shows model loading state
- logs show model init success or failure
- current predicted class and label are visible

Important note:

- label mapping must be validated carefully during implementation because the current label file and class count appear inconsistent

---

## FR6: Cursor gesture activation is stable

The system must not drive the cursor directly from every raw classifier result.

Expected behavior:

- raw classifier outputs go through a stability filter
- a cursor gesture only becomes active after a stability threshold
- the active gesture exits safely when the signal drops or changes

Acceptance signals:

- debug state includes raw gesture and stable gesture
- logs show stable gesture enter/exit transitions
- brief classification flicker does not constantly show/hide the cursor

---

## FR7: A control point is mapped into canvas coordinates

Once the cursor gesture is stable, the runtime must derive a cursor position inside the canvas.

Expected behavior:

- a consistent landmark is chosen as the control point
- camera-space coordinates are translated into canvas-local coordinates
- the result respects visible canvas bounds

Acceptance signals:

- debug HUD shows raw point and mapped point
- cursor motion corresponds directionally with hand motion
- cursor does not render outside intended bounds

---

## FR8: Cursor motion is smoothed

The virtual cursor must be smoother than the raw hand signal.

Expected behavior:

- smoothing happens after mapping into the cursor layer
- raw position and smoothed position remain distinguishable in debugging
- motion should feel deliberate, not twitchy

Acceptance signals:

- visible cursor motion is less jittery than raw control point motion
- debug mode can show raw vs smoothed values
- smoothing does not add unusable lag

---

## FR9: Tracking loss is handled safely

Tracking loss must not cause erratic cursor behavior.

Expected behavior:

- when tracking is lost, cursor does not teleport
- cursor can freeze briefly or dim before hiding
- loss state is visible to the user or developer

Acceptance signals:

- logs show tracking loss transitions
- cursor behavior is consistent on loss and recovery
- system recovers cleanly when the hand returns

---

## FR10: Full observability exists from day one

The story must be built with debugging visibility from the start.

Expected behavior:

- structured logs exist for each runtime layer
- a debug HUD exists on the page
- major lifecycle transitions are visible without opening source code

Acceptance signals:

- initialization failures are easy to identify
- camera, tracking, classifier, and cursor states are all inspectable
- developers can tell whether an issue is camera, landmarks, preprocessing, classification, or mapping

---

## Debugging And Visibility Requirements

## Logging strategy

Use structured subsystem prefixes:

- `[gesture:host]`
- `[gesture:camera]`
- `[gesture:tracking]`
- `[gesture:preprocess]`
- `[gesture:classifier]`
- `[gesture:stability]`
- `[gesture:cursor]`
- `[gesture:hud]`

### Log only important transitions by default

Good default logs:

- runtime init start/success/failure
- camera permission requested/granted/denied
- camera stream start/stop
- tracking acquired/lost
- model load success/failure
- gesture class changes
- stable cursor gesture enter/exit
- cursor hidden/frozen/shown

Avoid:

- logging every frame in normal mode

### Debug verbosity modes

There should be a clear distinction between:

- `off`
- `basic`
- `verbose`

`basic`:

- lifecycle transitions
- current state snapshot in HUD

`verbose`:

- timing numbers
- raw/smoothed cursor values
- sample preprocessing values
- top class probabilities if available

---

## Debug HUD requirements

The page should include a compact debug HUD for this story.

### Minimum HUD fields

- camera state
- camera dimensions
- tracking state
- hand detected yes/no
- current raw gesture label
- current stable gesture label
- classifier confidence if available
- last inference duration
- raw cursor position
- smoothed cursor position
- cursor visibility state

### Optional but valuable

- mini camera preview
- mini landmark preview
- top-N classes
- last tracking update time

The HUD is developer-facing and can be basic in appearance.

---

## Visual Debugging Requirements

In addition to text logs and state panels, visual debugging should be considered part of the story.

Useful visual signals:

- camera preview thumbnail
- tracking on/off badge
- cursor visible/inactive badge
- optional raw point marker vs smoothed cursor marker

These help differentiate:

- hand tracking issues
- mapping issues
- smoothing issues

---

## Runtime State Model

This story should use explicit states, not implicit booleans spread across the system.

## Camera states

- `idle`
- `requesting`
- `ready`
- `denied`
- `error`

## Tracking states

- `no-hand`
- `tracking`
- `low-confidence`
- `lost`

## Model states

- `uninitialized`
- `loading`
- `ready`
- `error`

## Gesture states

- `none`
- `raw-cursor-detected`
- `stable-cursor-active`

## Cursor states

- `hidden`
- `visible`
- `frozen`

These states should be represented in a way that can be surfaced in the HUD and logs.

---

## Technical Design Constraints

### Constraint 1: Entire story runs client-side

No backend or worker round-trip should be part of the realtime cursor loop.

### Constraint 2: Single hand only

Do not introduce multi-hand complexity in Story 1.

### Constraint 3: Browser does not move the OS cursor

The system only renders and controls an internal app cursor.

### Constraint 4: Python preprocessing semantics are the source of truth

The browser preprocessing path should match the Python path as closely as possible.

### Constraint 5: `SessionCanvas` is the integration host

The feature should integrate with the canvas page rather than being built as an isolated experiment.

---

## Feature Tasks

Below are the implementation tasks for Story 1. They are intentionally technical, but still kept above code-level detail.

## Task 1: Add gesture runtime host to the canvas page

Description:

Create a single integration point on the canvas page that owns gesture startup, state wiring, and teardown.

Responsibilities:

- mount only in the canvas experience
- own global gesture runtime lifecycle
- provide runtime state to overlays/HUD

Done when:

- the page can report whether the gesture runtime is off, loading, ready, or failed

---

## Task 2: Add camera lifecycle support

Description:

Implement the browser camera start/stop and permission flow with clear state reporting.

Responsibilities:

- request permission
- start stream
- expose video readiness
- expose camera errors

Done when:

- the runtime can distinguish ready, denied, and error states clearly

---

## Task 3: Add browser hand tracking

Description:

Initialize browser hand tracking and produce one-hand landmark results continuously.

Responsibilities:

- initialize browser MediaPipe hand tracking
- process frames continuously
- expose landmark results and tracking confidence

Done when:

- hand presence can be seen live in the HUD

---

## Task 4: Port preprocessing semantics from Python

Description:

Translate the existing landmark preprocessing semantics into the browser runtime.

Responsibilities:

- reproduce relative coordinate conversion
- reproduce flattening and normalization
- validate input shape for the classifier

Done when:

- preprocessing produces stable model input vectors and surfaces errors clearly

---

## Task 5: Load and run the existing TFLite classifier in browser

Description:

Reuse the current gesture classifier directly in the client runtime.

Responsibilities:

- load model asset
- run live inference
- emit gesture id/label/confidence

Done when:

- live gesture labels are visible in the HUD

---

## Task 6: Validate and reconcile gesture labels

Description:

Make the browser runtime’s label output trustworthy by validating the current label mapping.

Responsibilities:

- verify class count vs label file
- define the source-of-truth label mapping for browser use
- surface unknown or inconsistent mapping as a visible error if needed

Done when:

- cursor gesture label is confidently known and stable for development

---

## Task 7: Add gesture stability logic for cursor activation

Description:

Wrap raw classifier output in a lightweight state machine that decides when cursor mode is truly active.

Responsibilities:

- define enter threshold
- define exit threshold
- avoid frame-by-frame flicker

Done when:

- cursor activation is visibly more stable than raw classifier output

---

## Task 8: Map control landmark to canvas-local cursor position

Description:

Convert a hand landmark into a cursor point that is meaningful inside the canvas.

Responsibilities:

- choose control point
- map camera coordinates into canvas coordinates
- clamp within usable bounds

Done when:

- cursor position corresponds directionally to hand motion over the canvas

---

## Task 9: Add cursor smoothing

Description:

Stabilize virtual cursor motion without making it feel sluggish.

Responsibilities:

- apply smoothing after mapping
- preserve responsiveness
- expose raw vs smoothed values for debugging

Done when:

- cursor motion is usable and less jittery than raw motion

---

## Task 10: Render the virtual cursor overlay

Description:

Display a visible cursor on top of the canvas using app-owned UI.

Responsibilities:

- render above the `tldraw` canvas
- show active/inactive state
- support hidden/frozen states

Done when:

- the user can see the cursor move as the hand moves

---

## Task 11: Handle tracking loss and recovery

Description:

Implement predictable behavior when the hand leaves frame or the signal becomes unreliable.

Responsibilities:

- freeze or dim cursor on short loss
- hide after longer loss if desired
- recover cleanly when tracking returns

Done when:

- cursor never teleports erratically on tracking loss/recovery

---

## Task 12: Add debug HUD and structured runtime logging

Description:

Provide implementation-time visibility into every stage of the story.

Responsibilities:

- add HUD with core runtime state
- add consistent structured logs
- support debug verbosity levels

Done when:

- a developer can tell which stage failed without digging through code

---

## Suggested Task Order

Tasks should be implemented in this order:

1. Task 1: gesture runtime host
2. Task 2: camera lifecycle
3. Task 3: browser hand tracking
4. Task 4: preprocessing parity
5. Task 5: browser classifier
6. Task 6: label validation
7. Task 7: stability logic
8. Task 8: cursor mapping
9. Task 9: cursor smoothing
10. Task 10: virtual cursor overlay
11. Task 11: tracking loss handling
12. Task 12: debug HUD and logs

Note:

- the HUD and logs should begin early, but this is the full feature completion order

---

## Failure Diagnosis Guide

If Story 1 does not behave correctly, debug in this order.

### Case 1: No camera

Check:

- permission state
- stream lifecycle
- video readiness state

### Case 2: Camera works, but no hand tracking

Check:

- hand tracker init
- frame processing loop
- detection confidence thresholds

### Case 3: Hand tracking works, but gesture label is wrong

Check:

- preprocessing parity
- vector length and ordering
- model input expectations
- label mapping

### Case 4: Gesture label works, but cursor motion is wrong

Check:

- selected control landmark
- coordinate mapping logic
- canvas bounds and offsets
- mirroring assumptions

### Case 5: Cursor feels jittery

Check:

- smoothing parameters
- stable gesture enter/exit thresholds
- whether the raw point itself is noisy

### Case 6: Cursor disappears unpredictably

Check:

- tracking loss thresholds
- confidence drop handling
- visibility state transitions

---

## Acceptance Criteria

Story 1 is complete when all of the following are true:

- the gesture runtime can initialize on the canvas page
- camera permission and readiness are visible and reliable
- one-hand tracking works client-side
- the existing TFLite classifier runs in-browser
- the cursor gesture is detected with stability logic
- a virtual cursor is rendered over the canvas
- cursor motion feels smooth enough for aiming
- tracking loss is handled safely
- structured logs exist for all main runtime layers
- a debug HUD exposes camera, tracking, model, gesture, and cursor state

---

## MVP Demo Of Story 1

The Story 1 demo should look like this:

1. user opens the canvas page
2. user enables gestures
3. camera becomes ready
4. debug HUD shows tracking and classifier state
5. user performs the cursor gesture
6. virtual cursor appears and follows the hand smoothly
7. user removes hand from frame
8. cursor freezes or fades safely
9. user returns hand to frame
10. cursor recovers cleanly

This is the first meaningful proof that the browser-native migration is on the right path.

---

## Exit Criteria Before Starting Story 2

Do not move to annotation until:

- cursor mapping is directionally correct
- cursor motion is stable enough to aim with
- label mapping is trusted
- tracking loss does not create erratic behavior
- debug visibility is good enough to diagnose the next layer of work

Story 2 depends directly on Story 1 being solid.
