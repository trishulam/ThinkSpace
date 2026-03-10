# ADK Live Integration Notes

## Purpose

This document explains how Google ADK Live maps onto the ThinkSpace proactive tutor architecture.

It is based on the official ADK Live documentation and should be used as the reference for:

- `LiveRequestQueue`
- `send_content()`
- `send_realtime()`
- `run_live()`
- event semantics
- streaming behavior
- multimodal inputs
- `RunConfig`
- tool execution in streaming sessions

This document does not define the final ThinkSpace product behavior by itself. Instead, it captures the official ADK constraints and the architectural implications for our system.

## Why ADK Live Fits ThinkSpace

ADK Live matches our architecture well because it already provides the core primitives we need for a live voice orchestrator:

- a unified upstream message queue
- a single downstream event stream
- multimodal input support
- interruption support
- transcription support
- tool execution support
- long-running and streaming tool patterns

This means we should build on top of ADK's streaming model, not invent our own low-level conversation orchestration around raw Gemini Live websocket behavior.

## The Core ADK Streaming Model

At a high level:

- client or app code sends upstream inputs into `LiveRequestQueue`
- `runner.run_live()` yields downstream events from the model and tools
- the backend coordinates those two directions

The main objects are:

- `LiveRequestQueue`
- `Runner.run_live(...)`
- `RunConfig`
- `Event`

## `LiveRequestQueue`

`LiveRequestQueue` is the upstream input channel for a live ADK session.

It provides a unified interface for sending:

- text content
- binary blobs such as audio or images
- activity signals
- close signals

The important conceptual message model includes:

- `content`
- `blob`
- `activity_start`
- `activity_end`
- `close`

### Important Constraint

`content` and `blob` are mutually exclusive in a single `LiveRequest`.

In practice, use ADK's convenience methods instead of manually building mixed requests.

## `send_content()`

`send_content()` is the correct path for text-based semantic input.

In ADK's own framing:

- it sends text in turn-by-turn mode
- each message is a discrete turn
- it signals a complete turn to the model
- it triggers response generation

### Implication For ThinkSpace

This is the main trigger for proactive tutor reasoning.

Examples that belong here:

- `Canvas Digest`
- `User wants to enhance the canvas`
- `Flashcards completed with repeated mistakes`
- `Canvas subagent completed work`
- `User is idle after large canvas reorganization`

Conceptually:

- `send_content()` means "reason about this now"

### Important Product Consequence

We should be selective with `send_content()`.

If we send too many semantic events, the orchestrator will become too reactive and noisy. The environment interpreter must decide when a change is semantically important enough to justify a new reasoning turn.

## `send_realtime()`

`send_realtime()` is the correct path for blob-style real-time input.

Typical uses:

- microphone audio
- screenshots
- images
- JPEG video frames

Conceptually:

- `send_realtime()` means "perceive this"

### Implication For ThinkSpace

This is how we should deliver perceptual context to the orchestrator.

Examples:

- current screenshot of the canvas
- selected region image
- live audio chunks from the microphone

### Design Rule

`send_realtime()` should not be treated as the main semantic orchestration trigger.

It is the perception channel, not the primary app-level turn trigger.

## `run_live()`

`runner.run_live()` is ADK's downstream live event stream.

It is:

- asynchronous
- event-driven
- streaming
- the single source of model and tool events during a session

All application logic for live rendering, playback, interruption handling, tool visibility, and usage tracking should treat this event stream as the main downstream truth.

## What `run_live()` Yields

ADK yields `Event` objects that can contain:

- text responses
- audio chunks
- transcriptions
- tool calls
- tool responses
- usage metadata
- errors

Key event families:

- text events
- audio events with inline data
- transcription events
- metadata events
- tool call and tool response events
- error events

## Event Fields That Matter Most For Us

### `content`

May contain:

- `parts[].text`
- `parts[].inline_data`
- function call information
- function response information

### `partial`

For text content:

- `partial=True` means incremental text
- `partial=False` means the complete merged text segment

This is useful for streaming UI updates.

### `turn_complete`

Signals that the model has finished the current response turn.

This should drive UI transitions like:

- hide typing indicators
- return to input-ready state
- stop waiting for more response chunks

### `interrupted`

Signals that the current model response was interrupted by new user input.

This is especially important for voice UX.

On interruption:

- stop audio playback immediately
- clear or mark partial output appropriately
- update the notch and subtitles

### `input_transcription`

This is user speech transcription when enabled.

Useful for:

- subtitles
- logs
- semantic context

### `output_transcription`

This is model speech transcription when enabled.

Useful for:

- subtitles
- chat/event display
- accessibility
- fallback textual representation of audio output

### `usage_metadata`

Contains token usage information.

This is especially important because cost protection is weaker in BIDI mode than some developers might assume.

## `partial`, `interrupted`, and `turn_complete`

These three flags are essential for a high-quality live UX.

### `partial`

Use it to drive streaming text display if needed.

Important semantics:

- partial text is incremental
- final non-partial text is merged by ADK
- text streaming is not the same as audio chunk streaming

For many UI cases, it is acceptable to ignore partial text and only use final merged text. For richer subtitle or live-chat UX, partial text can be displayed progressively.

### `interrupted`

This is critical in conversational UX.

When the user speaks over the model:

- stop audio playback
- stop rendering stale streaming output
- update UI state immediately

This is not just a cosmetic signal. It should drive actual cancellation of currently visible response flow.

### `turn_complete`

This is the true turn boundary.

When received:

- the current model response is done
- any turn-scoped buffering can be finalized
- UI can return to ready state

## Events And Persistence

Not all live events are persisted equally.

What matters for architecture:

- final transcription events can be persisted
- tool calls and tool responses are preserved
- usage metadata is preserved
- raw inline audio is ephemeral
- partial transcription events are ephemeral

### Implication For ThinkSpace

If we need durable semantic memory, we should not rely on raw live events alone. The backend should store normalized session state for:

- flashcard decks
- current study flow
- completed jobs
- enhanced canvas outputs
- tutoring context

## Audio Input

ADK expects audio input in a strict format.

Required format:

- mono
- 16kHz
- 16-bit PCM

### Important ADK Behavior

ADK does not convert audio formats for us.

So the frontend or client audio pipeline must ensure the right format before sending.

### Chunking Guidance

The official docs recommend chunked streaming for low latency.

Typical ranges:

- 10-20ms for ultra-low latency
- 50-100ms as a balanced recommendation
- 100-200ms for lower overhead

### Design Implication

The audio path in ThinkSpace should remain a continuous realtime stream. It should not be treated as turn-based text.

## Images And Screenshots

ADK supports sending images through `send_realtime()`.

The docs describe image and video frames in practice as JPEG-based blob inputs.

### Implication For ThinkSpace

Screenshots for canvas context should be treated as realtime perception input and sent via `send_realtime()`.

This fits our model:

- screenshot via `send_realtime()`
- semantic digest via `send_content()`

That pairing gives the orchestrator both:

- perception
- interpretation

## Voice Activity Detection

ADK Live enables automatic Voice Activity Detection by default.

With default VAD:

- stream audio continuously
- let the model detect speech boundaries
- do not send manual activity signals

### Manual Activity Signals

Use `send_activity_start()` and `send_activity_end()` only if automatic VAD is explicitly disabled.

That might be appropriate if we ever decide to implement client-side VAD ourselves for:

- network reduction
- custom push-to-talk flows
- noisy environments
- highly controlled interaction modes

### Current Product Implication

For the normal conversational tutor flow, default VAD is a good fit.

We should only move to client-side VAD if we later need tighter control or better efficiency.

## `RunConfig`

`RunConfig` is the main ADK configuration object that controls live session behavior.

For ThinkSpace, the most important parameters are:

- `streaming_mode`
- `response_modalities`
- `speech_config`
- `input_audio_transcription`
- `output_audio_transcription`
- `proactivity`
- `enable_affective_dialog`
- `save_live_blob` or related persistence controls

## `StreamingMode.BIDI`

For our use case, `StreamingMode.BIDI` is the correct mode.

Why:

- true two-way communication
- simultaneous send and receive
- live interruptions
- audio streaming
- image streaming
- real-time multimodal behavior

SSE is useful for text-oriented streaming, but it is not the right fit for a live proactive voice tutor.

## Response Modality Constraint

One of the most important official ADK constraints:

- a live session supports only one response modality

Meaning:

- choose `TEXT` or `AUDIO`
- not both in the same session

### Native Audio Implication

If we want native-audio capabilities and proactive audio, the main session should stay audio-native.

That means:

- `response_modalities=["AUDIO"]`

And if we still want text in the UI:

- use transcription events
- use event logs
- use structured tool outputs

### Architectural Consequence

We should not design the main tutor assuming a true dual text-plus-audio response mode in a single BIDI session.

Instead:

- speech comes from audio response
- text surfaces come from transcription and structured events

## Proactivity And Affective Dialog

ADK Live supports:

- proactive audio
- affective dialog

But only on native audio models.

### Official Meaning Of Proactive Audio

The model may:

- anticipate user needs
- offer follow-up information
- suggest things without explicit prompting
- ignore irrelevant input

### Official Meaning Of Affective Dialog

The model may:

- detect emotional cues
- adapt tone and style
- respond more empathetically

### Product Implication

These features are useful, but they are not enough by themselves to implement ThinkSpace's app-level proactive tutor behavior.

We still need our own semantic orchestration layer because our desired triggers are product-specific:

- user finished a rough flowchart
- gesture implies "enhance this"
- flashcards became relevant
- a canvas job completed
- the user is stuck after recent work

So the right split is:

- built-in ADK proactivity for conversational naturalness
- app-driven `send_content()` for deterministic tutoring triggers

## Tool Execution In `run_live()`

ADK automatically handles tool execution inside live sessions.

This is a major advantage for our architecture.

Officially, ADK:

- detects tool calls
- executes tools automatically
- formats tool responses
- feeds those responses back to the model
- yields tool call and tool response events to the application

### Implication For ThinkSpace

We should not build our own low-level raw Gemini function-calling loop around the voice orchestrator.

Instead, we should define clear ADK tools and let ADK own the tool execution plumbing.

Our design effort should go into:

- tool design
- state management
- frontend action contracts
- job lifecycle semantics

## Long-Running Tools

ADK supports long-running tool patterns and exposes pending execution information.

This is highly relevant for ThinkSpace because several major capabilities are naturally job-like:

- poster generation
- image generation
- widget generation
- non-trivial canvas enhancement
- larger flashcard generation jobs

### Product Fit

Long-running tools map directly onto our desired UX:

- tool starts
- notch shows working state
- frontend may wait for structured action
- tool completes later
- orchestrator updates session memory

## Streaming Tools

ADK also supports streaming tool patterns using dedicated `LiveRequestQueue` injection into tools.

This allows a tool to send progressive updates back to the model during execution.

### Future Relevance

We may not need streaming tools immediately, but they are promising for:

- progress updates during long canvas enhancement
- iterative generation flows
- progressive summarization or staged outputs

## Cost And Safety Implication

One especially important ADK limitation:

- `max_llm_calls` does not protect `run_live()` with `StreamingMode.BIDI`

This means our main voice tutor will need custom safeguards.

Recommended application-level protections:

- turn count limits
- session duration limits
- repeated-trigger suppression
- tool call circuit breakers
- usage monitoring from event metadata
- explicit anti-loop protection for proactive events

This matters a lot because the tutor is intended to be proactive, and proactive systems are at higher risk of runaway loops if not guarded carefully.

## Recommended ThinkSpace Configuration Direction

For the main voice tutor session, the likely baseline is:

- `StreamingMode.BIDI`
- native audio model
- `response_modalities=["AUDIO"]`
- input transcription enabled
- output transcription enabled
- optional built-in proactivity enabled
- optional affective dialog enabled

That gives us:

- live natural voice
- subtitles and textual visibility via transcription
- support for proactive conversational behavior
- compatibility with our intended orchestrator design

## Recommended Architectural Interpretation

After mapping the ADK docs to our system, the cleanest mental model is:

- `send_realtime()` is the perception channel
- `send_content()` is the semantic trigger channel
- `run_live()` is the unified downstream event stream
- ADK tools are the correct way to express backend capabilities
- long-running tool patterns fit our subagent job model

This means the ThinkSpace live tutor should be designed as:

- one persistent audio-native orchestrator session
- fed by two distinct upstream channels:
  - semantic content turns
  - realtime perceptual streams

That is the cleanest ADK-aligned architecture for our product.

## Practical ThinkSpace Implications

### Flashcards

The tutor should call ADK tools that generate or control flashcard state, and the backend should emit structured frontend actions for rendering.

### Canvas Enhancement

The tutor should reason over semantic digests and screenshots, then call a tool such as `canvas.enhance_to_poster`, which may be long-running.

### HTML Widgets

The tutor should call widget-generation tools that return structured frontend actions for insertion into the canvas.

### Notch State

The UI notch should be driven not only by speech activity but also by tool and job lifecycle states.

## Summary

The official ADK Live model strongly supports the intended ThinkSpace architecture as long as we respect a few core truths:

- `send_content()` is the strong semantic turn trigger
- `send_realtime()` is for perception
- `StreamingMode.BIDI` is the right mode for the tutor
- the main session should likely remain audio-native
- built-in proactivity is useful but not sufficient for our product semantics
- ADK tools should be the basis of backend capability orchestration
- long-running tool patterns map well to subagent jobs
- BIDI sessions need our own loop and cost safeguards

This document should be used as the ADK-grounded reference for future system design and implementation work.
