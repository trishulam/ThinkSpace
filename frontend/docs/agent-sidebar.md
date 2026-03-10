# Agent WebSocket Sidebar

## Overview

The Agent Sidebar replaces the original tldraw `ChatPanel` in the `SessionCanvas` page with a live WebSocket connection to the FastAPI backend running Google's ADK (Agent Development Kit) with the Gemini Live API. It provides real-time bidirectional communication including text chat, audio streaming, transcription display, and an event log.

For the canvas subtitle / caption system that was added on top of this live
connection, see `frontend/docs/agent-subtitles.md`.

## Architecture

```
SessionCanvas.tsx (page)
├── useAgentWebSocket()      ← WebSocket lifecycle + event parsing
├── useAudioWorklets()       ← Mic recording + audio playback
├── Tldraw Canvas            ← Unchanged
├── AgentSidebar             ← New sidebar component
└── DynamicIsland            ← Modified to use real connection state
        │
        │  WebSocket frames
        ▼
FastAPI Backend :8000
├── WS /ws/{userId}/{sessionId}
└── ADK Runner + Gemini Live API
```

### Data flow

1. **Text**: User types message → `sendText()` → JSON `{"type":"text","text":"..."}` over WebSocket → Backend → ADK event with `content.parts[].text` back
2. **Audio upstream**: Mic → AudioWorklet (16kHz PCM) → Float32→Int16 conversion → binary WebSocket frame → Backend
3. **Audio downstream**: Backend → ADK event with `content.parts[].inlineData` (base64 PCM 24kHz) → decoded → AudioWorklet player → speakers
4. **Transcription**: Backend → `inputTranscription` (user's speech) or `outputTranscription` (agent's speech) → displayed in event log
5. **Turn lifecycle**: Backend → `turnComplete` / `interrupted` → resets talking state, stops audio playback if interrupted

## Files Created

### `client/types/agent-live.ts`

Shared TypeScript types used across all agent sidebar files.

| Type | Values | Purpose |
|------|--------|---------|
| `ConnectionState` | `'idle' \| 'connecting' \| 'connected' \| 'disconnecting'` | WebSocket connection lifecycle |
| `TalkingState` | `'none' \| 'user' \| 'agent' \| 'thinking'` | Who is currently speaking (drives DynamicIsland visuals) |
| `LogEntryType` | `'user-text' \| 'user-transcription' \| 'user-audio' \| 'agent-text' \| 'agent-transcription' \| 'agent-audio' \| 'tool-call' \| 'tool-result' \| 'system'` | Event log entry classification |
| `AgentLogEntry` | `{ id, timestamp, type, content, rawEvent?, isPartial?, isAudioEvent? }` | Single entry in the event log |

### `client/hooks/useAgentWebSocket.ts`

Core hook that manages the WebSocket connection to the backend. Mirrors the logic from the backend's `app/static/js/app.js`.

**Options:**
- `userId` / `sessionId` — identify the session on the backend
- `onPlayAudio` — callback invoked with base64 audio data when the agent sends audio
- `onStopPlayback` — callback invoked when the agent is interrupted

**Returns:**
- `connectionState` — current connection status
- `talkingState` — who is talking (derived from incoming events)
- `eventLog` — array of `AgentLogEntry` objects
- `connect()` / `disconnect()` — manage connection
- `sendText(msg)` — send a text message
- `sendImage(base64, mimeType)` — send an image
- `sendAudioChunk(ArrayBuffer)` — send raw PCM audio
- `clearLog()` — clear the event log

**WebSocket URL:** Connects directly to `ws://localhost:8000/ws/{userId}/{sessionId}` by default. Override with the `VITE_AGENT_BACKEND_URL` environment variable.

**Why not use the Vite proxy?** The `@cloudflare/vite-plugin` intercepts HTTP upgrade requests before Vite's built-in proxy can forward them. The Cloudflare Workers runtime doesn't handle `/ws` routes, causing the connection to drop immediately. WebSocket connections don't enforce same-origin policy, so a direct connection works without CORS issues.

**Auto-reconnect:** When the connection closes unexpectedly (not via user clicking Disconnect), the hook waits 5 seconds then calls `connect()` again automatically.

**Event parsing order** (matches backend `app.js`):
1. `turnComplete` → log system event, reset state
2. `interrupted` → log, stop audio playback, reset state
3. `inputTranscription` → log user transcription, set talking state to `'user'`
4. `outputTranscription` → log agent transcription, set talking state to `'agent'`
5. `usageMetadata` → log token usage
6. `content.parts[]`:
   - `inlineData` (audio/pcm) → decode + play, log audio event
   - `text` (skip `thought`) → log agent text
   - `executableCode` → log as tool call
   - `codeExecutionResult` → log as tool result

### `client/hooks/useAudioWorklets.ts`

Hook that wraps Web Audio API worklets for microphone recording and audio playback.

**Returns:**
- `isAudioActive` — whether audio is currently active
- `startAudio(onAudioChunk)` — initializes both AudioContexts and starts mic recording
- `stopAudio()` — stops mic, closes both audio contexts
- `playAudioChunk(base64Data)` — decodes base64 and sends to player worklet
- `stopPlayback()` — sends `endOfAudio` command to clear the player buffer

**Audio specs:**
- Recording: 16kHz sample rate, mono, 16-bit PCM (Int16)
- Playback: 24kHz sample rate, ring buffer (180 seconds)
- Conversion: Float32 from AudioWorklet → Int16 for WebSocket → Float32 in player worklet

### `public/worklets/pcm-player-processor.js`

AudioWorklet processor for playing PCM audio. Uses a ring buffer (24kHz x 180 seconds). Receives Int16 PCM data via `port.postMessage()`, converts to Float32, and outputs to speakers. Supports an `endOfAudio` command to clear the buffer (used when the agent is interrupted).

Copied from `backend/app/static/js/pcm-player-processor.js`.

### `public/worklets/pcm-recorder-processor.js`

AudioWorklet processor for recording microphone input. Captures Float32 audio samples from the mic and posts them to the main thread via `port.postMessage()`.

Copied from `backend/app/static/js/pcm-recorder-processor.js`.

**Why `public/`?** AudioWorklet processors must be loaded by URL (they run in a separate thread), not bundled by Vite. Files in `public/` are served as static assets at the root path.

### `client/components/AgentSidebar.tsx`

Pure UI component that renders the sidebar. Receives all state and callbacks via props — no WebSocket or audio logic inside.

**Layout (top to bottom):**
1. **Header**: "Live Agent" title, connection status dot + label, Connect/Disconnect button
2. **Controls**: Start/Stop Audio button, "Show audio" checkbox, Clear button
3. **Event log**: Scrollable list of `AgentLogEntry` items, auto-scrolls to bottom. Each entry is color-coded by type:
   - Blue: user text / transcription
   - Green: agent text / transcription
   - Purple: tool calls
   - Yellow: tool results
   - Gray: system events
   - Pink: audio events (hidden by default, toggle via checkbox)
4. **Text input**: Form with input field and Send button (disabled when disconnected)

**Styles** are in `client/index.css` under the `.agent-sidebar` class hierarchy, using MindPad CSS variables for dark theme consistency.

## Files Modified

### `client/pages/SessionCanvas.tsx`

The main page that orchestrates everything.

**What changed:**
- Commented out `ChatPanel` import and its `ErrorBoundary` wrapper
- Added `useAgentWebSocket` and `useAudioWorklets` hooks
- Wired the hooks together: audio chunk callback → WebSocket send, WebSocket audio events → worklet playback
- Renders `<AgentSidebar>` in the same 350px right grid column
- Passes real `connectionState` and `talkingState` to `<DynamicIsland>` instead of simulated values

**What stayed the same:** All tldraw canvas code, overlays, highlights, TldrawAgentAppProvider, custom tools, and the CustomToolbar back button.

### `client/components/DynamicIsland.tsx`

The floating pill at the top center of the screen that shows connection state visually.

**What changed:**
- Props changed from `{ isConnected, isConnecting, onConnect, onDisconnect }` to `{ connectionState, talkingState }` (direct types from `agent-live.ts`)
- Removed all simulation logic (random talking state cycling every 3 seconds)
- Removed all test UI (Connect/Disconnect/Thinking/Flashcard buttons, flashcard card, show/hide controls)
- Now a pure visual component driven entirely by real data from the WebSocket hook

**What stayed the same:** All CSS animations (voice bars, thinking dots, connection dots, pulse effects) and the core `getIslandContent()` rendering logic.

### `vite.config.ts`

Removed the `server.proxy` config (it didn't work with the Cloudflare plugin). Added a comment explaining why.

### `client/index.css`

Added ~250 lines of `.agent-sidebar*` styles at the end of the file for the sidebar layout, event log entries, controls, and text input. Uses MindPad CSS variables (`--mindpad-bg-primary`, `--mindpad-border-subtle`, `--mindpad-accent`, etc.).

## Running Locally

1. **Start the backend** (terminal 1):
   ```bash
   cd backend/app
   uv run --project .. uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Start the frontend** (terminal 2):
   ```bash
   cd frontend
   npm run dev
   ```

3. Open `http://localhost:5173` in your browser, navigate to a session.

4. Click **Connect** in the sidebar to establish the WebSocket connection.

5. Click **Start Audio** to enable voice interaction (requires microphone permission).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_AGENT_BACKEND_URL` | `ws://localhost:8000` | WebSocket URL of the FastAPI backend. Set to `wss://your-domain.com` in production. |

## WebSocket Protocol Reference

### Upstream (frontend → backend)

| Type | Transport | Format |
|------|-----------|--------|
| Text message | Text frame | `{"type": "text", "text": "..."}` |
| Image | Text frame | `{"type": "image", "data": "<base64>", "mimeType": "image/jpeg"}` |
| Audio chunk | Binary frame | Raw 16-bit PCM, 16kHz, mono |

### Downstream (backend → frontend)

All messages are JSON text frames containing serialized ADK events. Key fields:

| Field | Meaning |
|-------|---------|
| `turnComplete: true` | Agent finished its turn |
| `interrupted: true` | Agent was interrupted (user spoke over it) |
| `inputTranscription.text` | Transcription of user's speech |
| `outputTranscription.text` | Transcription of agent's speech |
| `content.parts[].text` | Text response from agent |
| `content.parts[].inlineData` | Audio response (base64 PCM 24kHz) |
| `content.parts[].executableCode` | Tool call (code to execute) |
| `content.parts[].codeExecutionResult` | Tool execution result |
| `usageMetadata` | Token usage statistics |
