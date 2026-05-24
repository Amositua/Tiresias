#!/usr/bin/env bash
# infra/setup.sh — provision GCP resources for Tiresias
#
# Run once before starting development:
#   bash infra/setup.sh
#
# Prerequisites:
#   - gcloud authenticated: gcloud auth login && gcloud auth application-default login
#   - Billing enabled on the tiresias-496915 GCP project
#   - .env file populated (or env vars exported)

set -euo pipefail

PROJECT="${GOOGLE_CLOUD_PROJECT:-tiresias-496915}"
REGION="${GCP_REGION:-us-central1}"
META_DATASET="${BIGQUERY_META_DATASET:-tiresias_meta}"

echo "==> Setting up Tiresias GCP resources"
echo "    Project:  $PROJECT"
echo "    Region:   $REGION"
echo "    Dataset:  $META_DATASET"
echo ""

# Enable required APIs
echo "==> Enabling GCP APIs..."
gcloud services enable \
  bigquery.googleapis.com \
  bigquerydatatransfer.googleapis.com \
  pubsub.googleapis.com \
  cloudfunctions.googleapis.com \
  run.googleapis.com \
  aiplatform.googleapis.com \
  --project="$PROJECT"

echo "    APIs enabled."

# BigQuery: meta dataset
echo "==> Creating BigQuery dataset: $META_DATASET ..."
bq --project_id="$PROJECT" mk \
  --dataset \
  --location=US \
  --description="Tiresias agent metadata: fingerprints, drift reports, audit log" \
  "$PROJECT:$META_DATASET" 2>/dev/null && echo "    Dataset created." || echo "    Dataset already exists."

# BigQuery: tiresias_fingerprints table
echo "==> Creating tiresias_fingerprints table..."
bq --project_id="$PROJECT" query \
  --use_legacy_sql=false \
  --location=US \
  "$(cat infra/bigquery_schema.sql)"
echo "    Table ready."

# Cloud Pub/Sub topic
echo "==> Creating Pub/Sub topic: tiresias-sync-events ..."
gcloud pubsub topics create tiresias-sync-events \
  --project="$PROJECT" 2>/dev/null && echo "    Topic created." || echo "    Topic already exists."

echo ""
echo "==> Setup complete. Run 'make dev' to start the development server."
echo "    Next: populate .env with your Fivetran and HubSpot credentials."
