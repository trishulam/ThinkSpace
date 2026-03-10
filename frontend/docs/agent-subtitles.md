# Agent Subtitle Overlay

## Overview

The canvas now includes a live subtitle overlay for agent speech. It is rendered
inside the canvas area, not in the sidebar, and is driven from the same live
WebSocket stream that powers the voice agent.

This document records:

- the current implementation
- the event and audio constraints we discovered
- the subtitle approaches we tried
- the final pacing model we landed on

## Current UX

- The subtitle overlay appears near the bottom of the canvas, above the custom
  toolbar.
- Only one visible subtitle bubble is shown.
- Incoming agent speech is revealed progressively instead of appearing all at
  once.
- The visible subtitle keeps a rolling window of up to 4 rendered lines.
- When a 5th rendered line appears, the top visible line is dropped and the
  newest 4 lines remain visible.
- Completed turns linger briefly before fading.
- Interrupted turns clear faster.

## Files Involved

### `client/hooks/useAgentWebSocket.ts`

Owns the live subtitle state and pacing behavior.

Main responsibilities:

- parse `outputTranscription`
- accumulate received subtitle text
- reveal subtitle text progressively
- derive audio-informed pacing from output audio chunks
- coordinate `turnComplete` and `interrupted`

### `client/components/AgentSubtitleOverlay.tsx`

Pure presentation component for the canvas subtitle bubble.

Main responsibilities:

- render the currently revealed subtitle text
- keep a 4-line visible window
- drop the top visible line when a 5th rendered line appears

### `client/types/agent-live.ts`

Defines the shared subtitle state shape:

- `receivedText`
- `revealedText`
- `isVisible`
- `isPartial`
- `isFinal`
- `isCatchingUp`
- `status`
- `updatedAt`

### `client/pages/SessionCanvas.tsx`

Mounts the subtitle overlay inside `.tldraw-canvas`, keeping it scoped to the
canvas rather than the whole page.

### `client/index.css`

Owns overlay placement and visual styling, including:

- toolbar-aware bottom offset
- translucent subtitle bubble styling
- offscreen subtitle measurement element

## Source Data From The Backend

The subtitle system is based on the live ADK / Gemini event stream delivered
over WebSocket.

Important fields:

- `outputTranscription.text`
- `outputTranscription.finished`
- `turnComplete`
- `interrupted`
- `content.parts[].inlineData` for output PCM audio

### What We Verified About `outputTranscription`

The Live API sends incremental transcription chunks during agent speech.

Example shape:

- `"Hello there!"`
- `" How can"`
- `" I help"`
- `" you today?"`

Then a final event arrives with:

- the complete utterance text
- `finished: true`

This means subtitle text must be treated as:

- incremental partial chunks while the agent is speaking
- final full text at completion

## Constraint: No True Word Timestamps

We researched whether Gemini Live / ADK exposes word timestamps or text-audio
alignment metadata in this path.

Conclusion:

- We do **not** get word timestamps in the current Live / ADK event stream.
- We do **not** get direct text-to-audio alignment.
- We do **not** get playback timestamps from the backend.

So true subtitle sync is not currently possible from backend metadata alone.

## What We Can Infer

We do know enough to make pacing better than a fixed raw transcript dump.

From the frontend we know:

- output transcript chunks arrive incrementally
- output audio chunks arrive as PCM
- output player sample rate is `24kHz`
- output PCM is `16-bit` mono, so each chunk has an implied duration

That lets us infer approximate speech duration for the current utterance from
audio bytes:

- `durationSeconds = byteLength / (24000 * 2)`

This is not true sync, but it is enough to keep captions roughly inside the
speech envelope.

## Subtitle Iterations We Tried

### 1. Sidebar Log Only

Initial implementation simply exposed transcription in the sidebar event log.

Good for debugging, not good for user-facing captions.

### 2. Bottom Subtitle Overlay With Direct Transcript Display

We added a canvas subtitle overlay and showed the active utterance directly.

This was visually better, but long speech could dump too much text too quickly.

### 3. Pseudo Subtitle Paging

We tried a rolling layout-driven subtitle window:

- measure rendered lines
- show only the newest lines
- drop the oldest visible line when overflow occurs

This improved readability but still felt too transcript-like, and an early
measurement approach briefly leaked a second visible “ghost” bubble.

### 4. Fixed CPS Reveal

We introduced a progressive reveal loop so captions did not instantly appear in
full.

This felt better, but a completely fixed CPS could still drift too far ahead of
long speech output.

### 5. Current Model: Audio-Informed Pacing

The current model keeps the progressive reveal, but gently corrects the reveal
speed using received output audio duration.

This is the model currently in code.

## Current Pacing Model

### Baseline

The system keeps a natural base reveal speed:

- `BASE_REVEAL_CPS = 14`

### Bounded Correction

It then derives a target CPS from:

- received transcript character count
- received output audio duration

That target is clamped to a narrow range:

- `MIN_REVEAL_CPS = 12.5`
- `MAX_REVEAL_CPS = 16.5`

### Smoothing

The current reveal speed does not jump directly to the target. Instead it
converges gradually using a smoothing factor:

- `CPS_SMOOTHING_FACTOR = 0.2`

This keeps pacing stable and avoids jitter.

### Minimum Evidence Before Adjusting

To avoid unstable early-utterance behavior, audio-informed pacing does not kick
in immediately. It waits until enough evidence exists:

- `MIN_AUDIO_MS_FOR_ADJUSTMENT = 600`
- `MIN_TEXT_LENGTH_FOR_ADJUSTMENT = 24`

Before that threshold, subtitles simply reveal at the base CPS.

## Current Turn Lifecycle

### During Speech

- partial `outputTranscription` chunks append to `receivedText`
- the reveal loop advances `revealedText`
- the overlay renders only `revealedText`

### On Final Transcript

- `isFinal` is set
- reveal continues naturally
- the UI does not snap instantly to the end of the utterance

### On `turnComplete`

- if reveal is already caught up, normal linger starts immediately
- if reveal is still behind, linger waits until reveal completes

### On `interrupted`

- playback is stopped
- pending turn completion is cancelled
- the subtitle clears using the shorter interrupted timing

## Current 4-Line Window

The overlay does not trim by character count anymore.

Instead:

- the visible subtitle bubble measures the rendered revealed text
- if text fits within 4 rendered lines, all 4 lines are shown
- if it exceeds 4 rendered lines, only the newest 4 visible lines are shown

This keeps the subtitle visually stable:

- the block does not constantly shrink from the front character-by-character
- text only appears to move upward when a new rendered line forces overflow

## Styling Notes

The overlay is intentionally lighter than the earlier version:

- lower background opacity
- toolbar-aware bottom offset
- single visible bubble only

The measurement element is rendered offscreen and hidden so the user sees only
one actual subtitle bubble.

## What This System Is Trying To Optimize

The goal is **not** perfect subtitle sync.

The goal is:

- keep subtitles readable
- keep subtitles relevant to the currently heard speech
- avoid getting obviously far ahead of long spoken output
- preserve a stable visual window on the canvas

## Known Limitations

- No true word timestamps
- No backend-provided alignment between text chunks and audio chunks
- No frontend playback-head telemetry from the player worklet
- Pacing is still approximate, not exact

## Best Future Improvement

If we want to go beyond “good approximation,” the next meaningful improvement
would be to expose playback telemetry from the audio player path, such as:

- buffered audio duration
- playback started
- playback drained / playback ended

That would let reveal timing follow actual playback more closely instead of
relying only on received audio duration.
