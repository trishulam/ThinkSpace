# GCP Backend Deployment Plan

## Goal

Deploy the FastAPI live agent in `backend/` to Google Cloud Run so the frontend can use it as the production WebSocket backend for `/#/session/:sessionId`.

This plan covers:

- FastAPI backend on GCP
- Cloudflare canvas agent staying on Cloudflare
- GCP frontend connecting to both backends with separate env vars

## Verified Current Backend Shape

The backend is a FastAPI + Uvicorn service with a WebSocket endpoint:

- ASGI app: `backend/app/main.py`
- WebSocket route: `/ws/{user_id}/{session_id}`
- Session storage: `InMemorySessionService`
- Agent config: `backend/app/thinkspace_agent/config.py`
- Python project config: `backend/pyproject.toml`

## Important Deployment Constraints

### 1. The backend is stateful in-process

`backend/app/main.py` uses `InMemorySessionService`, so session state is stored in a single process.

Implication:

- for your current single-user target, deploy a single Cloud Run instance
- do not scale horizontally yet

Recommended initial Cloud Run settings:

- `--max-instances=1`
- `--min-instances=1`
- low concurrency, such as `--concurrency=1`

### 2. The backend expects runtime environment variables

The backend loads `app/.env` locally, but in Cloud Run you should use runtime env vars and secrets instead.

Most important variables:

- `GOOGLE_API_KEY`
- `THINKSPACE_AGENT_MODEL`

Optional Vertex AI path:

- `GOOGLE_GENAI_USE_VERTEXAI=TRUE`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`

### 3. The backend has a working-directory import assumption

The README documents starting the app from `backend/app`:

```bash
uv run --project .. uvicorn main:app --host 0.0.0.0 --port 8000
```

That means deployment should preserve this startup pattern or explicitly set the working directory in the container.

## Recommended Deployment Approach

Use Cloud Run with a dedicated backend container.

Why this is the safest path:

- you control the working directory explicitly
- you can install `uv` and Python dependencies predictably
- you can set the Uvicorn startup command exactly
- it avoids buildpack ambiguity around module paths

## Proposed Deployment Shape

### Container runtime

Use Python 3.11 slim as the base image.

### Startup command

Run the server from `backend/app`:

```bash
uv run --project .. uvicorn main:app --host 0.0.0.0 --port ${PORT}
```

### Network surface

The frontend should point `VITE_AGENT_BACKEND_URL` at the Cloud Run base URL without the `/ws/...` suffix.

Example:

```bash
VITE_AGENT_BACKEND_URL=wss://thinkspace-live-agent-<hash>.asia-south1.run.app
```

The frontend hook already appends:

```text
/ws/{userId}/{sessionId}
```

## Required Implementation Steps

### 1. Add a backend Dockerfile

Implemented:

- `backend/Dockerfile`
- `backend/.dockerignore`

The Dockerfile:

- uses Python 3.11 slim
- installs `uv`
- installs locked dependencies from `uv.lock`
- copies the backend app
- runs from `backend/app`
- starts `uvicorn main:app` on `$PORT`

### 2. Use Cloud Run secrets for `GOOGLE_API_KEY`

Do not rely on `app/.env` in production.

Recommended:

- store `GOOGLE_API_KEY` in Secret Manager
- inject it into Cloud Run with `--set-secrets`

### 3. Set the model explicitly

Set:

```bash
THINKSPACE_AGENT_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
```

This keeps production aligned with your current backend behavior.

### 4. Deploy as a single-instance service

Recommended first deploy:

- one instance only
- low concurrency
- unauthenticated public access if the frontend is calling it directly from the browser

### 5. Verify WebSocket behavior directly

Before wiring the frontend:

- open the Cloud Run URL
- confirm the service starts
- test the WebSocket route from the frontend or a websocket client

## Suggested Cloud Run Configuration

For the current single-user setup, start with:

- region: `asia-south1`
- `--allow-unauthenticated`
- `--min-instances=1`
- `--max-instances=1`
- `--concurrency=1`
- timeout high enough for long-lived WebSocket sessions

Recommended timeout:

- `--timeout=3600`

## Exact Deployment Commands

Run these from `backend/`.

### 1. Create the GCP secret once

```bash
printf '%s' '<YOUR_GOOGLE_API_KEY>' | gcloud secrets create thinkspace-google-api-key --data-file=-
```

If the secret already exists, update it instead:

```bash
printf '%s' '<YOUR_GOOGLE_API_KEY>' | gcloud secrets versions add thinkspace-google-api-key --data-file=-
```

### 2. Deploy the backend to Cloud Run

```bash
gcloud run deploy thinkspace-live-agent \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 1 \
  --timeout 3600 \
  --set-secrets GOOGLE_API_KEY=thinkspace-google-api-key:latest \
  --set-env-vars THINKSPACE_AGENT_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
```

### 3. Optional plain env-var version

If you want the fastest possible first deploy and do not want to use Secret Manager yet:

```bash
gcloud run deploy thinkspace-live-agent \
  --source . \
  --region asia-south1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 1 \
  --timeout 3600 \
  --set-env-vars GOOGLE_API_KEY=<YOUR_GOOGLE_API_KEY>,THINKSPACE_AGENT_MODEL=gemini-2.5-flash-native-audio-preview-12-2025
```

Using Secret Manager is still the recommended version.

## Deployment Checklist

### Backend container

- add `backend/Dockerfile`
- ensure the server binds to `0.0.0.0:$PORT`
- ensure startup runs from `backend/app`

### Runtime config

- inject `GOOGLE_API_KEY`
- set `THINKSPACE_AGENT_MODEL`
- optionally set Vertex AI env vars if you move away from API-key auth later

### Cloud Run

- deploy in `asia-south1`
- keep max instances at 1
- keep concurrency low
- set long request timeout

### Frontend integration

After backend deploy, set the frontend build env:

```bash
VITE_AGENT_BACKEND_URL=wss://<your-cloud-run-service-url>
VITE_TLDRAW_AGENT_STREAM_URL=https://thinkspace-canvas-agent.pradeeshxdev.workers.dev/stream
```

Important:

- `VITE_AGENT_BACKEND_URL` should be the Cloud Run service base URL only
- do not append `/ws/...`

## Verification Plan

### Backend-only verification

1. Deploy the Cloud Run service.
2. Confirm the root URL responds.
3. Confirm the service stays up with the configured runtime env vars.
4. Check Cloud Run logs for startup/import errors.

### End-to-end verification

1. Build and redeploy the frontend with the Cloud Run base URL in `VITE_AGENT_BACKEND_URL`.
2. Open `/#/session/:sessionId`.
3. Click connect in the live agent sidebar.
4. Confirm the browser opens:

```text
wss://<cloud-run-service>/ws/<userId>/<sessionId>
```

5. Send text and audio input.
6. Confirm streamed ADK events arrive in the UI.

## Risks To Watch

### In-memory session storage

If Cloud Run restarts the instance, session state is lost.

That is acceptable for your current single-user setup, but it is not durable.

### Instance scaling

If Cloud Run scales above one instance later, sessions will not be shared.

### WebSocket timeout/config

If timeout is too low, long-lived voice sessions may disconnect unexpectedly.

## Recommended Next Step

Implemented:

- `backend/Dockerfile`
- `backend/.dockerignore`

Next:

- deploy `thinkspace-live-agent` on Cloud Run
- copy the resulting Cloud Run service URL
- set `VITE_AGENT_BACKEND_URL=wss://<cloud-run-service-url>` in the frontend build
