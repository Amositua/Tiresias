# End-to-End Verification — Live Run Against Real Fivetran Account

**Date:** 2026-05-26  
**Connector:** `wanderer_financing` (HubSpot → BigQuery)  
**Script:** `scripts/run_e2e.py --auto-approve`

This is the timestamped execution log from the first confirmed end-to-end run of the full
detect → reason → trace → approve → act pipeline against live Fivetran infrastructure.
`--auto-approve` was used to bypass the interactive stdin gate (CLI limitation in a background
process); the `/approvals/{report_id}` HTTP endpoint that the Phase 5 dashboard calls is the
genuine human-in-the-loop path used in the demo.

---

## Execution log

```
STEP 1  04:54:53  sync_received
        connector_id = wanderer_financing
        table = hubspot.deal_pipeline_stage
        [simulated webhook — DriftReport injected directly, no BigQuery required]

STEP 2  04:54:59  schema_check
        MCP tool: get_connection_schema_config (read-only, no FIVETRAN_ALLOW_WRITES)
        Result: fivetran_schema = "hubspot"  (discovered dynamically from API response)

        04:55:30  oracle_verdict
        classification = SILENT_SEMANTIC_FAILURE
        confidence     = 0.95
        reasoning:
          "The column 'label' exhibits a classic rename pattern: the value 'Contract Sent'
           completely disappeared (14.29% to 0%) while a new value 'Contract Under Review'
           appeared with the exact same frequency (0% to 14.29%). This semantic change in a
           lookup table will likely cause silent failures in downstream models relying on
           hardcoded string matching."
        affected_columns: ["label"]
        blast_radius:
          "Critical downstream impact on stg_deals and fct_pipeline_by_stage, which feeds the
           late_stage_pipeline_dashboard owned by the VP of Sales."

        pending_approval logged
        report_id = e1a095f9-31a2-47bd-96ba-43e66a22667b
        proposed_fix:
          "Quarantine deal_pipeline_stage at Fivetran source (enabled=false on schema 'hubspot').
           No future syncs of this table will reach BigQuery until re-enabled.
           Engineer fix: Update downstream dbt models (stg_deals, fct_pipeline_by_stage) and
           the late_stage_pipeline_dashboard to replace 'Contract Sent' with 'Contract Under Review'."

STEP 3  human approval gate
        report_id: e1a095f9-31a2-47bd-96ba-43e66a22667b
        [--auto-approve] Approving automatically.

STEP 4  04:55:35  quarantine_executed
        mcp_tool              = modify_connection_table_config
        connection_id         = wanderer_financing
        schema_name           = hubspot
        table_name            = deal_pipeline_stage
        enabled               = false
        oracle_classification = SILENT_SEMANTIC_FAILURE
        oracle_confidence     = 0.95
        report_id             = e1a095f9-31a2-47bd-96ba-43e66a22667b

        Fivetran API confirmed: deal_pipeline_stage.enabled = false

STEP 5  audit log
        All fields recorded via structlog:
        report_id, mcp_tool, schema_name, table_name, enabled=false,
        oracle_classification, oracle_confidence, timestamp

RE-ENABLE (cleanup)
        PATCH /v1/connections/wanderer_financing/schemas/hubspot/tables/deal_pipeline_stage
        {"enabled": true}  → code: Success
        Verified GET: deal_pipeline_stage.enabled = true  ✓
```

---

## What was confirmed

| Check | Result |
|---|---|
| MCP schema check (read-only) executes against real Fivetran | ✓ |
| Schema name `"hubspot"` discovered dynamically at runtime | ✓ |
| Oracle reaches SILENT_SEMANTIC_FAILURE with 0.95 confidence | ✓ |
| Blast radius traces to VP of Sales dashboard | ✓ |
| Gate 1: `report_id` in `_pending` required before write | ✓ |
| Gate 2: `FIVETRAN_ALLOW_WRITES=true` subprocess required for write | ✓ |
| `modify_connection_table_config` PATCH executed against live API | ✓ |
| Fivetran confirmed `deal_pipeline_stage.enabled = false` | ✓ |
| Table re-enabled to clean state after test | ✓ |
| Entire pipeline completes in ~42 seconds end to end | ✓ |

---

## Timing breakdown

| Step | Wall time | Description |
|---|---|---|
| schema_check | ~6s | MCP stdio subprocess spawn + GET /schemas |
| oracle_verdict | ~31s | Gemini 3.1 Pro with thinking (1024 budget) |
| quarantine_executed | ~5s | MCP stdio subprocess spawn + PATCH |
| **Total** | **~42s** | From webhook to audit log |
