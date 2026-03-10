# GCP Frontend + Cloudflare Worker Agent Plan

## Verified Current State

The frontend currently has two different agent integration paths:

1. `client/pages/SessionCanvas.tsx` uses `useAgentWebSocket()` and connects directly to an external backend via `VITE_AGENT_BACKEND_URL`.
2. `client/App.tsx` still uses the original tldraw agent flow, where `client/agent/TldrawAgent.ts` calls `fetch('/stream')` and expects a colocated Cloudflare Worker endpoint on the same origin.

This means the GCP-hosted site can already support the WebSocket-based live agent, but the original tldraw canvas agent will fail unless the browser can reach the Worker-backed `/stream` endpoint.

## Root Cause

The GCP deployment only serves static frontend assets from `frontend/Dockerfile`. It does not host the Cloudflare Worker runtime or the Durable Object backing the original tldraw agent.

Because `TldrawAgent.ts` uses a relative request:

```ts
fetch('/stream', { method: 'POST', body: JSON.stringify(prompt) })
```

the browser tries to call `/stream` on the GCP domain instead of the Cloudflare Worker domain.

## Recommended Fix

Keep the Worker deployed on Cloudflare, and make the frontend call it explicitly by URL instead of assuming same-origin hosting.

### Why this is the lowest-risk fix

- The Worker already exposes CORS headers for cross-origin `POST /stream`.
- The Durable Object architecture can stay unchanged.
- The GCP frontend remains a static deploy.
- The change is limited to frontend endpoint configuration instead of a backend migration.

## Implementation Plan

### 1. Make the tldraw agent stream endpoint configurable

Update `client/agent/TldrawAgent.ts` to stop hardcoding `'/stream'`.

Recommended env variable:

```bash
VITE_TLDRAW_AGENT_STREAM_URL=https://<your-cloudflare-worker-domain>/stream
```

Recommended runtime behavior:

- Use `import.meta.env.VITE_TLDRAW_AGENT_STREAM_URL` when present.
- Fall back to `'/stream'` for local same-origin Worker development.

That gives:

```ts
const streamUrl = import.meta.env.VITE_TLDRAW_AGENT_STREAM_URL || '/stream'
const res = await fetch(streamUrl, {
  method: 'POST',
  body: JSON.stringify(prompt),
  headers: { 'Content-Type': 'application/json' },
  signal,
})
```

### 2. Keep the current WebSocket route separate

Do not replace `VITE_AGENT_BACKEND_URL`.

That variable is already used by `client/hooks/useAgentWebSocket.ts` for the newer `SessionCanvas` flow, which is separate from the Worker-backed tldraw agent path.

After this change, the frontend will have two explicit backend configs:

- `VITE_AGENT_BACKEND_URL` for the live WebSocket agent
- `VITE_TLDRAW_AGENT_STREAM_URL` for the Worker-backed `/canvas` tldraw agent

### 3. Deploy the Worker on a stable public domain

Deploy the Worker with a public HTTPS route, for example:

- `https://agent.your-domain.com/stream`

The frontend must be built with `VITE_TLDRAW_AGENT_STREAM_URL` pointing at that route.

### 4. Verify Worker-side cross-origin behavior

The current Worker already appears compatible with direct browser access because:

- `worker/worker.ts` enables CORS with `origin: '*'`
- `worker/routes/stream.ts` returns `Access-Control-Allow-Origin: *`
- `worker/routes/stream.ts` returns `Access-Control-Allow-Methods: POST, OPTIONS`
- `worker/routes/stream.ts` returns `Access-Control-Allow-Headers: Content-Type`

Verification step:

- Confirm the deployed Worker responds successfully to browser preflight and `POST /stream` from the GCP origin.

### 5. Document production environment expectations

Update frontend deployment docs so production setup clearly states:

- GCP serves static frontend assets
- Cloudflare hosts the Worker and Durable Object
- `/canvas` requires `VITE_TLDRAW_AGENT_STREAM_URL`
- `/session/:sessionId` requires `VITE_AGENT_BACKEND_URL`

## Suggested File Changes

Primary code change:

- `client/agent/TldrawAgent.ts`

Recommended supporting documentation changes:

- `README.md`
- `ARCHITECTURE.md`
- `docs/agent-sidebar.md`

## Verification Checklist

### Local

1. Run the frontend with no `VITE_TLDRAW_AGENT_STREAM_URL` and confirm local Worker-based development still works with relative `/stream`.
2. Run the frontend with `VITE_TLDRAW_AGENT_STREAM_URL` pointing to a deployed Worker and confirm the `/canvas` route works cross-origin.

### Production

1. Open the GCP-hosted app.
2. Navigate to `/#/canvas`.
3. Submit a prompt in the original tldraw chat panel.
4. Confirm the browser sends requests to the Cloudflare Worker domain, not the GCP domain.
5. Confirm streamed agent actions arrive and mutate the canvas.
6. Confirm there are no CORS failures in the browser console.

## Optional Hardening

If you want a cleaner production architecture later, there are two follow-up options:

1. Add a small backend or reverse proxy on the GCP domain so the frontend can still call same-origin `/stream`.
2. Consolidate the two agent integrations behind a shared frontend config module so endpoint resolution is defined in one place.

## Recommended Next Change

Implemented:

- `client/agent/TldrawAgent.ts` now supports `VITE_TLDRAW_AGENT_STREAM_URL`
- the fallback remains same-origin `'/stream'` for local Worker development

Next:

- build the GCP frontend with `VITE_TLDRAW_AGENT_STREAM_URL=https://thinkspace-canvas-agent.pradeeshxdev.workers.dev/stream`
- verify `/#/canvas` calls the Cloudflare Worker directly in production
