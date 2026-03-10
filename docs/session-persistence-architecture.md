# Session Persistence Architecture

## Goal

Add durable session management for the ThinkSpace canvas experience so the system can:

- create a new session
- resume an existing session
- populate the frontend dashboard from persisted data
- restore the latest canvas state
- restore the ADK conversation context and transcript
- mark important topic boundaries and learning milestones
- support future replay video generation for the full session
- survive Cloud Run restarts instead of relying on in-memory state

This architecture covers three runtime components:

- GCP frontend canvas app
- Cloudflare canvas agent
- GCP FastAPI backend running the Google ADK realtime agent

## Current State

The current implementation is split across two different persistence models:

- the canvas uses Tldraw `persistenceKey`, which stores state only in the browser
- the FastAPI backend uses `InMemorySessionService`, which loses session state on restart
- the frontend dashboard uses mock `SessionContext` data instead of backend-backed sessions

That means the current `sessionId` is useful as a route key, but not yet as a durable session record.

## Recommended Source Of Truth

Make the FastAPI backend the system of record for session persistence.

Why:

- the backend already owns ADK session lifecycle and transcript events
- the frontend should not be responsible for writing authoritative transcript data
- the dashboard needs a single queryable store for session metadata
- resume logic becomes much simpler if one service owns metadata, checkpoint pointers, and transcript state

The Cloudflare canvas agent should remain stateless for session durability in the first version. If we later decide to persist its internal chat history, the frontend can serialize and send that state to the FastAPI backend as part of a canvas checkpoint payload.

## Design Principles

Design the persistence model as a session timeline, not just a latest-state store.

That means the system should support two kinds of persistence from the start:

- material checkpoints: actual saved state such as canvas snapshots
- semantic checkpoints: important moments such as "topic complete", "diagram finished", or "misconception corrected"

This keeps v1 simple while making room for replay generation and richer resume behavior later.

### Keep v1 simple

The first implementation should still only require:

- backend-backed session metadata
- backend-backed transcript persistence
- frontend-driven canvas autosave checkpoints

### Be extensible for later

The data model should also be ready for:

- backend agent tool-triggered milestone creation
- exact resume anchors for important topics
- replay video generation from transcript plus checkpoint timeline
- summaries and thumbnails per milestone

## Recommended Storage Topology

Use:

- Firestore for session metadata, turn records, and checkpoint metadata
- Google Cloud Storage for large JSON blobs such as Tldraw snapshots and optional raw ADK event archives

### Why Firestore

Firestore fits the first version well because:

- session metadata is naturally document-shaped
- dashboard queries are simple
- turn records and checkpoints map cleanly to subcollections
- it integrates cleanly with Cloud Run

### Why GCS For Canvas Snapshots

Tldraw snapshots can grow quickly. Firestore documents have a 1 MiB limit, so the latest and historical canvas snapshots should be stored in GCS, with Firestore storing only metadata and object paths.

## Storage Layout

### Firestore

`sessions/{sessionId}`

Top-level metadata document used by the dashboard and resume entrypoint.

Suggested fields:

- `sessionId`
- `userId`
- `topic`
- `goal`
- `mode`
- `level`
- `status`: `active | paused | completed | archived | errored`
- `createdAt`
- `updatedAt`
- `lastActiveAt`
- `lastResumedAt`
- `startedAt`
- `endedAt`
- `durationMs`
- `latestCheckpointId`
- `latestCheckpointAt`
- `latestCanvasVersion`
- `checkpointCount`
- `milestoneCount`
- `importantCheckpointIds` optional
- `latestTurnSequence`
- `transcriptTurnCount`
- `transcriptMessageCount`
- `lastUserMessagePreview`
- `lastAgentMessagePreview`
- `summary`
- `agentModel`
- `adkAppName`
- `hasCanvasState`
- `hasTranscript`
- `canvasThumbnailPath` optional
- `replayStatus`: `not_requested | queued | processing | ready | failed`
- `latestReplayId` optional
- `latestCanvasSnapshotPath`
- `latestCanvasSessionPath`
- `latestAgentAppStatePath` optional
- `latestRawTranscriptPath` optional
- `tokenUsageTotals`

`sessions/{sessionId}/turns/{turnId}`

Normalized transcript records for replay, analytics, and resume context.

Suggested fields:

- `turnId`
- `sequence`
- `sessionId`
- `userId`
- `startedAt`
- `completedAt`
- `status`: `completed | interrupted | failed`
- `inputMode`: `audio | text | mixed`
- `outputMode`: `audio | text`
- `userTranscriptFinal`
- `agentTranscriptFinal`
- `agentTextFinal`
- `interruptReason` optional
- `usageMetadata`
- `toolCalls` optional
- `rawEventCount`
- `rawEventArchivePath` optional

`sessions/{sessionId}/checkpoints/{checkpointId}`

Checkpoint metadata for each durable save.

Suggested fields:

- `checkpointId`
- `sessionId`
- `version`
- `createdAt`
- `checkpointType`: `material | semantic | hybrid`
- `saveReason`: `create | autosave | manual | turn_complete | disconnect | before_unload | topic_complete | milestone`
- `triggerSource`: `frontend_autosave | frontend_manual | backend_agent_tool | backend_system`
- `source`: `frontend | backend | coordinated`
- `label` optional
- `summary` optional
- `isImportant`
- `includeInReplay`
- `replayPriority` optional
- `relatedTurnSequence` optional
- `transcriptRangeStart` optional
- `transcriptRangeEnd` optional
- `parentCheckpointId` optional
- `linkedMaterialCheckpointId` optional
- `canvasDocumentPath`
- `canvasSessionPath`
- `agentAppStatePath` optional
- `shapeCount` optional
- `schemaVersion`
- `contentHash`
- `metadata` optional

### GCS

Suggested object paths:

- `sessions/{sessionId}/canvas/{checkpointId}/document.json`
- `sessions/{sessionId}/canvas/{checkpointId}/session.json`
- `sessions/{sessionId}/agent/{checkpointId}/agent-app-state.json`
- `sessions/{sessionId}/transcript/{date}/raw-events.ndjson`
- `sessions/{sessionId}/preview/{checkpointId}.png` optional
- `sessions/{sessionId}/replays/{replayId}/video.mp4` optional
- `sessions/{sessionId}/replays/{replayId}/manifest.json` optional

## Checkpoint Model

The checkpoint model should be intentionally split into two layers.

### 1. Material checkpoints

These are actual persisted artifacts used for resume and replay rendering.

Examples:

- Tldraw `document` snapshot
- Tldraw `session` snapshot
- optional serialized `agentAppState`

These are produced by the frontend because the frontend owns the live Tldraw editor state.

### 2. Semantic checkpoints

These are markers in the session timeline that describe why a moment matters.

Examples:

- "introduction to backprop completed"
- "chain rule diagram finished"
- "user understood gradient intuition"
- "practice section started"

These are produced by the backend, either:

- automatically from system logic
- or by an explicit backend agent tool call

### Why both are needed

The backend agent can detect important learning milestones from the conversation, but it does not own the live canvas state. The frontend can save the full canvas state, but it does not have the same semantic understanding of topic boundaries.

So the architecture should treat these as separate but linked records.

## Milestone Save Strategy

When the backend agent decides an important topic is complete, it should not directly try to write the canvas snapshot itself.

Instead, it should create a semantic checkpoint and optionally coordinate a fresh frontend snapshot.

### Recommended v1 behavior

In the first version:

1. frontend continues periodic autosave of material checkpoints
2. backend agent tool creates a semantic checkpoint with label and summary
3. semantic checkpoint references the latest known material checkpoint via `linkedMaterialCheckpointId`

This is simple and avoids tight realtime coordination.

### Recommended v2 behavior

Later, if exact replay anchors are needed:

1. backend agent tool emits a `checkpoint_requested` event
2. frontend immediately captures and uploads a new material checkpoint
3. backend links the semantic checkpoint to that newly created material checkpoint

This gives a precise "important moment" snapshot for replay generation.

## Tldraw Persistence Model

Per Tldraw persistence guidance, store the document state separately from the user session state.

Recommended checkpoint payload from the frontend:

- `document`: shared canvas content
- `session`: per-user editor session state
- `agentAppState` optional serialized state from `TldrawAgentApp` or `TldrawAgent`

Important:

- keep `persistenceKey` in the frontend for local IndexedDB caching and quick recovery
- treat the remote checkpoint as the durable source for cross-device resume and dashboard-backed sessions

## ADK Persistence Model

There are two different things to persist for the backend:

### 1. Durable ADK runtime session state

The current backend uses `InMemorySessionService`. That must be replaced with a persistent session service so ADK session context survives process restarts and reconnects.

This should be backed by Firestore or another durable store on GCP.

Persist at least:

- ADK session key: `app_name + user_id + session_id`
- ADK session state payload
- timestamps for create and update

### 2. Product-level transcript history

This is separate from the ADK session object. Even if ADK stores its own runtime state, we still want a product-facing transcript model for:

- dashboard previews
- replay UI
- auditing
- analytics
- debugging interrupted sessions

The backend should persist transcript data directly from WebSocket input and `runner.run_live()` output events. The frontend should not be the source of truth for transcript writes.

## API Surface

The frontend should talk only to FastAPI for session persistence.

### `POST /v1/sessions`

Create a new session record.

Request:

- `topic`
- `goal`
- `mode`
- `level`

Response:

- `sessionId`
- `status`
- `createdAt`
- optional initial checkpoint metadata

Backend behavior:

- create the top-level session document
- create the ADK session in the persistent session service
- return the new `sessionId`

### `GET /v1/sessions`

List session cards for the dashboard.

Response fields per item:

- `sessionId`
- `topic`
- `goal`
- `mode`
- `level`
- `status`
- `lastActiveAt`
- `durationMs`
- `summary`
- `lastUserMessagePreview`
- `lastAgentMessagePreview`
- `canvasThumbnailUrl` optional

### `GET /v1/sessions/{sessionId}/resume`

Load everything the frontend needs to reopen a session.

Response:

- top-level session metadata
- latest checkpoint metadata
- `document` snapshot
- `session` snapshot
- `agentAppState` optional
- latest transcript window or paginated first page

The backend can return JSON directly at first. If payload size grows, it can switch to signed GCS URLs later without changing the overall architecture.

### `POST /v1/sessions/{sessionId}/checkpoints`

Create a checkpoint record.

In v1, this endpoint can be used mainly for canvas checkpoints from the frontend, but the request model should already support semantic metadata so the same endpoint can grow later.

Request:

- `checkpointType`
- `saveReason`
- `triggerSource`
- `label` optional
- `summary` optional
- `isImportant` optional
- `includeInReplay` optional
- `document` optional
- `session` optional
- `agentAppState` optional
- `linkedMaterialCheckpointId` optional
- `relatedTurnSequence` optional
- `clientUpdatedAt` optional

Response:

- `checkpointId`
- `version`
- `savedAt`

### `GET /v1/sessions/{sessionId}/transcript`

Paginated transcript fetch for replay or deeper inspection.

### `POST /v1/sessions/{sessionId}/complete`

Optional endpoint to explicitly mark a session complete when the user ends the session from the UI.

## Runtime Write Flows

### New session flow

1. Dashboard calls `POST /v1/sessions`
2. FastAPI creates the session metadata document
3. FastAPI creates the durable ADK session record
4. Frontend navigates to `/#/session/{sessionId}`
5. Frontend starts with an empty Tldraw store and local `persistenceKey`

### Active session flow

1. Frontend connects to `ws/{userId}/{sessionId}`
2. User sends audio or text
3. FastAPI sends input to ADK
4. FastAPI persists transcript turn data as final user and agent utterances become available
5. Frontend periodically sends material checkpoints to `POST /v1/sessions/{sessionId}/checkpoints`
6. FastAPI stores snapshot blobs in GCS and checkpoint metadata in Firestore
7. FastAPI updates `sessions/{sessionId}` summary fields after each committed turn or checkpoint

### Important-topic checkpoint flow

1. Backend agent detects that an important topic or explanation segment is complete
2. Backend agent tool calls an internal checkpoint helper
3. FastAPI creates a semantic checkpoint with `checkpointType=semantic`
4. The semantic checkpoint stores a short label, summary, and transcript linkage
5. In v1, it points to the latest material checkpoint
6. In a later version, FastAPI can request an immediate frontend snapshot for exact alignment

### Resume flow

1. Dashboard fetches `GET /v1/sessions`
2. User chooses a previous session
3. Frontend calls `GET /v1/sessions/{sessionId}/resume`
4. Frontend restores the Tldraw `document` and `session` snapshot
5. Frontend optionally restores serialized `agentAppState`
6. Frontend reconnects to the ADK WebSocket using the same `sessionId`
7. Backend resumes from the persistent ADK session store

## Save Strategy

### Transcript writes

Persist transcript server-side, not via the frontend.

Recommended write policy:

- keep partial transcription in memory only
- commit a transcript turn when either final transcription or `turnComplete` arrives
- optionally archive raw ADK events for debugging in GCS

This avoids excessive write volume while still preserving the complete conversation.

### Canvas writes

Persist canvas state from the frontend.

Recommended write policy:

- debounce autosave on canvas changes, for example every 10 to 15 seconds
- force a save on important lifecycle boundaries:
  - after agent turn completion
  - when disconnecting
  - before page unload
  - when user explicitly resumes or exits

For the first version, store full snapshots instead of diffs. It is simpler and safer. Incremental diffs can be added later if checkpoint size becomes a problem.

### Semantic checkpoint writes

Persist important milestones from the backend.

Recommended write policy:

- create a semantic checkpoint only for meaningful learning boundaries
- keep the label short and stable
- store a concise summary suitable for dashboard or replay use later
- link the checkpoint to transcript ranges and the nearest material checkpoint

Do not create a semantic checkpoint for every turn. The goal is a sparse timeline of meaningful moments.

## Replay Generation Readiness

Replay generation should not be implemented now, but the persistence model should make it straightforward later.

The future replay pipeline can use:

- transcript turns as the narrative timeline
- semantic checkpoints as chapter markers
- material checkpoints as visual restore points
- optional thumbnails or rendered frames for section intros

### Future replay artifacts

If replay generation is added later, store metadata like:

- `replayId`
- `sessionId`
- `status`
- `requestedAt`
- `startedAt`
- `completedAt`
- `videoPath`
- `manifestPath`
- `durationMs`
- `chapterCount`

The manifest can reference:

- transcript ranges
- checkpoint IDs
- chapter titles
- rendering instructions

## Session Attributes To Standardize Now

These are the fields worth locking in early because they affect API and UI design:

- `sessionId`
- `userId`
- `topic`
- `goal`
- `mode`
- `level`
- `status`
- `createdAt`
- `updatedAt`
- `lastActiveAt`
- `durationMs`
- `summary`
- `lastUserMessagePreview`
- `lastAgentMessagePreview`
- `latestCheckpointId`
- `latestCanvasVersion`
- `checkpointCount`
- `milestoneCount`
- `transcriptTurnCount`
- `agentModel`

These should remain optional until needed:

- `canvasThumbnailPath`
- `latestAgentAppStatePath`
- `tokenUsageTotals`
- `toolCalls`
- `rawEventArchivePath`
- `replayStatus`
- `latestReplayId`

## Ownership Boundaries

### Frontend

Responsible for:

- creating new sessions through FastAPI
- loading resume payloads from FastAPI
- collecting Tldraw snapshot data
- sending material checkpoints to FastAPI
- rendering dashboard and replay views from backend APIs

Not responsible for:

- authoritative transcript persistence
- direct database writes
- ADK session state management

### FastAPI backend

Responsible for:

- session metadata CRUD
- transcript persistence
- durable ADK session service
- checkpoint ingestion
- milestone creation
- replay-job orchestration later
- serving dashboard and resume APIs

### Cloudflare canvas agent

Responsible for:

- canvas-agent inference only

Not responsible in v1 for:

- session metadata writes
- dashboard reads
- transcript persistence

## Implementation Phases

### Phase 1

- add Firestore and GCS persistence layer
- add `POST /v1/sessions`
- add `GET /v1/sessions`
- add `GET /v1/sessions/{sessionId}/resume`
- add `POST /v1/sessions/{sessionId}/checkpoints` for material checkpoints
- replace mock frontend `SessionContext` data with backend-backed fetches

### Phase 2

- replace `InMemorySessionService` with a durable session service
- persist normalized transcript turns from WebSocket events
- populate session card previews from transcript and checkpoint metadata
- add semantic checkpoint records from backend logic

### Phase 3

- add replay endpoint and UI
- optionally persist raw ADK events
- optionally persist Cloudflare canvas-agent app state
- add thumbnails, summaries, and replay chapters
- add coordinated backend-requested exact checkpoints

## Recommended First Implementation Decision

The first concrete implementation should be:

- Firestore as the metadata and transcript store
- GCS as the snapshot blob store
- FastAPI as the only persistence API used by the frontend
- transcript persistence done inside the FastAPI WebSocket flow
- material canvas persistence done by frontend checkpoint calls to FastAPI
- semantic milestone persistence done by backend checkpoint creation

This gives a clean separation:

- backend owns conversation truth
- backend owns semantic milestones
- frontend owns snapshot capture
- dashboard reads from one durable session store

## Open Questions

These need product decisions before implementation starts:

- Should session resume restore only the latest canvas, or also a transcript window in the sidebar immediately?
- Do we want one transcript that merges ADK voice turns and Cloudflare canvas-agent turns, or separate histories?
- Do we want session thumbnails generated on every checkpoint or only on explicit save / exit?
- Is `demo-user` temporary, or should the session schema assume real authenticated users now?
- Should semantic checkpoints always trigger an exact frontend snapshot later, or is linking to the latest autosave enough for most sessions?
