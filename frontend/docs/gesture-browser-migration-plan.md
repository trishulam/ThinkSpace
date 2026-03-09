# Gesture Browser Migration Plan

## Progress Update

Current implementation status:

- Story 1 is complete and working end to end in the browser.
- Story 2 is complete and working on the real `tldraw` canvas.
- The hosted frontend now runs the full gesture pipeline client-side.
- Webcam access, browser MediaPipe hand tracking, browser TFLite classification, stability filtering, and a virtual cursor are all wired into the real canvas route.
- Gesture-driven drawing now uses the native `tldraw` draw tool through public editor APIs, instead of manually assembling draw shapes.
- Gesture diagnostics have moved out of the canvas overlay and into the live agent sidebar under a dedicated `Gestures` tab.
- Structured gesture logs now stream into the sidebar alongside runtime state, preview, timings, and native draw-session diagnostics.

Current known issue:

- The gesture label CSV and classifier output count are mismatched, so some labels should not yet be treated as final source of truth.
- The current native draw path still needs UX tuning for brush feel parity with normal mouse drawing.

Recommended next build order:

1. Fix the label mapping mismatch so gesture names are trustworthy.
2. Tune native draw feel so thickness and stroke behavior match normal cursor drawing more closely.
3. Implement Story 3: viewport pan.
4. Implement Story 4: simple zoom.
5. Implement Story 5: low-frequency tool switching.

## Goal

Migrate the current local Python `Gesture/` runtime from:

- webcam + MediaPipe + TFLite classification
- OS-level control through `pyautogui` / `pynput`

to a browser-native pipeline inside `frontend/` that powers the `tldraw` canvas directly.

Primary desired outcomes:

- live webcam hand tracking in the browser
- browser-side gesture classification using the existing `.tflite` model
- a virtual cursor inside the canvas
- gesture-driven canvas actions:
  - move cursor
  - annotate / draw
  - pan
  - zoom
  - switch tools

This document is a product and architecture plan, not a code-level implementation spec.

---

## Executive Recommendation

For the hackathon, the best path is:

1. Rebuild the perception and classification pipeline in the browser.
2. Keep the current gesture model and landmark preprocessing logic.
3. Stop using OS actions as the primary interaction layer.
4. Make the `tldraw` canvas the owner of all gesture semantics.
5. Use a virtual cursor inside the canvas.

This is the easiest path that still produces a coherent product story and a reliable demo.

---

## Key Decision: Should The Browser Move The OS Cursor?

Short answer: no, not as the main design.

### Why not

- Browsers do not provide a reliable, standard, safe way to move the real OS cursor.
- Even if a workaround existed through native bridges or hacks, it would put us back into the same architecture problem we are trying to leave behind.
- OS cursor control is the wrong abstraction for canvas-native actions like pan, zoom, and tool switching.

### What to do instead

Use a virtual cursor rendered inside the canvas layer.

Benefits:

- fully controlled by the app
- can be smoothed independently from raw landmarks
- can be bounded to the canvas
- avoids accidental OS-wide side effects
- fits naturally with `tldraw`

Conclusion:

- do not design around browser control of the real OS cursor
- design around a browser-native virtual cursor

---

## Why This Migration Is Worth Doing

The current Python app proves that:

- the gesture recognition pipeline is viable
- the cursor concept feels smooth enough
- annotation by gesture is possible

But the current action layer is a hack:

- it controls the operating system rather than the application
- it cannot naturally express canvas semantics
- it makes pan / zoom / tool ownership awkward
- it is harder to ship as part of a hosted web app

The right long-term abstraction is:

- `camera -> landmarks -> classifier -> gesture runtime -> canvas actions`

not:

- `camera -> landmarks -> classifier -> OS mouse / keyboard`

---

## Current System Summary

The current Python app in `Gesture/` does the following:

1. Opens the webcam with OpenCV.
2. Detects hand landmarks with MediaPipe Hands.
3. Preprocesses 21 landmarks into normalized relative coordinates.
4. Runs the preprocessed vector through a TFLite classifier.
5. Maps predicted gesture IDs to OS actions using `pyautogui` and `pynput`.
6. Sends occasional webhook updates to a frontend endpoint.

Important observations:

- the classifier and preprocessing logic are reusable
- the OS-action layer is not
- the webhook pattern is too coarse for smooth cursoring and direct canvas control

---

## Target Architecture In `frontend/`

The entire realtime pipeline should live inside `frontend/client/`.

### Layer 1: Camera Input

Responsibilities:

- request webcam permission
- start / stop the video stream
- expose frame timing and video dimensions
- handle no-camera or denied-permission states

Browser equivalent of the Python OpenCV capture loop.

### Layer 2: Hand Tracking

Responsibilities:

- run browser MediaPipe hand landmark detection
- return one-hand landmarks, confidence, and tracking state
- expose a frame-by-frame hand result

Notes:

- one-hand support is enough for the hackathon
- multi-hand should be considered out of scope initially

### Layer 3: Landmark Preprocessing

Responsibilities:

- mirror the Python preprocessing logic closely
- convert landmarks into the same shape expected by the model
- normalize to the same scale and ordering used by the current TFLite classifier

This is one of the most important compatibility layers in the migration.

### Layer 4: Gesture Classification

Responsibilities:

- load the existing `keypoint_classifier.tflite`
- run inference in-browser
- return gesture ID, label, confidence, and maybe top-N scores

This should preserve the current gesture vocabulary as much as possible.

### Layer 5: Gesture Runtime

Responsibilities:

- smooth jittery predictions
- apply debounce and hysteresis
- distinguish between one-shot and persistent gestures
- manage lifecycle states like enter / active / release
- emit clean app-level gesture state

This is the core of the new design.

### Layer 6: Canvas Adapter

Responsibilities:

- map gesture runtime outputs to `tldraw` behavior
- update the virtual cursor
- start / continue / end drawing
- pan the viewport
- zoom the viewport
- switch tools

This layer should be the only place that knows how gestures affect the canvas.

### Layer 7: Gesture UI

Responsibilities:

- render the virtual cursor
- show current gesture label
- show current interaction mode
- show tool state
- show tracking / camera health
- optionally show a small debug HUD

This improves both debugging and demo clarity.

---

## Why `frontend/` Is The Right Home

The current frontend already has a strong host environment for this:

- `frontend/client/pages/SessionCanvas.tsx` owns the `Tldraw` canvas mount
- the app already uses `tldraw` abstractions and action patterns
- the frontend already has a pattern for realtime hooks and stateful client managers

This means gesture support can be added as a first-class client feature without going through the worker or backend.

Important rule:

- all gesture runtime behavior should remain client-side
- the Cloudflare worker should not be involved in frame-by-frame gesture control

---

## Recommended Interaction Model

The migration should not merely port gesture labels. It should port the usable interaction model.

### Core principle

Frontend owns application semantics.

That means:

- the classifier says what gesture is likely being made
- the gesture runtime decides if the gesture is stable enough
- the canvas adapter decides what that means in `ThinkSpace`

### Why this matters

The same gesture can mean different things depending on context:

- when the active tool is draw, pointer movement may guide stroke creation
- when in navigation mode, the same movement may pan
- when a zoom mode is active, vertical movement may scale the viewport

The canvas, not the classifier, should own these meanings.

---

## Virtual Cursor Plan

Yes, the migration should include a virtual cursor.

### Purpose

The virtual cursor becomes the app-owned pointer abstraction for all gesture-driven interactions.

### Behavior

It should:

- be rendered only inside the canvas experience
- derive from a stable hand reference point, likely the index fingertip
- be smoothed to reduce jitter
- be clamped to visible canvas bounds
- freeze or fade gracefully when tracking is lost
- optionally remain visible in idle tracking state for user confidence

### Why it is necessary

Without a virtual cursor, users lose:

- a clear visual anchor for gesture targeting
- predictable hover / focus semantics
- a stable origin for zooming and drawing

The virtual cursor should be treated as a first-class UX feature, not a debug aid.

---

## Recommended Gesture Semantics

For the hackathon, reduce the vocabulary to a small reliable set.

### MVP interaction set

- `cursor`
- `draw`
- `pan`
- `zoom`
- `tool-switch`
- `idle` / neutral

### Persistent gestures

Use persistent gestures for:

- cursor movement
- drawing
- pan
- zoom if implemented as continuous control

These should have:

- a stability threshold before entering
- active updates every frame
- a release transition

### One-shot gestures

Use one-shot gestures for:

- tool switching
- toggles
- mode changes

These should have:

- debounce
- cooldown
- intentional hold or confirmation

---

## Canvas Action Stories

These stories describe the intended behavior from the user’s perspective.

### Story 1: Virtual cursor movement

As a user, I want my detected hand position to control a virtual cursor on the canvas so that I can aim at content without moving the system cursor.

Success criteria:

- cursor follows hand smoothly
- cursor feels stable and not jumpy
- cursor does not leave the meaningful canvas area
- cursor stops gracefully when tracking is lost

### Story 2: Annotation

As a user, I want to enter a draw gesture and annotate directly on the canvas so that gesture input feels like an intentional drawing tool.

Success criteria:

- entering the draw gesture starts a stroke
- holding the gesture continues the stroke
- releasing the gesture ends the stroke
- the resulting line quality is acceptable for a demo

### Story 3: Pan

As a user, I want a gesture that lets me move the viewport across the canvas so that I can navigate the workspace without relying on the OS mouse.

Success criteria:

- a navigation gesture enters pan mode
- hand motion moves the viewport predictably
- pan exits cleanly when the gesture stops
- pan does not conflict with drawing

### Story 4: Zoom

As a user, I want to zoom in and out of the canvas using gestures so that I can navigate scale without keyboard or mouse wheel input.

Success criteria:

- zoom is understandable and intentional
- zoom does not oscillate wildly
- zoom centers around either the virtual cursor or a defined viewport center

### Story 5: Tool switching

As a user, I want a simple gesture to switch tools so that I can move between select and draw without touching the UI.

Success criteria:

- switching is low-frequency and deliberate
- accidental switching is rare
- tool state is visible in the UI

### Story 6: Tracking loss recovery

As a user, I want the system to fail gracefully when my hand leaves frame or tracking confidence drops so that the canvas does not behave unpredictably.

Success criteria:

- active gestures end safely
- cursor does not jump unpredictably on return
- UI clearly indicates lost tracking

### Story 7: Camera readiness

As a user, I want clear states for camera permission and camera readiness so that I understand why gestures are or are not working.

Success criteria:

- permission denied is visible
- camera not found is visible
- loading state is visible
- successful tracking state is visible

---

## Recommended Scope For Hackathon MVP

### In scope

- browser webcam access
- browser MediaPipe hand landmark detection
- browser-side reuse of the current TFLite classifier
- landmark preprocessing parity with Python
- single-hand tracking only
- virtual cursor
- annotation
- pan
- simple zoom
- simple tool switching
- small gesture status HUD

### Out of scope

- desktop wrapper
- extension bridge
- moving the real OS cursor from the browser
- worker/backend involvement in realtime gesture control
- multi-hand gesture vocabulary
- model retraining unless strictly required
- full parity with every current Python gesture
- global OS shortcuts

---

## Translation Plan: Python To Browser

### Python OpenCV capture -> Browser camera stack

Replace:

- `cv.VideoCapture`
- `cv.imshow`
- OpenCV frame loop

With:

- browser webcam APIs
- video element
- animation or frame callback loop
- optional canvas overlay for debug rendering

### Python MediaPipe Hands -> Browser MediaPipe hand tracking

Replace:

- Python MediaPipe runtime

With:

- official browser MediaPipe hand-landmarker stack

### Python preprocessing -> Browser preprocessing parity

Port:

- landmark extraction order
- relative-coordinate conversion
- flattening to 42 values
- normalization by the max absolute value

This must closely match the current Python implementation to preserve classifier behavior.

### Python TFLite interpreter -> Browser TFLite runtime

Replace:

- TensorFlow Lite Python interpreter

With:

- browser-side TFLite inference

### Python OS actions -> Browser canvas adapter

Replace:

- `pyautogui`
- `pynput`
- OS scroll / click / drag / hotkey semantics

With:

- app-owned gesture runtime
- `tldraw` viewport control
- virtual cursor state
- stroke lifecycle control
- tool switching logic

### Python webhook updates -> Internal client state

Replace:

- network POSTs for state updates

With:

- local React state / controller state / canvas adapter state

For the migrated design, network transport is unnecessary for gesture control.

---

## Proposed Browser Feature Modules

The exact filenames can evolve, but the responsibility split should stay clear.

### Camera module

Owns:

- camera permission
- media stream lifecycle
- video readiness

### Hand tracking module

Owns:

- MediaPipe initialization
- live landmark results
- confidence and hand-presence state

### Classifier module

Owns:

- preprocessing parity
- TFLite model loading
- inference results

### Gesture runtime module

Owns:

- smoothing
- debounce
- hysteresis
- active gesture lifecycle
- cooldowns

### Virtual cursor module

Owns:

- cursor position
- smoothing
- clamping
- visibility state

### Canvas gesture controller

Owns:

- mapping gesture runtime state into `tldraw` operations
- viewport transforms
- drawing lifecycle
- tool changes

### Gesture HUD module

Owns:

- current gesture label
- current mode
- current tool
- camera / tracking state

---

## State Model

The implementation should define explicit states up front.

### Camera states

- `idle`
- `requesting-permission`
- `ready`
- `denied`
- `error`

### Tracking states

- `no-hand`
- `tracking`
- `low-confidence`
- `lost`

### Interaction states

- `idle`
- `cursor`
- `draw`
- `pan`
- `zoom`
- `switching-tool`

### Cursor states

- `hidden`
- `visible`
- `frozen`
- `active`

### Tool states

- `select`
- `draw`
- `eraser` if cleanly supported

These states should be explicit, not implicit, because gesture systems otherwise become difficult to reason about.

---

## Gesture Runtime Rules

This layer is where the migration succeeds or fails.

### Rule 1: Raw classifier output should not directly trigger actions

The runtime must first decide:

- is the gesture stable
- is it entering
- is it active
- is it exiting
- is it in cooldown

### Rule 2: Persistent gestures need lifecycle events

Persistent gestures should support:

- enter
- active update
- exit

Examples:

- draw
- pan
- cursor

### Rule 3: One-shot gestures need debounce

One-shot actions must not repeat every frame.

Examples:

- tool switch
- mode toggle

### Rule 4: Lost tracking must be safe

If tracking fails:

- active drawing must end safely
- pan must stop
- zoom must stop
- cursor should freeze or fade, not teleport

---

## Zoom Design Recommendation

Zoom is likely the trickiest interaction to make feel good quickly.

For the hackathon:

- keep zoom deliberately simple
- use a dedicated zoom mode
- map hand vertical movement to zoom delta
- anchor zoom around the virtual cursor or a stable viewport center

Do not attempt to create a perfect, highly expressive zoom grammar in the first iteration.

Success means:

- understandable
- stable
- demoable

not:

- feature-complete

---

## Tool Switching Recommendation

Tool switching should be low-frequency and easy to explain.

Best hackathon-safe behavior:

- a single intentional gesture cycles through a small set of tools

Suggested tool set:

- `select`
- `draw`
- `eraser` only if it already fits naturally with the canvas interaction model

Avoid:

- too many tools
- too many dedicated tool gestures
- gesture overloading

---

## Performance Strategy

The demo must feel realtime, but we should optimize the right things.

### Priorities

1. Stable hand tracking
2. Stable cursor movement
3. Reliable gesture transitions
4. Acceptable drawing quality
5. HUD and visual polish

### Non-priorities

- perfect debug visualizations
- full parity with Python diagnostics
- overcomplicated camera processing

### Guidance

- measure perceived latency more than raw FPS numbers
- a slightly lower frame rate with stable cursor behavior is better than higher FPS with jittery behavior

---

## Risks And Mitigations

### Risk 1: Browser TFLite integration is harder than expected

Mitigation:

- validate model loading and inference early
- keep a fallback path that uses browser landmarks with simpler heuristic gesture detection for a reduced demo vocabulary if absolutely necessary

### Risk 2: Classifier behavior differs from Python

Mitigation:

- preserve preprocessing parity exactly
- verify label mapping carefully
- compare live outputs to current Python behavior

### Risk 3: Cursor feels jittery

Mitigation:

- add smoothing at the cursor layer
- separate cursor smoothing from classification smoothing
- clamp large jumps

### Risk 4: Gesture transitions feel unreliable

Mitigation:

- use stability windows
- introduce hysteresis
- use cooldown for one-shot gestures

### Risk 5: Scope expands too much

Mitigation:

- lock MVP to cursor + draw + pan + simple zoom + simple tool switching
- defer everything else

---

## Recommended Milestones

### Milestone 1: Browser perception proof

Deliverables:

- camera feed
- browser hand landmarks
- visible tracking state

### Milestone 2: Browser classification proof

Deliverables:

- preprocessing parity
- browser classifier output
- live gesture label display

### Milestone 3: Virtual cursor

Deliverables:

- virtual cursor rendered in the canvas
- cursor follows gesture smoothly
- cursor handles tracking loss safely

### Milestone 4: Annotation

Deliverables:

- gesture-driven stroke start / continue / end
- acceptable line quality

### Milestone 5: Navigation

Deliverables:

- pan
- simple zoom

### Milestone 6: Tooling and polish

Deliverables:

- tool switching
- HUD
- camera / tracking error states
- demo stabilization

---

## Suggested Build Order

### Day 1

- prove browser webcam + hand tracking
- prove browser classifier with the existing `.tflite`
- build live gesture label display
- add virtual cursor

### Day 2

- build gesture runtime
- wire draw behavior
- wire pan behavior
- wire simple zoom
- wire simple tool switching
- add HUD and demo polish

If time becomes tight:

- keep cursor + annotation + pan as the core demo
- simplify zoom
- simplify tool switching

---

## Acceptance Criteria

The migration is successful if:

- the browser can track one hand reliably
- the browser can classify the existing gesture vocabulary at useful quality
- the virtual cursor feels stable enough to aim with
- the user can annotate on the `tldraw` canvas by gesture
- the user can pan the canvas by gesture
- the user can zoom in a simple but reliable way
- the user can switch tools intentionally
- the demo does not depend on OS cursor control or desktop automation

---

## Final Recommendation

Build the browser-native pipeline in `frontend/` and treat the current Python app as the reference implementation for:

- landmark preprocessing
- model behavior
- gesture vocabulary

Do not treat the Python action layer as the thing to preserve.

The migration should preserve:

- perception and classification

and replace:

- OS control with app-native canvas control

This is the cleanest and most achievable path for the hackathon.
