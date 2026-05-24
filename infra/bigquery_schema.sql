-- tiresias-496915.tiresias_meta.tiresias_fingerprints
-- Stores one row per fingerprint computation.
-- Partitioned by date for cost-efficient retrieval; clustered by table identity.
--
-- column_fingerprints stores the full TableFingerprint as JSON.
-- schema_hash is a short SHA-256 prefix of sorted column name+type pairs —
-- allows cheap schema-change detection without parsing the full JSON blob.
--
-- is_synthetic = TRUE for dev-time seeded baselines only. These are scaffolding —
-- the same fingerprinting logic runs on real synced data. Never reference synthetic
-- fingerprints in the demo as if they were production history.

CREATE TABLE IF NOT EXISTS `tiresias-496915.tiresias_meta.tiresias_fingerprints`
(
  fingerprint_id       STRING    NOT NULL,
  connection_id        STRING    NOT NULL,
  project_id           STRING    NOT NULL,
  dataset_id           STRING    NOT NULL,
  table_name           STRING    NOT NULL,
  row_count            INT64     NOT NULL,
  computed_at          TIMESTAMP NOT NULL,
  schema_hash          STRING    NOT NULL,
  column_fingerprints  STRING    NOT NULL,  -- JSON-encoded TableFingerprint
  is_synthetic         BOOL      NOT NULL DEFAULT FALSE
)
PARTITION BY DATE(computed_at)
CLUSTER BY project_id, dataset_id, table_name;
