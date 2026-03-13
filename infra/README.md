# Terraform Infrastructure

This directory contains the first GCP infrastructure phase for ThinkSpace.

## What "bootstrap" means

Terraform needs somewhere durable to store its state. For GCP, the usual
production setup is a remote state bucket in Google Cloud Storage.

The `bootstrap/` stack exists only to create that bucket and related
foundational settings. After that bucket exists, the real environment stack in
`environments/prod/` can use it as its Terraform backend.

In short:

1. Run `bootstrap/` once to create the Terraform state bucket.
2. Configure `environments/prod/` to use that bucket for remote state.
3. Run the production stack to provision app infrastructure.

## Current Phase Scope

This initial implementation provisions:

- required GCP APIs
- Artifact Registry
- Firestore database
- GCS artifact bucket
- Secret Manager secrets
- runtime service account
- Cloud SQL PostgreSQL for ADK session storage
- Cloud Run services for frontend and backend

The production stack now also defines the frontend and backend Cloud Run
services. Those services expect container images to exist in Artifact Registry.

## Directory Layout

- `bootstrap/`: creates the Terraform state bucket
- `environments/prod/`: production GCP infrastructure

## Before Terraform

Install and authenticate the Google Cloud CLI first.

### 1. Make sure `gcloud` is installed

```bash
gcloud version
```

### 2. Authenticate your machine for local Terraform runs

```bash
gcloud auth application-default login
gcloud config set project ssn-fyp
```

Terraform uses Application Default Credentials when you run it locally.

### 3. Optional sanity check

```bash
gcloud auth application-default print-access-token >/dev/null && echo "ADC OK"
```

If that prints `ADC OK`, local auth is ready.

## Step 1: Bootstrap

This creates the Terraform state bucket.

```bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
```

Review `terraform.tfvars`, then run:

```bash
terraform init
terraform plan
terraform apply
```

### Verify bootstrap

```bash
terraform output
```

Expected result:

- Terraform prints the state bucket name and URL
- GCP Console -> Cloud Storage shows the bucket

## Step 2: Production Infrastructure

This provisions the shared production resources.

```bash
cd infra/environments/prod
cp terraform.tfvars.example terraform.tfvars
```

Review `terraform.tfvars`, then initialize the backend using the bucket created
by bootstrap:

```bash
terraform init \
  -backend-config="bucket=ssn-fyp-thinkspace-tfstate" \
  -backend-config="prefix=prod"
```

Then run:

```bash
terraform plan
terraform apply
```

### Important note about Firestore location

Firestore location is independent from your main app region.

For this project:

- app region can stay `asia-south1`
- the existing Firestore database `thinkspace-db` is in `nam5`

If you are importing an existing Firestore database, `firestore_location` in
Terraform must exactly match the database's real location or Terraform will
plan a forced replacement.

## What Terraform Creates In `prod`

- Artifact Registry repository for images
- Firestore database for ThinkSpace durable metadata
- GCS bucket for session artifacts and large blobs
- Secret Manager secrets
- runtime service account and IAM
- Cloud SQL PostgreSQL instance, database, and user for ADK session storage
- backend Cloud Run service
- frontend Cloud Run service

## Cloud Run Image Expectations

The Terraform stack assumes these default image names unless you override them:

- backend: `asia-south1-docker.pkg.dev/ssn-fyp/thinkspace/backend:latest`
- frontend: `asia-south1-docker.pkg.dev/ssn-fyp/thinkspace/frontend:latest`

That means the Cloud Run phase only works after those images exist in Artifact
Registry.

### Frontend build-time configuration

The frontend is a Vite app, so these values must be baked into the image at
build time:

- `VITE_AGENT_BACKEND_URL`
- `VITE_SESSION_API_BASE_URL`
- `VITE_TLDRAW_AGENT_STREAM_URL`

The frontend Dockerfile now accepts those as Docker build arguments.

Example:

```bash
docker build \
  --build-arg VITE_AGENT_BACKEND_URL=wss://your-backend-url \
  --build-arg VITE_SESSION_API_BASE_URL=https://your-backend-url \
  --build-arg VITE_TLDRAW_AGENT_STREAM_URL=https://your-worker-domain/stream \
  -t asia-south1-docker.pkg.dev/ssn-fyp/thinkspace/frontend:latest \
  frontend
```

### Manual Cloud Build commands

If Docker is not available locally, use Cloud Build.

Build and push the backend image:

```bash
gcloud builds submit backend \
  --config=backend/cloudbuild.yaml \
  --substitutions=_IMAGE=asia-south1-docker.pkg.dev/ssn-fyp/thinkspace/backend:latest
```

Build and push the frontend image:

```bash
gcloud builds submit frontend \
  --config=frontend/cloudbuild.yaml \
  --substitutions=_IMAGE=asia-south1-docker.pkg.dev/ssn-fyp/thinkspace/frontend:latest,_VITE_AGENT_BACKEND_URL=wss://thinkspace-backend-5if4khzusa-el.a.run.app,_VITE_SESSION_API_BASE_URL=https://thinkspace-backend-5if4khzusa-el.a.run.app,_VITE_TLDRAW_AGENT_STREAM_URL=https://thinkspace-canvas-agent.pradeeshxdev.workers.dev/stream
```

After both images are pushed:

```bash
cd infra/environments/prod
terraform apply
```

### Backend runtime configuration

The backend Cloud Run service is configured by Terraform with:

- Firestore-backed ThinkSpace session storage
- GCS artifact bucket wiring
- Secret Manager-backed `GOOGLE_API_KEY`
- Cloud SQL PostgreSQL-backed ADK session storage

Local development still uses SQLite by default, but production now prefers
Cloud SQL via runtime env vars mounted into Cloud Run.

## Verify Production Resources

### 1. Check Terraform outputs

```bash
terraform output
```

You should see outputs for:

- Artifact Registry URL
- default backend image
- default frontend image
- session artifacts bucket name
- Firestore database ID
- runtime service account email
- Cloud SQL connection name
- Cloud SQL database and user names
- backend Cloud Run URL
- frontend Cloud Run URL

### 2. Verify in GCP Console

Check that these exist:

- Artifact Registry -> repository `thinkspace`
- Cloud Storage -> bucket `ssn-fyp-thinkspace-artifacts`
- Firestore -> database `thinkspace-db`
- Secret Manager -> secret `thinkspace-google-api-key`
- Secret Manager -> secret `thinkspace-adk-db-password`
- IAM -> service account `thinkspace-runtime@ssn-fyp.iam.gserviceaccount.com`
- Cloud SQL -> instance `thinkspace-adk`
- Cloud SQL -> database `thinkspace_adk`
- Cloud SQL -> user `thinkspace_app`
- Cloud Run -> service `thinkspace-backend`
- Cloud Run -> service `thinkspace-frontend`

### 3. Quick smoke checks

```bash
curl -sS -o /dev/null -w 'frontend:%{http_code}\n' "https://thinkspace-frontend-5if4khzusa-el.a.run.app"
curl -sS -o /dev/null -w 'backend:%{http_code}\n' "https://thinkspace-backend-5if4khzusa-el.a.run.app"
curl -sS -o /dev/null -w '%{http_code}\n' -X OPTIONS "https://thinkspace-canvas-agent.pradeeshxdev.workers.dev/stream"
```

Expected:

- frontend returns `200`
- backend returns `200`
- worker preflight returns `204`

## Add The Google API Key Secret Value

Terraform creates the secret container, but the actual Gemini API key value must
be added separately unless you explicitly manage it elsewhere.

```bash
printf '%s' 'YOUR_GOOGLE_API_KEY' | gcloud secrets versions add thinkspace-google-api-key --data-file=-
```

Verify:

```bash
gcloud secrets versions list thinkspace-google-api-key
```

If you need Cloud Run to use a specific known-good secret version, set this in
`infra/environments/prod/terraform.tfvars`:

```tfvars
google_api_key_secret_version = "3"
```

## Recovering From Existing-Resource Errors

If Terraform fails with `409 already exists`, that usually means the resource is
already present in GCP but not yet tracked in Terraform state.

This is recoverable. It does not mean everything failed.

### What likely happened

If Terraform output shows some resources as `Creation complete`, those resources
were created successfully before the apply stopped.

### Check what Terraform is already tracking

```bash
terraform state list
```

### Example: import an existing Firestore database

If `thinkspace-db` already exists in GCP, import it:

```bash
terraform import google_firestore_database.thinkspace ssn-fyp/thinkspace-db
```

### Example: import an existing Secret Manager secret

If `thinkspace-google-api-key` already exists in GCP, import it:

```bash
terraform import google_secret_manager_secret.google_api_key thinkspace-google-api-key
```

After imports, re-run:

```bash
terraform plan
terraform apply
```

### If Terraform wants to replace Firestore after import

Check the real database location:

```bash
gcloud firestore databases describe --database=thinkspace-db --project=ssn-fyp
```

If the output shows `locationId: nam5`, then set:

```tfvars
firestore_location = "nam5"
```

Then re-run:

```bash
terraform plan
terraform apply
```

## Current ThinkSpace Production Mapping

Local development still uses the SQLite file at
`backend/app/data/thinkspace_adk.db` by default.

Production should not use that local file. Cloud Run filesystems are ephemeral,
so production uses:

- Firestore for ThinkSpace session metadata
- GCS for large session artifacts
- Cloud SQL PostgreSQL for ADK session storage

## Next Phase

After this infrastructure phase is healthy, the next delivery phase is CI/CD:

- build and push frontend/backend images
- pass Vite build args for production frontend URLs
- deploy new Cloud Run revisions automatically
- deploy the Cloudflare Worker `/stream` endpoint

## GitHub Actions Setup

The repo now includes these workflows:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-gcp.yml`
- `.github/workflows/deploy-cloudflare-worker.yml`

### What the workflows do

- `ci.yml`
  - builds and typechecks the frontend
  - syncs backend dependencies and compiles Python sources
  - runs Terraform format and validate checks
- `deploy-gcp.yml`
  - builds backend and frontend images with Cloud Build
  - submits builds asynchronously and polls build status instead of streaming logs
  - deploys the backend and frontend Cloud Run services
  - smoke-checks the public URLs
- `deploy-cloudflare-worker.yml`
  - currently manual-only via `workflow_dispatch`
  - fetches the Google API key from Secret Manager
  - updates the Cloudflare Worker secret
  - deploys the Worker with Wrangler

### GitHub repository variables to set

Set these in GitHub Actions repository variables:

- `GCP_WORKLOAD_IDENTITY_PROVIDER`
- `GCP_SERVICE_ACCOUNT_EMAIL`
- `CLOUDFLARE_ACCOUNT_ID`

### GitHub repository secrets to set

Set this in GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`

### Required Google IAM for GitHub OIDC

The service account referenced by `GCP_SERVICE_ACCOUNT_EMAIL` needs permissions
to:

- run Cloud Build
- administer Cloud Run
- access Secret Manager
- use Artifact Registry
- read and update Terraform-managed infrastructure

If you decide to use GitHub OIDC for Terraform and deploys, make sure the
workload identity pool/provider and service-account binding are configured in
GCP before enabling the workflows.
