# HubSpot Seed Data — Import Instructions

Two files, imported in order. Contacts first, then deals.

## What's in the data

**200 contacts** across 12 fictitious companies (Meridian Systems, Vantage Platforms,
Horizon Networks, Bridgepoint Capital, Vertex Solutions, Nexus Group, Solaris Technologies,
Catalyst Analytics, Summit Enterprises, Apex Dynamics, Pinnacle Corp, Crestline Digital).
Lifecycle stages range from Lead through Customer, representing a realistic mid-size B2B pipeline.

**100 deals** across 7 pipeline stages:
| Stage | Count | Total Value |
|---|---|---|
| Appointment Scheduled | 15 | ~$928K |
| Qualified to Buy | 20 | ~$2.13M |
| Presentation Scheduled | 18 | ~$1.74M |
| Decision Maker Bought-In | 14 | ~$1.22M |
| **Contract Sent** | **18** | **$2,564,000** |
| Closed Won | 10 | ~$1.02M |
| Closed Lost | 5 | — |

The 18 "Contract Sent" deals are the critical baseline. When the demo's silent-failure
trigger renames this stage to "Contract Under Review", the downstream KPI
("Late Stage Pipeline Value") silently drops from $2.56M to $0.

---

## Step 1 — Import Contacts

1. In HubSpot, go to **Contacts** in the top nav.
2. Click **Import** (top-right button).
3. Select **Import a file** → **One file** → **One object** → **Contacts**.
4. Upload `hubspot_contacts_seed.csv`.
5. On the column mapping screen, HubSpot should auto-map most columns. Verify:
   - `First Name` → First name
   - `Last Name` → Last name
   - `Email` → Email
   - `Phone Number` → Phone number
   - `Company` → Company name
   - `Job Title` → Job title
   - `Lifecycle Stage` → Lifecycle stage
   - `Lead Status` → Lead status
   - `City` → City
   - `Country/Region` → Country/Region
6. On the **Import behavior** screen:
   - Check **"Create and update contacts"**
   - Check **"Don't import duplicates"** (safe default)
7. Click **Finish import**.

Wait for the import to complete (usually under 2 minutes for 200 rows). You'll get an
email confirmation from HubSpot.

**Troubleshooting:** If `Lifecycle Stage` values are rejected, HubSpot is case-sensitive
on import for some versions. Valid values are exactly: `Lead`, `Marketing Qualified Lead`,
`Sales Qualified Lead`, `Opportunity`, `Customer`. If your HubSpot account has custom
lifecycle stages, map to the closest standard stage.

---

## Step 2 — Verify the Default Sales Pipeline exists

Before importing deals, confirm HubSpot has a pipeline named exactly **"Sales Pipeline"**
with the stage **"Contract Sent"**.

1. Go to **Settings** (gear icon, top-right) → **Objects** → **Deals** → **Pipelines**.
2. You should see a default pipeline called "Sales Pipeline".
3. Confirm it has these stages (in order):
   - Appointment Scheduled
   - Qualified to Buy
   - Presentation Scheduled
   - Decision Maker Bought-In
   - **Contract Sent** ← critical for the demo
   - Closed Won
   - Closed Lost
4. If "Contract Sent" is missing or named differently on a fresh HubSpot trial, add it
   manually before importing deals. The stage name must match the CSV exactly.

---

## Step 3 — Import Deals

1. In HubSpot, go to **Deals** in the top nav (under CRM or Sales).
2. Click **Import** (top-right button).
3. Select **Import a file** → **One file** → **One object** → **Deals**.
4. Upload `hubspot_deals_seed.csv`.
5. On the column mapping screen, verify:
   - `Deal Name` → Deal name
   - `Amount` → Amount
   - `Close Date` → Close date
   - `Deal Stage` → Deal stage
   - `Pipeline` → Pipeline
6. **Important:** HubSpot will validate Deal Stage values against your pipeline.
   If any stage values fail validation, check Step 2 above.
7. Click **Finish import**.

---

## Step 4 — Verify after import

After both imports complete:

1. Go to **Deals** → **Board view**. You should see deals distributed across all 7 stages,
   with the **Contract Sent** column showing 18 deals.
2. Check the **Contract Sent** column total — it should sum to approximately **$2,564,000**.
   This is the figure that the demo's downstream KPI reports against.
3. Go to **Contacts** → confirm 200 contacts exist.

If the deal total looks wrong, go to **Reports** → create a simple deal amount by stage
report to verify the $2.56M Contract Sent figure before proceeding.

---

## Step 5 — Start the Fivetran sync

Once the data is verified in HubSpot:

1. Go to your Fivetran dashboard.
2. Find your HubSpot connector → click **Sync Now**.
3. Wait for the sync to complete (first sync may take a few minutes).
4. In BigQuery, confirm the `deal` table exists and has ~100 rows.
5. Confirm the `contact` table exists and has ~200 rows.
6. Run a quick sanity query:
   ```sql
   SELECT dealstage, COUNT(*) as deals, SUM(amount) as total_value
   FROM `tiresias-496915.hubspot.deal`
   GROUP BY dealstage
   ORDER BY total_value DESC;
   ```
   The `Contract Sent` row should show 18 deals and ~$2,564,000.

At this point, Tiresias's Memory agent has real data to fingerprint. Notify the dev
session that the connector is live and syncing.

---

## Demo reset procedure

To reset to this baseline state at any time (e.g., after running the silent-failure demo):
- Re-import both CSVs with **"Create and update"** selected. HubSpot will update
  existing records by email/deal name match rather than creating duplicates.
- Then trigger a Fivetran sync to propagate the reset to BigQuery.
- The reset script `scripts/seed_demo.py` automates the BigQuery side of this.

---

## Notes on the silent-failure trigger

The demo trigger (`scripts/trigger_failure.py`) renames the HubSpot deal stage
"Contract Sent" → "Contract Under Review" via the HubSpot API, then fires a Fivetran
sync. After the sync, Tiresias detects the PSI spike on the `dealstage` column.

**Option A (development convenience — never use in demo):** Directly updates BigQuery
rows to simulate the renamed stage. Fast, no HubSpot API call required, but is a
direct table edit — not a real Fivetran sync. Labeled `SIMULATION_MODE` in code.

**Option B (authentic demo path):** Renames the stage via HubSpot API → triggers
Fivetran sync → Tiresias detects via real webhook. This is the path to use in the
recorded demo. Requires `HUBSPOT_ACCESS_TOKEN` in `.env`.
