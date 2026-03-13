# CI/CD Guide

This document explains the CI/CD setup for ThinkSpace:

- what runs
- when it runs
- why each step exists
- which cloud services are involved
- which Google Cloud APIs are currently enabled in the project

This is the current deployment shape:

- frontend app hosting: GCP Cloud Run
- backend app hosting: GCP Cloud Run
- backend durable metadata: Firestore
- backend large artifacts: GCS
- backend ADK session database: Cloud SQL PostgreSQL
- canvas `/stream` endpoint: Cloudflare Worker
- Cloudflare Worker CI/CD: currently manual-only

## High-Level Architecture

The system is split into two delivery paths.

### 1. GCP application delivery path

This path delivers the main product:

- backend container image -> Artifact Registry -> Cloud Run backend
- frontend container image -> Artifact Registry -> Cloud Run frontend
- backend runtime connects to Firestore, GCS, Secret Manager, and Cloud SQL

### 2. Cloudflare canvas-agent delivery path

This path delivers the original tldraw `/stream` agent:

- Worker code -> Wrangler deploy -> Cloudflare Worker

Right now this workflow is manual-only on purpose so that GCP delivery can be
stabilized first.

## Why CI/CD Is Split This Way

The frontend is not a pure static site in this deployment shape.

- It is built as a Vite app.
- Vite environment values must be known at build time.
- The frontend needs the real backend URL baked into the image.
- The frontend also needs the Cloudflare Worker `/stream` URL baked into the image.

That is why the GCP deploy flow does this order:

1. build backend image
2. deploy backend
3. read backend URL from Terraform output
4. build frontend image with the real backend URL
5. deploy frontend

This order avoids hardcoding placeholder URLs into the frontend image.

## Workflows In This Repo

### `CI`

File:

- `.github/workflows/ci.yml`

When it runs:

- on every pull request
- on every push to `main`

What it does:

- checks frontend type safety
- checks frontend production build
- checks backend dependency resolution and Python compilation
- checks Terraform formatting and validation

Why each step exists:

- `npm ci`: ensures frontend dependency installation is reproducible
- `npm run typecheck`: catches TypeScript mistakes before deployment
- `npm run build`: ensures the production frontend actually builds
- `uv sync --frozen`: ensures backend dependencies match `uv.lock`
- `python -m compileall app`: catches Python syntax/import issues cheaply
- `terraform fmt -check`: keeps Terraform style consistent
- `terraform validate`: catches basic Terraform config problems before deploy

### `Deploy GCP`

File:

- `.github/workflows/deploy-gcp.yml`

When it runs:

- manually via `workflow_dispatch`
- automatically on push to `main` when GCP-relevant files change

What it does:

1. authenticates to GCP from GitHub using Workload Identity Federation
2. builds the backend image with Cloud Build
3. waits for backend build completion
4. initializes Terraform remote state
5. deploys the backend Cloud Run service first
6. reads the backend URL from Terraform output
7. builds the frontend image with the backend URL baked into Vite build args
8. waits for frontend build completion
9. applies the full production Terraform stack
10. smoke-checks the frontend and backend public URLs

Why each step exists:

- GitHub OIDC auth avoids storing long-lived GCP keys in GitHub
- Cloud Build avoids requiring Docker on the GitHub runner
- backend-first deploy gives the frontend the correct runtime target
- Terraform apply keeps infra and service configuration declarative
- smoke checks catch obvious broken deployments immediately

### `Deploy Cloudflare Worker`

File:

- `.github/workflows/deploy-cloudflare-worker.yml`

When it runs:

- manually only

What it does:

1. authenticates to GCP
2. reads the Google API key from Secret Manager
3. writes that key into Cloudflare Worker secrets
4. deploys the Worker with Wrangler

Why it is manual for now:

- the GCP deployment path was the primary stabilization target
- pausing automatic Cloudflare deploys reduces moving parts while the GCP flow is being proven

## End-To-End GCP Deploy Flow

This is the flow you should keep in mind when reading the workflow:

### Step 1. GitHub authenticates to GCP

GitHub Actions uses:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`

This lets GitHub impersonate the deployer service account without a JSON key.

### Step 2. Backend image is built

GitHub triggers:

- `gcloud builds submit backend --config=backend/cloudbuild.yaml`

Cloud Build builds:

- `asia-south1-docker.pkg.dev/ssn-fyp/thinkspace/backend:<sha>`

Why:

- the backend must be available before Cloud Run can deploy it

### Step 3. Backend is deployed first

Terraform applies the backend service resources first so the workflow can read:

- `backend_service_url`

Why:

- the frontend needs this real URL for `VITE_AGENT_BACKEND_URL`
- the frontend also derives `VITE_SESSION_API_BASE_URL` from this path

### Step 4. Frontend image is built

GitHub triggers:

- `gcloud builds submit frontend --config=frontend/cloudbuild.yaml`

Build args passed into the frontend Docker build:

- `VITE_AGENT_BACKEND_URL`
- `VITE_SESSION_API_BASE_URL`
- `VITE_TLDRAW_AGENT_STREAM_URL`

Why:

- Vite embeds these values at build time
- Cloud Run runtime env would be too late for this frontend

### Step 5. Full Terraform apply runs

After both images exist, Terraform applies the full production stack.

Why:

- keeps Cloud Run service definitions, IAM, and infra in sync with code
- ensures the frontend service points to the image just built
- ensures the backend service points to the image just built

### Step 6. Smoke checks run

The workflow checks:

- frontend public URL returns `200`
- backend public URL returns `200`

Why:

- verifies the deployment is reachable at the end of the workflow

## Why Cloud Build Is Polled Instead Of Streaming Logs

The workflow uses asynchronous Cloud Build submission and polls build status.

Why:

- GitHub-authenticated builds were allowed to start
- but log streaming from the default Cloud Build logs bucket was blocked in this setup
- asynchronous submission plus polling avoids that problem cleanly

So the workflow now:

1. submits a build with `--async`
2. waits briefly
3. finds the active build ID
4. polls `gcloud builds describe`

## GitHub Configuration Used By This Setup

### Repository variables

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `CLOUDFLARE_ACCOUNT_ID`

### Repository secrets

- `CLOUDFLARE_API_TOKEN`

### Important note

The Google API key is not stored in GitHub secrets.

It is stored in:

- GCP Secret Manager -> `thinkspace-google-api-key`

and GitHub reads it indirectly through GCP auth.

## GCP Service Accounts Involved

### Runtime service account

- `thinkspace-runtime@ssn-fyp.iam.gserviceaccount.com`

Used by:

- Cloud Run backend

Why it exists:

- the running backend needs access to Firestore, GCS, Secret Manager, and Cloud SQL

### GitHub deployer service account

- `thinkspace-github-deployer@ssn-fyp.iam.gserviceaccount.com`

Used by:

- GitHub Actions deploy workflows

Why it exists:

- GitHub needs a deployment identity that is separate from the runtime app identity
- this service account can build images, apply Terraform, and deploy services

## Terraform And CI/CD Relationship

Terraform is the source of truth for infrastructure and service definitions.

Cloud Build is the source of truth for building container images.

GitHub Actions orchestrates both:

- build images
- wait for builds
- apply Terraform
- smoke-check the result

This separation is important:

- Terraform should describe infrastructure
- Cloud Build should build container artifacts
- GitHub Actions should coordinate delivery steps

## Production URLs In Use

At the time of writing, the deployed GCP services are:

- backend: `https://thinkspace-backend-5if4khzusa-el.a.run.app`
- frontend: `https://thinkspace-frontend-5if4khzusa-el.a.run.app`

Worker stream URL used by the frontend build:

- `https://thinkspace-canvas-agent.pradeeshxdev.workers.dev/stream`

## Google Cloud APIs Enabled In The Project

The following APIs are currently enabled in `ssn-fyp` according to:

- `gcloud services list --enabled --project=ssn-fyp`

### APIs directly used by the current CI/CD and runtime setup

- `artifactregistry.googleapis.com`
- `cloudbuild.googleapis.com`
- `cloudresourcemanager.googleapis.com`
- `firestore.googleapis.com`
- `iam.googleapis.com`
- `iamcredentials.googleapis.com`
- `run.googleapis.com`
- `secretmanager.googleapis.com`
- `serviceusage.googleapis.com`
- `sqladmin.googleapis.com`
- `storage.googleapis.com`
- `sts.googleapis.com`

### Other APIs currently enabled in the project

- `aiplatform.googleapis.com`
- `appengine.googleapis.com`
- `appenginereporting.googleapis.com`
- `bigquery.googleapis.com`
- `bigquerymigration.googleapis.com`
- `bigquerystorage.googleapis.com`
- `cloudapis.googleapis.com`
- `cloudtrace.googleapis.com`
- `containeranalysis.googleapis.com`
- `containerregistry.googleapis.com`
- `dataform.googleapis.com`
- `datastore.googleapis.com`
- `fcm.googleapis.com`
- `firebase.googleapis.com`
- `firebaseappcheck.googleapis.com`
- `firebasedynamiclinks.googleapis.com`
- `firebasehosting.googleapis.com`
- `firebaseinstallations.googleapis.com`
- `firebaseremoteconfig.googleapis.com`
- `firebaseremoteconfigrealtime.googleapis.com`
- `firebaserules.googleapis.com`
- `firebasestorage.googleapis.com`
- `generativelanguage.googleapis.com`
- `identitytoolkit.googleapis.com`
- `logging.googleapis.com`
- `monitoring.googleapis.com`
- `pubsub.googleapis.com`
- `runtimeconfig.googleapis.com`
- `securetoken.googleapis.com`
- `servicemanagement.googleapis.com`
- `sql-component.googleapis.com`
- `storage-api.googleapis.com`
- `storage-component.googleapis.com`
- `testing.googleapis.com`

## Which Enabled Services Matter Most Right Now

If you want the short operational list to remember, these are the most important
ones for the current delivery path:

- Artifact Registry
- Cloud Build
- Cloud Run
- Firestore
- IAM
- IAM Credentials
- Secret Manager
- Cloud SQL Admin
- Cloud Storage
- Security Token Service
- Service Usage

## What To Check First When A Deploy Fails

### If CI fails

Check:

- frontend type errors
- frontend build output
- backend dependency sync
- Terraform validation

### If `Deploy GCP` fails before build starts

Check:

- GitHub OIDC variables
- deployer service account permissions
- Workload Identity Federation binding

### If Cloud Build starts but the workflow fails

Check:

- Cloud Build status in GCP Console
- Cloud Build permissions for the deployer account
- whether the workflow is polling build status correctly

### If backend deploy fails

Check:

- Cloud Run revision error message
- Secret Manager secret version configuration
- Cloud SQL connectivity
- runtime service account permissions

### If frontend deploy fails

Check:

- Vite build args
- backend URL value baked into the image
- Cloudflare Worker `/stream` URL value

## Current Operational Notes

- Cloudflare deploy is paused from automatic push-based delivery and is manual-only.
- The backend uses a pinned secret version for the Google API key in Terraform.
- Local SQLite remains a development-only fallback.
- Production ADK session persistence uses Cloud SQL, not the local SQLite file.

## Recommended Future Improvements

- move more of the GCP IAM and GitHub OIDC setup into Terraform
- add more explicit smoke tests for backend health and websocket behavior
- add environment separation if staging is introduced later
- add artifact/image retention policies in Artifact Registry
