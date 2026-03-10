# Gesture Story 4 Spec: Zoom

## Progress Update

Implementation status: complete.

What is working now:

- Story 4 builds on the completed browser-native cursor, draw, and pan runtime
- zoom activation now uses classifier gesture `3`, matching the old Python `hand_sign_id == 3` scroll behavior
- the zoom mechanic is a temporary classifier-driven mode, not a persistent mode toggle
- while gesture `3` is held, vertical movement of landmark `8` controls zoom in and zoom out
- the visible cursor is frozen during zoom so only zoom happens while the mode is active
- the real `tldraw` camera is updated through editor camera APIs using viewport-centered zoom for stability
- zoom is mutually exclusive with draw and pan
- releasing gesture `3` ends the zoom session cleanly
- tracking loss during zoom exits safely and is logged
- zoom lifecycle, frozen cursor state, landmark `8` control telemetry, and zoom-level telemetry are visible in the live agent sidebar under the `Gestures` tab

Known follow-up:

- the gesture label CSV still does not fully match classifier output count
- zoom thresholds, deadzone, and sensitivity still need live feel-tuning on real webcam input
- native draw feel still needs tuning separately from zoom
- pan may still be refined from hand-following toward a more anchored grab-and-pull interaction

Recommended next step:

- Story 5 should focus on low-frequency tool switching, while zoom threshold tuning remains a dedicated polish task rather than blocking the next story

## Story Summary

Story 4 adds browser-native zoom to the `tldraw` canvas.

The goal is to let the user control scale through a natural one-hand gesture without introducing a noisy persistent mode or depending on classifier labels that are still being cleaned up.

This story reuses:

- browser camera access
- browser MediaPipe hand tracking
- browser-side landmark preprocessing
- browser-side TFLite gesture classification for cursor, draw, and pan
- virtual cursor smoothing and canvas mapping
- sidebar-based diagnostics and structured logs

This story adds:

- classifier-driven zoom activation using gesture `3`
- zoom stability thresholds for the classifier-driven zoom gesture
- a temporary zoom lifecycle
- viewport-centered zoom
- camera zoom updates driven by landmark `8` vertical hand motion
- safe exits on gesture release and tracking loss

## Current Interaction Model

Zoom currently works as a temporary classifier-driven gesture:

1. The system detects a stable `gesture id 3`.
2. The runtime enters zoom mode.
3. The current virtual cursor position is frozen visually.
4. The runtime stores the starting Y position of landmark `8`.
5. While gesture `3` is held, vertical movement of landmark `8` changes the camera zoom level.
6. Zoom is applied around the viewport center for stability.
7. Releasing gesture `3` ends zoom mode.

This interaction was chosen because it matches the old gesture semantics from the Python app and avoids the instability of raw thumb-index pinch-distance detection.

## Acceptance Criteria

Story 4 is considered complete because:

- a stable gesture `3` can enter zoom intentionally
- moving landmark `8` upward zooms in
- moving landmark `8` downward zooms out
- the visible cursor remains frozen while zoom is active
- zoom exits cleanly on gesture release
- zoom exits safely on tracking loss
- zoom does not conflict with active draw or pan sessions
- zoom observability is available in the sidebar through state fields and lifecycle logs
