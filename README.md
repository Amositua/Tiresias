# Tiresias — The Pre-Cognitive Data Quality Agent

> *"The pipeline is green. The data is wrong."*

Fivetran's 2026 State of the Data Pipeline report found that large enterprises face **$3M/month in pipeline-failure exposure**, with engineers spending **53% of their time maintaining pipelines** — yet most monitoring tools only alert when something technically breaks. They cannot see silent failures: schema drifts, broken joins, and distribution shifts that downstream dashboards consume as truth while every sync succeeds and every dbt run passes.

Tiresias is a multi-agent system that detects those invisible failures before the VP of Sales discovers them in a board meeting.

Named after the blind prophet of Greek myth who could see what others could not.

---

## What Tiresias does

A Fivetran sync completes. Nothing breaks. But the source system quietly renamed a deal stage. Downstream, a dbt model filters on a string literal that no longer exists. The "Late Stage Pipeline" KPI silently returns $0. No alert fires.

Tiresias catches it — in seconds, before any human reads a dashboard.

```
Fivetran sync completed
        │
        ▼
Memory: fingerprint the synced table
  → PSI spike on deal_pipeline_stage.label (2.1 vs threshold 0.25)
  → "Contract Sent" absent from distribution; "Contract Under Review" present at same frequency
  → hubspot.deal shows no anomaly — fact table is clean, dimension table is not
        │
        ▼
Lineage: trace the blast radius
  → hubspot.deal_pipeline_stage → stg_deals → fct_pipeline_by_stage → "Late Stage Pipeline" dashboard → VP of Sales
        │
        ▼
Oracle (Gemini 3.1 Pro): classify the drift
  → SILENT_SEMANTIC_FAILURE, 94% confidence
  → "Downstream models using string-literal equality on 'Contract Sent' will silently return empty result sets"
        │
        ▼
Tiresias: propose a fix, wait for human approval
  → Human approves in the dashboard
  → Fivetran MCP executes: modify_connection_table_config → deal_pipeline_stage.enabled=false
        │
        ▼
Audit log records every decision
```

---

## Architecture

```mermaid
graph TD
    FT[Fivetran Sync Event] -->|webhook| PS[Cloud Pub/Sub]
    PS -->|trigger| CF[Cloud Function]
    CF --> T[Tiresias Orchestrator\nADK + Gemini 3.1 Pro]

    T --> M[Memory Agent\nBigQuery Fingerprinting]
    M -->|DriftReport| T
    T --> L[Lineage Agent\ndbt manifest graph]
    L -->|BlastRadius| T
    T --> O[Oracle Agent\nGemini 3.1 Pro inference]
    O -->|Verdict| T

    T -->|SILENT_SEMANTIC_FAILURE| D[Dashboard\nNext.js on Cloud Run]
    D -->|human approves| T
    T --> MCP[Fivetran MCP Server]
    MCP --> FTA[Fivetran API]

    M <-->|read/write fingerprints| BQ[(BigQuery\ntiresias_meta)]
    BQ2[(BigQuery\nhubspot raw tables)] --> M
```

### Agents

| Agent | File | Role |
|---|---|---|
| **Tiresias** | `backend/tiresias/orchestrator.py` | Top-level orchestrator; owns the decision loop |
| **Memory** | `backend/memory/fingerprint.py` | Statistical fingerprinting; computes and compares table profiles |
| **Oracle** | `backend/oracle/inference.py` | Gemini 3.1 Pro inference; classifies drift type |
| **Lineage** | `backend/lineage/graph.py` | Parses dbt manifest; traces downstream blast radius |

---

## Tech stack

- **Brain:** Gemini 3.1 Pro via Vertex AI (Google Gen AI SDK)
- **Orchestration:** Google Cloud Agent Builder + Agent Development Kit (Python)
- **Partner integration:** Fivetran MCP server (official Python stdio server; `get_connection_schema_config` for read-only schema inspection, `modify_connection_table_config` for quarantine writes gated behind `FIVETRAN_ALLOW_WRITES=true`)
- **Data warehouse:** BigQuery (`tiresias-496915` project, `hubspot` dataset for raw tables, `tiresias_meta` for agent state)
- **Backend:** Python 3.11, FastAPI
- **Frontend:** Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui, React Flow, Framer Motion
- **Stats:** scipy/numpy — PSI, Z-score, schema delta
- **Lineage:** networkx + dbt Quickstart manifest.json

---

## Quick start

```bash
# 1. Clone and set up environment
git clone https://github.com/Amositua/Tiresias
cd Tiresias
# Create .env — required variables listed in infra/setup.sh and config/watched_tables.yaml
# GOOGLE_CLOUD_PROJECT, BIGQUERY_HUBSPOT_DATASET, FIVETRAN_*, HUBSPOT_ACCESS_TOKEN

# 2. Install dependencies
cd backend && pip install -r requirements.txt
cd ../frontend && npm install

# 3. Set up GCP resources
bash infra/setup.sh

# 4. Start everything
make dev
```

### Prerequisites

- Python 3.11+
- Node.js 18+
- Google Cloud SDK (`gcloud`) authenticated
- Fivetran account with HubSpot connector syncing to BigQuery
- Git Bash or WSL on Windows (Makefile uses bash syntax)

---

## Demo scenario

The demo uses a seeded HubSpot account with 100 deals across 7 pipeline stages. 18 deals in "Contract Sent" represent **$2.56M** in late-stage pipeline.

The silent failure: sales ops renames the stage "Contract Sent" → "Contract Under Review". Fivetran syncs. Nothing errors. Tiresias fires.

```bash
# Seed the demo state (run once after importing the CSV data to HubSpot)
python scripts/seed_demo.py

# Trigger the silent failure (uses real HubSpot API + Fivetran sync for the demo)
python scripts/trigger_failure.py --mode authentic
```

---

## Status

| Phase | Status | Notes |
|---|---|---|
| Phase 0: Scaffold | ✅ Done | Monorepo, Makefile, pre-commit, infra scripts |
| Phase 1: Memory | ✅ Done | PSI fingerprinting confirmed on real Fivetran data |
| Phase 2: Lineage | ✅ Done | dbt manifest graph, blast-radius tracing, 13/13 tests |
| Phase 3: Oracle | ✅ Done | gemini-3.1-pro-preview, structured output, SILENT_SEMANTIC_FAILURE at 0.95 confidence |
| Phase 4: Orchestrator + MCP | ✅ Done | Full pipeline verified end-to-end on real Fivetran infrastructure — see [docs/e2e_verification.md](docs/e2e_verification.md) |
| Phase 5: Frontend | ⏳ Pending | Next.js approval dashboard, React Flow graph |
| Phase 6: Demo polish | ⏳ Pending | |
| Phase 7: Submission | ⏳ Pending | |

**Phase 1 confirmed on real data (2026-05-23):**
- `hubspot.deal` — 100 rows, `contractsent` at 18% of deals, DriftReport clean (PSI 0.002)
- `hubspot.deal_pipeline_stage` — 7 rows, `label` uniform across all stages, DriftReport clean (PSI 0.0004)
- Schema delta empty on both tables — `config/watched_tables.yaml` column names match the live schema exactly
- Baseline locked: "Contract Sent" at 14.3% in `deal_pipeline_stage.label` — rename fires PSI ~2.1

**Phase 4 verified end-to-end on real Fivetran infrastructure (2026-05-26):**
- MCP schema check discovers `schema_name="hubspot"` dynamically from live API
- Oracle classifies SILENT_SEMANTIC_FAILURE at 0.95 confidence in ~31s with Gemini 3.1 Pro thinking
- `modify_connection_table_config` PATCH confirmed: `deal_pipeline_stage.enabled=false` in Fivetran
- Full pipeline — detect → reason → trace → approve → act — runs in ~42s end to end
- Two-gate write enforcement confirmed: `report_id` in `_pending` + `FIVETRAN_ALLOW_WRITES=true` subprocess
