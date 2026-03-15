# Canvas UI/UX Design Mode Plan

## Goal

Create a temporary canvas-first workflow for UI/UX design work where the canvas is instantly accessible without:

- auto-starting session recording
- creating a backend session on page entry
- restoring session state from the backend on page entry
- saving checkpoints on page exit or unload

The canvas should still keep the right-hand sidebar visible. Agent-related backend work should only happen after the user explicitly chooses to connect the agent.

Once the canvas UI/UX is finalized, the normal session flow should be restored without leaving permanent product regressions behind.

## Implementation Status

Implemented now:

- design-mode exploration has been retired
- session creation now routes back through the normal dashboard flow
- `/canvas` now creates a real backend session, then forwards into `/session/:id`
- the session canvas again requires a real `sessionId`
- session restore, checkpointing, and auto-recording are back on the real session route
- the canvas recording indicator stays hidden until recording actually starts, so its timer begins only after permission is granted

## Current Behavior

The current code already has part of the desired behavior:

- Agent websocket connection is manual. `AgentSidebar` only calls `onConnect={ws.connect}` when the user presses the connect button.
- Gesture capture is already opt-in. `SessionCanvas` initializes `gestureEnabled` as `false`.

The main blockers are in `SessionCanvas`:

- The page requires a route param and exits early when `sessionId` is missing.
- Session restore runs automatically when `sessionId` exists through `getSessionResume(sessionId)`.
- Canvas checkpoints are created through `createCheckpoint(sessionId, ...)`.
- A `beforeunload` lifecycle effect saves a checkpoint automatically.
- Screen/tab recording auto-starts after restore completes.

There is also an existing `/canvas` route, but it currently renders the older `App` shell instead of the newer canvas layout with sidebar and session canvas UX.

## Recommended Temporary Setup

### 1. Introduce a temporary "design mode" canvas route

Use `/canvas` as the temporary design route and point it to the same `SessionCanvas` layout instead of the older `App`.

Recommended mode split:

- `/canvas` -> design mode
- `/session/:sessionId` -> normal session mode

This keeps the production session flow intact while giving us a clean workspace for UI iteration.

### 2. Make `SessionCanvas` route-aware

Refactor `SessionCanvas` so it supports two modes:

- `isDesignMode = !sessionId`
- `isSessionMode = Boolean(sessionId)`

Then gate all backend session behavior behind `isSessionMode`.

### 3. Disable automatic recording in design mode

In design mode:

- do not call `startRecording()` on mount
- hide or mute the recording status language so it does not imply live capture
- optionally replace the recording HUD with a simpler "Design mode" status card

In session mode:

- preserve the existing auto-recording behavior exactly as it works today

### 4. Prevent backend session work on page load in design mode

In design mode:

- skip `getSessionResume(sessionId)`
- skip `createCheckpoint(...)`
- skip `beforeunload` checkpoint persistence
- skip session completion actions that require a real session id

This ensures entering the canvas stays lightweight and does not hit the backend.

### 5. Keep the sidebar visible and make agent activation explicit

Retain the current `AgentSidebar` layout in design mode.

Desired behavior:

- sidebar is visible immediately
- connection state starts as disconnected
- no websocket connection is opened until the user clicks connect
- audio controls remain disabled until connected

This part is already largely aligned with the current implementation.

### 6. Use an ephemeral, non-persistent agent session identifier in design mode

When the user clicks connect from design mode, the app can use a lightweight websocket session identifier that is not tied to the session persistence APIs.

Example direction:

- `wsSessionId = sessionId ?? "canvas-design"`

If multiple tabs are expected, prefer a slightly more unique temporary id:

- `canvas-design-${Date.now()}`

This gives us agent interactivity on demand without creating a real learning session record.

### 7. Adjust the canvas chrome for design mode

The current toolbar and overlays are session-oriented. For the temporary UI/UX phase, design mode should simplify this surface:

- replace "End session" with "Back to dashboard"
- remove or hide any session-completion CTA
- replace recording-specific status copy with design-mode copy
- keep `DynamicIsland` and sidebar only if they help evaluate the UX

The goal is for the page to feel like a fast workspace, not an active recorded session.

### 8. Add a temporary easy entry point

To make the canvas instantly reachable during the design phase, add one clear dashboard entry point:

- a prominent "Open Canvas" button, or
- temporarily route the primary hero CTA to `/canvas`

Safer option:

- add a dedicated temporary CTA and keep the existing new-session flow available

This reduces rollback risk later.

## Rollback Strategy

To return functionality to normal after the UI/UX work is done:

1. Keep all normal session behavior inside the `/session/:sessionId` path unchanged.
2. Limit temporary behavior to `/canvas` or an explicit design-mode branch.
3. Remove the temporary dashboard CTA when the design phase ends.
4. If desired, either:
   - delete the design-mode branch entirely, or
   - keep `/canvas` as a separate sandbox route for future design experiments.

This approach avoids having to reassemble session logic later because the production path stays intact throughout the design phase.

## Lowest-Risk Implementation Order

1. Route `/canvas` to `SessionCanvas`.
2. Make `SessionCanvas` render without a `sessionId`.
3. Gate restore, checkpoint, unload-save, recording auto-start, and complete-session logic behind `isSessionMode`.
4. Swap session-specific UI copy to design-mode copy when no `sessionId` exists.
5. Add a temporary dashboard entry point to `/canvas`.
6. QA both flows:
   - `/canvas` should load with no restore call, no checkpoint call, and no recording prompt
   - `/session/:sessionId` should behave exactly as before

## Notes For Implementation

- The manual websocket connect behavior is already correct and should be preserved.
- The gesture system already starts disabled, which is good for a low-friction canvas entry.
- `TldrawAgent` does start local user-action tracking when the app is created, but that is editor-side tracking, not the browser recording/session API path the current UX issue is coming from.

## Recommendation

Use a route-based temporary design mode built on top of `SessionCanvas`, not a global flag that changes the behavior of real session routes.

That gives us:

- fast access for UX work
- no automatic recording
- no automatic session creation or restore
- minimal backend activity until connect
- easy rollback when the final canvas UX is ready

## Canvas Visual Direction

### Reference Surfaces To Borrow From

Use the existing session surfaces as the visual source of truth:

- `Dashboard` provides the strongest hero treatment, typography scale, and primary CTA styling
- `SessionReplay` provides the best dark content-card language for dense learning UI

The new `/canvas` page should feel like it belongs to the same family, not like a separate tool vendor UI dropped into the app.

### Core Theme Direction

The canvas should move to a true dark-mode workspace with the same ThinkSpace DNA already visible in the hero and replay surfaces:

- deep navy-to-indigo background instead of the current generic tool canvas shell
- soft violet highlight glow for focus and AI-related actions
- sharp rectangular cards and controls instead of rounded consumer-product chrome
- bright white headings with cool gray supporting copy
- restrained use of gradients, mostly for primary actions, status accents, and hero surfaces

Recommended foundation:

- page background: near-black navy with subtle radial purple glow
- surface background: charcoal / blue-black panels layered above the stage
- border treatment: thin cool-gray borders with low-opacity white highlights
- accent color: the existing ThinkSpace violet gradient
- success / warning / error states: keep muted and professional, not saturated

### Design Principles For `/canvas`

- The canvas is the hero, not the chrome.
- The UI should feel editorial and premium, not like an admin dashboard.
- Every persistent control must justify its presence because the board needs visual breathing room.
- The page should still feel useful before the agent is connected.
- Agent activity should feel integrated into the canvas, not trapped in a separate control rail.

## Proposed Canvas Layout

### 1. Full-bleed dark workspace

The page should become a full-screen dark stage with minimal outer framing:

- remove the light dashboard-style page background from the canvas route
- let the board occupy almost the entire viewport
- add a faint ambient gradient behind the canvas so the stage feels intentional rather than empty

The goal is to make the board feel like a premium creative workspace for thinking, diagramming, and learning.

### 2. Minimal top navigation bar

Ignore the current sidebar for this phase and move the essential page controls into a thin top bar.

Recommended structure:

- left: ThinkSpace mark + `Canvas`
- center: optional status chip such as `Design Mode` or current topic
- right: primary actions like `Share`, `Present`, `Connect agent`, and overflow actions

Visual treatment:

- translucent dark bar
- 1px low-contrast border
- slight background blur
- same sharp corners used across the rest of the product

This should feel closer to the `SessionReplay` header system than a floating tool palette.

### 3. Floating canvas utility rail

Instead of a full sidebar, use one compact floating utility rail anchored to the top-right or bottom-right of the board.

This rail can temporarily hold:

- zoom controls
- fit-to-board
- add text / add shape shortcuts
- capture / export

Keep it narrow, icon-first, and visually quiet so it does not compete with the canvas content.

### 4. Bottom prompt dock

Because the sidebar will be removed later, the future agent interaction model should already start moving toward an in-canvas prompt dock.

Recommended pattern:

- bottom-centered dock
- dark glass panel with subtle border
- prompt input as the main surface
- attached quick actions like `Explain`, `Generate diagram`, `Summarize`, `Quiz me`

Behavior:

- collapsed when idle
- expands on focus
- can show active AI progress states inline

This creates a more modern "canvas-first + AI-native" interaction model than a permanent right rail.

### 5. Empty-state as a designed scene

The default `/canvas` experience should not open to a raw blank board plus technical chrome.

For an empty board, show a lightweight guided starting state directly on the canvas:

- a large title such as `What do you want to understand?`
- 3 to 5 starter cards for common actions
- a subtle hint row for voice, typing, or dropping source material

Suggested starter cards:

- `Start with a question`
- `Generate a concept map`
- `Drop notes or slides`
- `Practice with flashcards`

These should visually echo the dashboard suggestion chips and replay side cards, but translated into dark mode.

## Component Styling Direction

### Top bar and cards

All non-canvas surfaces should use the same dark card language:

- background: layered charcoal / navy
- border: subtle cool border with slight inner highlight
- shadow: soft depth, not hard elevation
- corners: square / near-square to match existing product language

### Typography

Borrow the existing hierarchy already visible in the session pages:

- strong large headings with tight tracking
- uppercase micro-labels for section kickers and system states
- softer supporting text in slate-gray
- avoid tiny low-contrast helper text on dark surfaces

### Buttons and chips

Recommended mapping:

- primary buttons: existing ThinkSpace violet gradient
- secondary buttons: translucent dark fill with outlined border
- chips: low-contrast dark pills with subtle active violet state
- destructive actions: muted red outline, not filled red

### Status language

The canvas should avoid sounding like a recording studio or debugging tool.

Prefer:

- `Ready to explore`
- `Agent disconnected`
- `Reviewing your canvas`
- `Building diagram`

Avoid:

- overly technical websocket or capture language
- repeated recording-centric labels in design mode

## Content Zones On The Canvas

Even without the sidebar, the page should have a clear spatial hierarchy:

- top bar for navigation and global actions
- center stage for the board itself
- bottom dock for prompting and AI actions
- optional small floating utility rail for board controls
- temporary empty-state content centered on the board until the user starts working

That layout gives the canvas a strong product identity while preserving maximum space for actual thinking work.

## Motion And Interaction Tone

The interaction language should feel calm and high-confidence:

- slow, smooth fades for overlays and dock expansion
- slight upward motion for cards and buttons on hover
- subtle glow increase on active AI states
- avoid bouncy or playful motion

The replay page already points in the right direction: polished, quiet, and information-rich.

## What To Change In The Current Canvas UI

Move away from the current session-tool appearance:

- de-emphasize the existing recording HUD
- replace session-specific toolbar copy with product-level canvas copy
- reduce visible control density around the board
- stop making the right sidebar the visual anchor of the page
- make the main page identity come from the canvas stage, top bar, and prompt dock

## Recommended First-pass Implementation Scope

For the first visual redesign pass:

1. Convert the `/canvas` page shell to a full dark theme.
2. Add a minimal dark top bar that matches the session/replay visual system.
3. Hide or visually de-prioritize the current capture HUD in design mode.
4. Introduce a bottom prompt dock placeholder even if it is initially static.
5. Add an elegant empty-state scene on the board for first-time entry.

This is enough to establish the new visual direction before we redesign deeper agent workflows.
