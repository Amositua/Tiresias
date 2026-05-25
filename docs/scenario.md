# The Demo Scenario: Silent Pipeline Break via Dimension Table Rename

## The one-sentence version

A sales rep renames a deal stage in HubSpot's UI. Every Fivetran sync succeeds. Every dbt
model runs clean. The VP of Sales's "Late Stage Pipeline" dashboard silently drops to $0.
Tiresias catches it in seconds. Nobody else does.

---

## Why this is a silent failure

Most pipeline monitoring watches for:
- Sync errors (none — Fivetran syncs the rename successfully)
- Schema changes (none — the column `deal_pipeline_stage_id` still exists with the same type)
- Row count drops (none — all 100 deals are still there)
- dbt test failures (none — no uniqueness, not-null, or accepted-values test covers the label)

What breaks is **semantic**: a string literal in a downstream query no longer matches any
row in the dimension table. The query returns an empty result set instead of an error.
No alert fires. The dashboard shows $0, which looks like a business problem, not a data problem.

---

## The exact trigger

In HubSpot: **Settings → Sales → Deals → Pipeline → edit the "Sales Pipeline" →
rename the "Contract Sent" stage to "Contract Under Review".**

One click. Takes three seconds.

What Fivetran syncs on the next scheduled run (or forced sync):

```
hubspot.deal_pipeline_stage BEFORE rename:
  stage_id        │ label
  ────────────────┼──────────────────────────
  contractsent    │ Contract Sent        ← this row
  qualifiedtobuy  │ Qualified To Buy
  ...

hubspot.deal_pipeline_stage AFTER rename:
  stage_id        │ label
  ────────────────┼──────────────────────────
  contractsent    │ Contract Under Review  ← label changed; ID unchanged
  qualifiedtobuy  │ Qualified To Buy
  ...
```

The `deal` table is **completely unchanged**:
- `deal_pipeline_stage_id` still contains `"contractsent"` for all 18 deals
- `property_amount` unchanged — $2,564,000 in that bucket
- Row count unchanged — 100 deals total

---

## The downstream query that breaks

```sql
-- This query powers the "Late Stage Pipeline" KPI on the VP of Sales dashboard.
-- It looks correct. It has no syntax error. It will run successfully.
-- After the rename it returns $0.

SELECT
    SUM(d.property_amount)          AS late_stage_pipeline_value,
    COUNT(*)                        AS deal_count
FROM
    hubspot.deal d
    JOIN hubspot.deal_pipeline_stage s
        ON d.deal_pipeline_stage_id = s.stage_id
WHERE
    s.label = 'Contract Sent'       -- ← string literal, now matches zero rows
    AND d.property_closedate >= CURRENT_DATE()
```

Before rename: **$2,564,000** across 18 deals.
After rename: **$0**, 0 deals. No error. No warning.

---

## The signal Tiresias detects

**Table:** `hubspot.deal_pipeline_stage` (7 rows — a dimension/lookup table)
**Column:** `label` (STRING, categorical)

Memory's fingerprint comparison:

| Metric | Value |
|--------|-------|
| PSI on `label` column | ~2.1 (threshold: 0.25 → **8× above threshold**) |
| `"Contract Sent"` in baseline distribution | ~14.3% (1 of 7) |
| `"Contract Sent"` in current distribution | 0% (absent) |
| `"Contract Under Review"` in baseline | 0% (absent) |
| `"Contract Under Review"` in current | ~14.3% (1 of 7) |
| Cardinality | 7 → 7 (unchanged — not a schema error) |
| `hubspot.deal` anomaly | **None** — stage IDs are stable |

This is the key insight for the demo narrative: **the fact table is clean, the dimension table is
not.** Standard monitoring watches the fact table. Tiresias watches both, and crucially watches
the semantic content of the dimension table — not just its schema.

---

## Oracle's classification

Oracle receives the DriftReport (PSI=2.1 on `label`) and the blast radius from Lineage, then
prompts Gemini 3.1 Pro with structured output to classify the drift:

```
Classification:  SILENT_SEMANTIC_FAILURE
Confidence:      0.94

Reasoning:
  The value "Contract Sent" appeared in 100% of the established baseline fingerprints
  (N=5) at ~14.3% frequency and is now absent. The value "Contract Under Review"
  has appeared for the first time at matching frequency. This is the signature of a
  categorical label rename, not organic data change.

  Critically, the fact table (hubspot.deal) shows no anomaly: deal_pipeline_stage_id
  still contains "contractsent" for 18 deals representing $2,564,000. The semantic break
  is in the dimension table: any downstream query joining on label = 'Contract Sent'
  will silently return an empty result set.

Affected columns:   [deal_pipeline_stage.label]
Blast radius:       hubspot.deal_pipeline_stage
                    → stg_deals (via JOIN on label)
                    → fct_pipeline_by_stage
                    → "Late Stage Pipeline Value" dashboard
                    → VP of Sales

Recommended action: Add a value mapping in the dbt staging model to normalise
                    historical label names, or update the downstream filter to use
                    stage_id = 'contractsent' instead of a label string literal.
```

---

## The Tiresias fix proposal

Tiresias does **not** execute anything without human approval. It posts a fix proposal to
the dashboard:

> **Proposed fix:** Sync the connection to confirm current state, then update the
> downstream `stg_deals` dbt model to filter on `stage_id = 'contractsent'` rather
> than `label = 'Contract Sent'`. This makes the pipeline resilient to future label
> renames. No Fivetran column needs to be disabled.

Human clicks **Approve** → Tiresias calls:
1. `get_connection_schema_config` — confirms `deal_pipeline_stage.label` is syncing
2. `sync_connection` — forces a clean sync to confirm current state
3. Logs the decision with full audit trail

---

## Why this scenario was chosen for the demo

1. **Single-click trigger.** One HubSpot UI rename. Reproducible in 3 seconds.
2. **Authentic end-to-end.** Real HubSpot data → real Fivetran sync → real BigQuery →
   real PSI computation → real Gemini reasoning. Nothing is mocked in the demo path.
3. **The fact table is innocent.** The most surprising part of the demo: `hubspot.deal`
   shows no anomaly whatsoever. The damage is entirely in a 7-row lookup table that
   nobody thinks to monitor.
4. **PSI is dramatic.** A PSI of 2.1 on a 7-row uniform distribution is unmistakable —
   no tuning, no threshold games, no false positive risk.
5. **Business framing is crisp.** $2.56M in late-stage pipeline silently becomes $0.
   Every executive in the room immediately understands the stakes.

---

## Reset instructions

To return to the pre-rename state for another demo run:

```bash
# Authentic reset (recommended for consecutive demo runs)
# In HubSpot: Settings → Sales → Deals → Pipeline → rename "Contract Under Review" back to "Contract Sent"
# Then trigger a Fivetran sync:
python scripts/trigger_failure.py --mode reset --reset-mode authentic

# Fast reset for development (direct BigQuery edit — do not use in demo)
python scripts/trigger_failure.py --mode reset --reset-mode simulation
```

