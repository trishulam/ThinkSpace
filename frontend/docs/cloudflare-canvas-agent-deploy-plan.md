# Cloudflare Canvas Agent Deployment Plan

## Goal

Deploy the original tldraw canvas agent backend from `frontend/worker/` to Cloudflare so it is reachable publicly and stable before integrating the GCP-hosted frontend with it.

This plan is only for the canvas agent backend:

- Frontend stays on GCP
- Custom FastAPI live agent stays on GCP
- Canvas agent Worker + Durable Object stay on Cloudflare

## Deployment Status Of This Repo

The repo has been updated for a straightforward first deployment:

- `wrangler.toml` now uses the Worker name `thinkspace-canvas-agent`
- custom-domain routing has been removed for now
- deployment will use the default Cloudflare `workers.dev` URL first
- `package.json` now includes `npm run cf:deploy` and `npm run cf:tail`

## Verified Current Backend Shape

The canvas agent backend is already structured for Cloudflare Workers:

- `worker/worker.ts` exposes `POST /stream`
- `worker/routes/stream.ts` forwards requests to a Durable Object
- `worker/do/AgentDurableObject.ts` streams SSE back to the browser
- `worker/do/AgentService.ts` calls the model providers
- `wrangler.toml` defines the Worker and Durable Object binding

## Important Deployment Constraints

### 1. The default model is now Gemini

The repo is now configured to default to `gemini-3-flash-preview`.

That means the minimum required Cloudflare secret is now `GOOGLE_API_KEY`.

### 2. The Worker environment expects provider secrets

The Worker environment currently defines:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`

At minimum, make sure `GOOGLE_API_KEY` is present in Cloudflare secrets.

### 3. The Durable Object is currently single-tenant

All requests are routed to the same Durable Object name, `anonymous`.

For your current goal, this is acceptable and matches a single-user deployment.

### 4. `wrangler.toml` still looks template-oriented

That has now been cleaned up enough for an initial `workers.dev` deployment.

## Recommended Rollout

### Phase 1. Use the default `workers.dev` deployment first

The repo is now set up to deploy directly to Cloudflare without needing a custom domain first.

Expected initial public endpoint shape:

- `https://thinkspace-canvas-agent.<your-subdomain>.workers.dev/stream`

You can move this to a custom domain later if needed, but using `workers.dev` is the fastest way to get the backend up and validated.

### Phase 2. Choose the initial model path

Decide which provider you want for the first working deployment.

Recommended simplest path:

1. Keep the current default model behavior.
2. Set `GOOGLE_API_KEY` in Cloudflare.
3. Treat Anthropic and OpenAI keys as optional follow-up unless the app actively selects those models.

This repo is already set up for that path now.

### Phase 3. Provision Cloudflare secrets

In Cloudflare Worker secrets, set:

- `GOOGLE_API_KEY` for the current default model
- `OPENAI_API_KEY` if you plan to use OpenAI-backed models
- `ANTHROPIC_API_KEY` if you plan to use Anthropic-backed models

Recommended initial deployment:

- set `GOOGLE_API_KEY`
- add the others only if you later enable those providers

### Phase 4. Deploy the Worker and Durable Object

Deploy from `frontend/` using Wrangler so Cloudflare registers:

- the Worker code from `worker/worker.ts`
- the `AgentDurableObject`
- the migrations in `wrangler.toml`

Expected result after deploy:

- the Worker is publicly reachable
- Durable Object binding resolves correctly
- `POST /stream` returns an SSE response instead of 404/500

## Exact Deployment Steps

Run these from `frontend/`.

### 1. Log into Cloudflare

```bash
npx wrangler login
```

This opens a browser flow and connects Wrangler to your Cloudflare account.

### 2. Verify the Worker config

The current deployment config is:

- Worker name: `thinkspace-canvas-agent`
- entrypoint: `worker/worker.ts`
- Durable Object binding: `AGENT_DURABLE_OBJECT`
- deploy target: default `workers.dev`

### 3. Set the Worker secrets

At minimum, set the Google key because the current default model is `gemini-3-flash-preview`.

```bash
npx wrangler secret put GOOGLE_API_KEY
```

Optional provider keys:

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put ANTHROPIC_API_KEY
```

Wrangler will prompt you to paste each value securely.

### 4. Deploy the Worker

```bash
npm run cf:deploy
```

This script now rebuilds first, which is important because Wrangler had been deploying from a stale generated config in `dist/agent_template/wrangler.json`.

Expected output:

- Cloudflare uploads the Worker
- the Durable Object migration is applied if needed
- Wrangler prints the public `workers.dev` URL

Save that URL. Your stream endpoint will be:

```text
https://<printed-workers-url>/stream
```

### 5. Tail logs while testing

In a separate terminal:

```bash
npm run cf:tail
```

This helps catch missing secret errors, model errors, and Durable Object routing problems immediately.

### 6. Smoke test CORS

Replace `<WORKER_URL>` with the URL printed by Wrangler:

```bash
curl -i -X OPTIONS "<WORKER_URL>/stream" \
  -H "Origin: https://example.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type"
```

You should see:

- a successful response
- `Access-Control-Allow-Origin`
- `Access-Control-Allow-Methods`
- `Access-Control-Allow-Headers`

### 7. Smoke test `POST /stream`

You can send a minimal JSON body first just to confirm the Worker responds. It may still error if the prompt shape is incomplete, but the endpoint itself should be reachable.

```bash
curl -i -N -X POST "<WORKER_URL>/stream" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected result:

- response is not `404`
- response content type is `text/event-stream`
- if the payload is invalid, the stream should still emit a readable error event rather than a route failure

### 8. Real backend validation

After the endpoint is up, validate with a real prompt from the frontend later, once `VITE_TLDRAW_AGENT_STREAM_URL` is wired to the deployed Worker.

### Phase 5. Smoke test the backend before frontend integration

Validate the Worker directly before touching the GCP frontend.

Test cases:

1. `OPTIONS /stream`
   - should return CORS headers
2. `POST /stream` with a minimal valid prompt body
   - should return `content-type: text/event-stream`
3. a real prompt through the original `/canvas` request payload
   - should stream `data: ...` SSE chunks
4. invalid or missing API key path
   - should surface a readable streamed error

## Deployment Checklist

### Config

- Worker name is `thinkspace-canvas-agent`
- deploy first on `workers.dev`
- verify Durable Object binding name remains `AGENT_DURABLE_OBJECT`
- preserve or consciously replace the existing migration config

### Secrets

- set `GOOGLE_API_KEY`
- set `OPENAI_API_KEY` if needed
- set `ANTHROPIC_API_KEY` if needed

### Verification

- deployed Worker responds on public HTTPS
- `OPTIONS /stream` succeeds
- `POST /stream` succeeds
- SSE streaming works end-to-end
- no Durable Object binding errors appear

## Recommended Validation Command Flow

Use this order after deployment:

1. Hit the public Worker URL to confirm DNS and SSL are correct.
2. Send an `OPTIONS` request to `/stream`.
3. Send a test `POST` to `/stream`.
4. Inspect Cloudflare logs if the stream fails.
5. Only after this passes, wire the GCP frontend to the Worker URL.

## Risks To Address Early

### Shared Durable Object instance

Because the route code uses a fixed object name, all requests go through one shared Durable Object instance.

For your current single-user goal, this is acceptable and does not need to be changed before deployment.

### Model-secret mismatch

If the frontend or prompt resolves to a model whose provider key is missing, the Worker may deploy fine but fail at runtime.

### Route mismatch

If Cloudflare publishes the Worker on one hostname but the frontend later points to another, the integration will fail even though the Worker itself is healthy.

## Suggested First Execution Order

1. Log into Cloudflare with Wrangler.
2. Set `GOOGLE_API_KEY` and any optional provider secrets.
3. Run `npm run cf:deploy`.
4. Copy the printed `workers.dev` URL.
5. Smoke test `/stream` directly.
6. After that, integrate the GCP frontend with the public Worker URL.

## After This Plan

Once this backend deployment is verified, the next integration step is small:

- make `client/agent/TldrawAgent.ts` use `VITE_TLDRAW_AGENT_STREAM_URL`
- point that env var at the deployed Cloudflare `/stream` endpoint
