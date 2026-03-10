# Gesture Story 3 Spec: Viewport Pan

## Progress Update

Implementation status: complete.

What is working now:

- Story 3 builds on the completed browser-native Story 1 cursor pipeline and Story 2 native draw path
- a dedicated pan gesture channel is recognized and stabilized in the browser
- the current pan trigger is the classifier's `Close` gesture (`PAN_GESTURE_ID = 1`)
- panning moves the real `tldraw` camera through editor camera APIs instead of OS cursor hacks
- draw and pan are mutually exclusive, so entering one mode prevents the other from activating at the same time
- releasing the pan gesture ends the pan session cleanly
- tracking loss during pan exits safely and is logged
- pan lifecycle, anchor point, delta, and recent pan events are visible in the live agent sidebar under the `Gestures` tab

Known follow-up:

- the gesture label CSV still does not fully match classifier output count
- the current pan motion model behaves like viewport movement following the fist; we should decide whether to keep that or refine it into an anchored grab-and-pull interaction
- native draw feel still needs tuning separately from pan
- Story 4 zoom is now implemented, but its pinch thresholds and sensitivity still need live feel-tuning on real webcam input

Recommended next step:

- Story 5 should focus on low-frequency tool switching, while pan polish and zoom threshold tuning continue as follow-up UX work

## Story Summary

Story 3 adds browser-native viewport navigation to the `tldraw` canvas.

The goal is to let the user move around the workspace through gesture input without leaving the browser-native interaction model established in Stories 1 and 2.

This story reuses:

- browser camera access
- browser MediaPipe hand tracking
- browser-side landmark preprocessing
- browser-side TFLite gesture classification
- gesture stability filtering
- virtual cursor state and smoothing
- sidebar-based diagnostics and structured logs

This story adds:

- a dedicated pan gesture configuration
- pan stability thresholds independent from cursor and draw thresholds
- pan lifecycle state tracking
- camera movement driven by gesture deltas
- safe exits on gesture release and tracking loss

## Current Interaction Model

Pan currently works as a hold-to-pan gesture:

1. The system recognizes a stable `Close` gesture.
2. The runtime enters pan mode.
3. Hand movement updates the `tldraw` camera using screen-space deltas.
4. Releasing the gesture ends pan mode.

This model is already good enough for the demo because it is responsive, direct, and easy to understand.

The main product follow-up is whether pan should remain simple hand-following or evolve into a more physical anchored grab-and-pull model.

## Acceptance Criteria

Story 3 is considered complete because:

- a stable gesture can enter pan mode intentionally
- hand motion moves the viewport predictably
- pan exits cleanly on release
- pan exits safely on tracking loss
- pan does not conflict with native drawing
- pan observability is available in the sidebar through state fields and lifecycle logs
