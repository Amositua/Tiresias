"""Statistical fingerprinting for Fivetran-synced BigQuery tables.

Computes column-level profiles (null rates, cardinality, value distributions, percentiles),
stores them in BigQuery, and compares against a rolling baseline to produce a DriftReport.

Drift detection: PSI for categorical/numeric columns, Z-score on row count, schema delta.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import numpy as np
from pydantic import BaseModel, Field

# Lazy import so PSI/entropy functions are testable without GCP credentials.
def _bq() -> Any:
    from google.cloud import bigquery  # noqa: PLC0415
    return bigquery

log = logging.getLogger(__name__)

_FIVETRAN_INTERNAL = frozenset(
    {"_fivetran_synced", "_fivetran_deleted", "_fivetran_id", "_fivetran_start",
     "_fivetran_end", "_fivetran_active"}
)

PSI_STABLE = 0.10
PSI_WATCH = 0.25


class ColumnFingerprint(BaseModel):
    name: str
    data_type: str
    null_pct: float
    distinct_count: int
    top_values: list[dict[str, Any]] = Field(default_factory=list)
    # Numeric-only fields
    min_val: float | None = None
    max_val: float | None = None
    mean: float | None = None
    stddev: float | None = None
    p1: float | None = None
    p25: float | None = None
    p50: float | None = None
    p75: float | None = None
    p99: float | None = None
    # Categorical-only fields
    entropy: float | None = None
    psi_distribution: dict[str, float] = Field(default_factory=dict)


class TableFingerprint(BaseModel):
    fingerprint_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    connection_id: str
    project_id: str
    dataset_id: str
    table_name: str
    row_count: int
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    schema_hash: str
    columns: list[ColumnFingerprint]
    is_synthetic: bool = False


class ColumnDrift(BaseModel):
    column_name: str
    drift_type: str
    psi_score: float | None = None
    current_value: float | str | None = None
    baseline_value: float | str | None = None
    is_anomalous: bool


class SchemaDelta(BaseModel):
    added: list[str] = Field(default_factory=list)
    removed: list[str] = Field(default_factory=list)
    type_changed: list[dict[str, str]] = Field(default_factory=list)


class DriftReport(BaseModel):
    report_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    connection_id: str
    project_id: str
    dataset_id: str
    table_name: str
    computed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    current_fingerprint: TableFingerprint
    baseline_fingerprint_count: int
    baseline_includes_synthetic: bool
    overall_drift_score: float
    max_psi_column: str | None
    max_psi_score: float
    row_count_z_score: float
    schema_delta: SchemaDelta
    column_drifts: list[ColumnDrift]
    is_anomalous: bool
    anomaly_reason: str | None = None
    max_psi_current_dist: dict[str, float] = Field(default_factory=dict)
    max_psi_baseline_dist: dict[str, float] = Field(default_factory=dict)


def compute_psi(
    current: dict[str, float],
    baseline: dict[str, float],
    epsilon: float = 0.001,
) -> float:
    """Population Stability Index: PSI < 0.10 stable, 0.10-0.25 watch, > 0.25 anomalous."""
    all_keys = set(current.keys()) | set(baseline.keys())
    psi = 0.0
    for key in all_keys:
        actual = max(current.get(key, 0.0), epsilon)
        expected = max(baseline.get(key, 0.0), epsilon)
        psi += (actual - expected) * math.log(actual / expected)
    return round(psi, 6)


def _average_distributions(fingerprints: list[TableFingerprint], column: str) -> dict[str, float]:
    all_keys: set[str] = set()
    dists: list[dict[str, float]] = []
    for fp in fingerprints:
        col = next((c for c in fp.columns if c.name == column), None)
        if col and col.psi_distribution:
            all_keys.update(col.psi_distribution.keys())
            dists.append(col.psi_distribution)
    if not dists:
        return {}
    averaged: dict[str, float] = {}
    for key in all_keys:
        averaged[key] = sum(d.get(key, 0.0) for d in dists) / len(dists)
    return averaged


def _row_count_zscore(current: int, baseline: list[TableFingerprint]) -> float:
    counts = [fp.row_count for fp in baseline]
    if len(counts) < 2:
        return 0.0
    mu = np.mean(counts)
    sigma = np.std(counts, ddof=1)
    if sigma == 0:
        return 0.0
    return float((current - mu) / sigma)


def _compute_entropy(dist: dict[str, float]) -> float:
    total = sum(dist.values())
    if total == 0:
        return 0.0
    entropy = 0.0
    for v in dist.values():
        p = v / total
        if p > 0:
            entropy -= p * math.log2(p)
    return round(entropy, 6)


def _schema_hash(columns: list[dict[str, str]]) -> str:
    payload = json.dumps(sorted(columns, key=lambda c: c["name"]), sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


class BigQueryFingerprinter:

    def __init__(
        self,
        client: Any,  # google.cloud.bigquery.Client — imported lazily
        project_id: str,
        meta_dataset: str = "tiresias_meta",
    ) -> None:
        self._client = client
        self._project = project_id
        self._meta = meta_dataset
        self._fingerprints_table = f"{project_id}.{meta_dataset}.tiresias_fingerprints"

    def _get_column_schema(self, dataset: str, table: str) -> list[dict[str, str]]:
        sql = f"""
            SELECT column_name, data_type
            FROM `{self._project}.{dataset}.INFORMATION_SCHEMA.COLUMNS`
            WHERE table_name = @table_name
            ORDER BY ordinal_position
        """
        bq = _bq()
        job_config = bq.QueryJobConfig(
            query_parameters=[bq.ScalarQueryParameter("table_name", "STRING", table)]
        )
        rows = list(self._client.query(sql, job_config=job_config).result())
        return [{"name": r.column_name, "data_type": r.data_type} for r in rows]

    def _categorize_columns(
        self,
        schema: list[dict[str, str]],
        profile_columns: list[str] | None,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        numeric_types = {"INT64", "FLOAT64", "NUMERIC", "BIGNUMERIC", "INTEGER", "FLOAT"}
        categorical_types = {"STRING", "BOOL", "BOOLEAN"}

        numerics, categoricals = [], []
        for col in schema:
            name = col["name"]
            dtype = col["data_type"].upper().split("(")[0]  # strip precision e.g. NUMERIC(18,2)

            # Skip Fivetran internals
            if name in _FIVETRAN_INTERNAL:
                continue
            if profile_columns and name not in profile_columns:
                continue
            if name == "id":
                continue

            if dtype in numeric_types:
                numerics.append(col)
            elif dtype in categorical_types:
                categoricals.append(col)
            # DATE/TIMESTAMP: skip for now

        return numerics, categoricals

    def _build_profile_query(
        self,
        dataset: str,
        table: str,
        numeric_cols: list[dict[str, str]],
        categorical_cols: list[dict[str, str]],
        all_column_names: set[str],
    ) -> str:
        fqt = f"`{self._project}.{dataset}.{table}`"
        parts = ["COUNT(*) AS _row_count"]

        for col in categorical_cols:
            n = col["name"]
            safe = f"`{n}`"
            alias = n.replace("-", "_").replace(".", "_")
            parts += [
                f"COUNTIF({safe} IS NULL) / NULLIF(COUNT(*), 0) AS {alias}__null_pct",
                f"APPROX_COUNT_DISTINCT({safe}) AS {alias}__distinct",
                f"APPROX_TOP_COUNT({safe}, 20) AS {alias}__top_values",
            ]

        for col in numeric_cols:
            n = col["name"]
            safe = f"`{n}`"
            cast = f"CAST({safe} AS FLOAT64)"
            alias = n.replace("-", "_").replace(".", "_")
            parts += [
                f"COUNTIF({safe} IS NULL) / NULLIF(COUNT(*), 0) AS {alias}__null_pct",
                f"APPROX_COUNT_DISTINCT({safe}) AS {alias}__distinct",
                f"MIN({cast}) AS {alias}__min",
                f"MAX({cast}) AS {alias}__max",
                f"AVG({cast}) AS {alias}__mean",
                f"STDDEV({cast}) AS {alias}__stddev",
                f"APPROX_QUANTILES({cast}, 100) AS {alias}__quantiles",
            ]

        select = ",\n  ".join(parts)
        if "_fivetran_deleted" in all_column_names:
            where = "WHERE (_fivetran_deleted IS NULL OR _fivetran_deleted = FALSE)"
        else:
            where = ""
        return f"SELECT\n  {select}\nFROM {fqt}\n{where}".rstrip()

    def compute_fingerprint(
        self,
        dataset: str,
        table: str,
        connection_id: str,
        profile_columns: list[str] | None = None,
        is_synthetic: bool = False,
    ) -> TableFingerprint:
        log.info("Computing fingerprint", dataset=dataset, table=table, synthetic=is_synthetic)

        schema = self._get_column_schema(dataset, table)
        all_column_names = {c["name"] for c in schema}
        numeric_cols, categorical_cols = self._categorize_columns(schema, profile_columns)

        if not numeric_cols and not categorical_cols:
            if profile_columns:
                missing = [c for c in profile_columns if c not in all_column_names]
                present = sorted(all_column_names - _FIVETRAN_INTERNAL)
                raise ValueError(
                    f"None of the configured profile_columns {profile_columns} exist in "
                    f"{dataset}.{table}.\n"
                    f"Missing columns: {missing}\n"
                    f"Actual columns available (excluding Fivetran internals): {present}\n"
                    "Update config/watched_tables.yaml profile_columns to match the real schema."
                )
            raise ValueError(
                f"No profilable columns found in {dataset}.{table} after applying skip rules. "
                "The table may contain only ID, timestamp, or Fivetran-internal columns."
            )

        if profile_columns:
            missing = [c for c in profile_columns if c not in all_column_names]
            if missing:
                log.warning(
                    "Some configured profile_columns not found in table schema — skipping them",
                    missing=missing,
                    dataset=dataset,
                    table=table,
                )

        sql = self._build_profile_query(
            dataset, table, numeric_cols, categorical_cols, all_column_names
        )
        log.debug("Profile query", sql=sql)
        rows = list(self._client.query(sql).result())
        assert len(rows) == 1, "Profile query must return exactly one row"
        row = rows[0]

        row_count = row["_row_count"]
        columns: list[ColumnFingerprint] = []

        for col in categorical_cols:
            n = col["name"]
            alias = n.replace("-", "_").replace(".", "_")
            null_pct = row[f"{alias}__null_pct"] or 0.0
            distinct = row[f"{alias}__distinct"] or 0
            raw_top = row[f"{alias}__top_values"] or []

            # raw_top is a list of STRUCT(value, count) from APPROX_TOP_COUNT
            top_values = []
            psi_dist: dict[str, float] = {}
            for item in raw_top:
                val = str(item["value"]) if item["value"] is not None else "__null__"
                cnt = item["count"]
                pct = cnt / row_count if row_count > 0 else 0.0
                top_values.append({"value": val, "count": cnt, "pct": round(pct, 6)})
                psi_dist[val] = pct

            columns.append(ColumnFingerprint(
                name=n,
                data_type=col["data_type"],
                null_pct=round(null_pct, 6),
                distinct_count=distinct,
                top_values=top_values,
                entropy=_compute_entropy(psi_dist),
                psi_distribution=psi_dist,
            ))

        for col in numeric_cols:
            n = col["name"]
            alias = n.replace("-", "_").replace(".", "_")
            null_pct = row[f"{alias}__null_pct"] or 0.0
            distinct = row[f"{alias}__distinct"] or 0
            quantiles = row[f"{alias}__quantiles"] or []

            columns.append(ColumnFingerprint(
                name=n,
                data_type=col["data_type"],
                null_pct=round(null_pct, 6),
                distinct_count=distinct,
                min_val=row[f"{alias}__min"],
                max_val=row[f"{alias}__max"],
                mean=row[f"{alias}__mean"],
                stddev=row[f"{alias}__stddev"],
                p1=quantiles[1] if len(quantiles) > 1 else None,
                p25=quantiles[25] if len(quantiles) > 25 else None,
                p50=quantiles[50] if len(quantiles) > 50 else None,
                p75=quantiles[75] if len(quantiles) > 75 else None,
                p99=quantiles[99] if len(quantiles) > 99 else None,
            ))

        s_hash = _schema_hash([{"name": c["name"], "data_type": c["data_type"]} for c in schema])

        return TableFingerprint(
            connection_id=connection_id,
            project_id=self._project,
            dataset_id=dataset,
            table_name=table,
            row_count=row_count,
            schema_hash=s_hash,
            columns=columns,
            is_synthetic=is_synthetic,
        )

    def store_fingerprint(self, fp: TableFingerprint) -> None:
        row = {
            "fingerprint_id": fp.fingerprint_id,
            "connection_id": fp.connection_id,
            "project_id": fp.project_id,
            "dataset_id": fp.dataset_id,
            "table_name": fp.table_name,
            "row_count": fp.row_count,
            "computed_at": fp.computed_at.isoformat(),
            "schema_hash": fp.schema_hash,
            "column_fingerprints": fp.model_dump_json(),
            "is_synthetic": fp.is_synthetic,
        }
        errors = self._client.insert_rows_json(self._fingerprints_table, [row])
        if errors:
            raise RuntimeError(f"Failed to store fingerprint: {errors}")
        log.info(
            "Fingerprint stored",
            fingerprint_id=fp.fingerprint_id,
            table=f"{fp.dataset_id}.{fp.table_name}",
            synthetic=fp.is_synthetic,
        )

    def get_recent_fingerprints(
        self,
        dataset: str,
        table: str,
        n: int = 7,
    ) -> list[TableFingerprint]:
        sql = f"""
            SELECT column_fingerprints, is_synthetic
            FROM `{self._fingerprints_table}`
            WHERE dataset_id = @dataset_id AND table_name = @table_name
            ORDER BY computed_at DESC
            LIMIT @n
        """
        bq = _bq()
        job_config = bq.QueryJobConfig(
            query_parameters=[
                bq.ScalarQueryParameter("dataset_id", "STRING", dataset),
                bq.ScalarQueryParameter("table_name", "STRING", table),
                bq.ScalarQueryParameter("n", "INT64", n),
            ]
        )
        rows = list(self._client.query(sql, job_config=job_config).result())
        result = []
        for r in rows:
            fp = TableFingerprint.model_validate_json(r["column_fingerprints"])
            result.append(fp)
        return result

    def get_risk_profile(
        self,
        dataset: str,
        table: str,
        n: int = 15,
        psi_threshold: float = PSI_WATCH,
    ) -> dict:
        """Return a risk profile for a table based on historical fingerprint patterns."""
        fingerprints = self.get_recent_fingerprints(dataset, table, n=n)
        if len(fingerprints) < 2:
            return {
                "table": table,
                "fingerprint_count": len(fingerprints),
                "anomaly_count": 0,
                "recent_anomaly_days": None,
                "max_psi": 0.0,
                "volatile_column": None,
                "avg_max_psi": 0.0,
                "sufficient_history": False,
            }

        # Most recent = index 0 (get_recent_fingerprints orders by DESC)
        # Compute PSI for most recent fingerprint against the rest as baseline
        current = fingerprints[0]
        baseline = fingerprints[1:]

        col_psi: dict[str, float] = {}
        for col in current.columns:
            if col.psi_distribution:
                base_dist = _average_distributions(baseline, col.name)
                if base_dist:
                    psi = compute_psi(col.psi_distribution, base_dist)
                    col_psi[col.name] = round(psi, 6)

        max_psi = max(col_psi.values(), default=0.0)
        volatile_col = max(col_psi, key=col_psi.get) if col_psi else None

        # Count how many of the baseline fingerprints showed anomalous PSI
        anomaly_count = 0
        last_anomaly_at = None
        for fp in baseline:
            for col in fp.columns:
                if col.psi_distribution:
                    base_for_fp = [
                        f for f in baseline if f.fingerprint_id != fp.fingerprint_id
                    ]
                    if base_for_fp:
                        d = _average_distributions(base_for_fp, col.name)
                        if d and compute_psi(col.psi_distribution, d) > psi_threshold:
                            anomaly_count += 1
                            if last_anomaly_at is None or fp.computed_at > last_anomaly_at:
                                last_anomaly_at = fp.computed_at
                            break

        from datetime import datetime, timezone as tz
        recent_anomaly_days: float | None = None
        if last_anomaly_at is not None:
            delta = datetime.now(tz.utc) - last_anomaly_at.replace(tzinfo=tz.utc)
            recent_anomaly_days = round(delta.total_seconds() / 86400, 1)

        avg_max_psi = round(
            sum(col_psi.values()) / len(col_psi) if col_psi else 0.0, 4
        )

        return {
            "table": table,
            "fingerprint_count": len(fingerprints),
            "anomaly_count": anomaly_count,
            "recent_anomaly_days": recent_anomaly_days,
            "max_psi": round(max_psi, 4),
            "volatile_column": volatile_col,
            "avg_max_psi": avg_max_psi,
            "sufficient_history": True,
        }

    def get_table_freshness(
        self,
        dataset: str,
        tables: list[str],
        stale_threshold_seconds: int = 21_600,  # 6 hours default
    ) -> list[dict]:
        """Return last-modified time for each table from BigQuery metadata."""
        import google.cloud.bigquery as bq

        placeholders = ", ".join(f"'{t}'" for t in tables)
        sql = f"""
            SELECT
                table_id,
                TIMESTAMP_MILLIS(last_modified_time) AS last_modified_at,
                row_count
            FROM `{self._project}.{dataset}.__TABLES__`
            WHERE table_id IN ({placeholders})
        """
        rows = list(self._client.query(sql).result())
        now = datetime.now(timezone.utc)
        by_table = {r["table_id"]: r for r in rows}

        result = []
        for table in tables:
            row = by_table.get(table)
            if row is None:
                result.append({
                    "table": table,
                    "last_modified_at": None,
                    "age_seconds": None,
                    "row_count": None,
                    "is_stale": False,
                    "threshold_seconds": stale_threshold_seconds,
                })
                continue
            last_mod = row["last_modified_at"]
            if last_mod is not None:
                last_mod = last_mod.replace(tzinfo=timezone.utc)
            age = round((now - last_mod).total_seconds()) if last_mod else None
            result.append({
                "table": table,
                "last_modified_at": last_mod.isoformat() if last_mod else None,
                "age_seconds": age,
                "row_count": row["row_count"],
                "is_stale": age is not None and age > stale_threshold_seconds,
                "threshold_seconds": stale_threshold_seconds,
            })
        return result

    def compare(
        self,
        current: TableFingerprint,
        baseline: list[TableFingerprint],
        psi_threshold: float = PSI_WATCH,
    ) -> DriftReport:
        if not baseline:
            raise ValueError("Cannot compare: no baseline fingerprints exist yet.")

        has_synthetic = any(fp.is_synthetic for fp in baseline)
        drifts: list[ColumnDrift] = []
        psi_scores: dict[str, float] = {}

        baseline_col_names: set[str] = set()
        for fp in baseline:
            for col in fp.columns:
                baseline_col_names.add(col.name)
        current_col_names = {c.name for c in current.columns}

        added = sorted(current_col_names - baseline_col_names)
        removed = sorted(baseline_col_names - current_col_names)

        for col in current.columns:
            baseline_cols = [
                c for fp in baseline for c in fp.columns if c.name == col.name
            ]
            if not baseline_cols:
                continue  # new column — captured in schema delta already

            if col.psi_distribution:
                baseline_dist = _average_distributions(baseline, col.name)
                psi = compute_psi(col.psi_distribution, baseline_dist)
                psi_scores[col.name] = psi
                drifts.append(ColumnDrift(
                    column_name=col.name,
                    drift_type="PSI_CATEGORICAL",
                    psi_score=psi,
                    current_value=str(col.psi_distribution),
                    baseline_value=str(baseline_dist),
                    is_anomalous=psi > psi_threshold,
                ))

            elif col.mean is not None:
                baseline_means = [c.mean for c in baseline_cols if c.mean is not None]
                baseline_stddevs = [c.stddev for c in baseline_cols if c.stddev is not None]
                if baseline_means:
                    mu = np.mean(baseline_means)
                    sigma = np.mean(baseline_stddevs) if baseline_stddevs else 0.0
                    z = abs((col.mean - mu) / sigma) if sigma else 0.0
                    # Convert Z-score to a PSI-comparable score (anomalous above 3σ)
                    normalised_score = min(z / 3.0, 2.0)
                    psi_scores[col.name] = normalised_score
                    drifts.append(ColumnDrift(
                        column_name=col.name,
                        drift_type="PSI_NUMERIC",
                        psi_score=normalised_score,
                        current_value=round(col.mean, 4),
                        baseline_value=round(float(mu), 4),
                        is_anomalous=z > 3.0,
                    ))

            baseline_null_pcts = [c.null_pct for c in baseline_cols]
            if baseline_null_pcts:
                avg_null = np.mean(baseline_null_pcts)
                null_delta = abs(col.null_pct - avg_null)
                if null_delta > 0.05:  # >5% absolute shift in null rate
                    drifts.append(ColumnDrift(
                        column_name=col.name,
                        drift_type="NULL_PCT_CHANGE",
                        psi_score=null_delta,
                        current_value=round(col.null_pct, 4),
                        baseline_value=round(float(avg_null), 4),
                        is_anomalous=null_delta > 0.10,
                    ))

        max_psi_col = max(psi_scores, key=psi_scores.get) if psi_scores else None
        max_psi = psi_scores[max_psi_col] if max_psi_col else 0.0
        overall = max_psi

        # Capture distributions for the max PSI column so the UI can show before/after
        max_psi_current_dist: dict[str, float] = {}
        max_psi_baseline_dist: dict[str, float] = {}
        if max_psi_col:
            col_fp = next((c for c in current.columns if c.name == max_psi_col), None)
            if col_fp and col_fp.psi_distribution:
                max_psi_current_dist = dict(col_fp.psi_distribution)
                max_psi_baseline_dist = _average_distributions(baseline, max_psi_col)

        rc_z = _row_count_zscore(current.row_count, baseline)

        is_anomalous = (
            overall > psi_threshold
            or abs(rc_z) > 3.0
            or bool(added)
            or bool(removed)
        )

        reason: str | None = None
        if is_anomalous:
            reasons = []
            if max_psi_col and psi_scores.get(max_psi_col, 0) > psi_threshold:
                reasons.append(
                    f"column '{max_psi_col}' PSI={psi_scores[max_psi_col]:.3f} "
                    f"(threshold {psi_threshold})"
                )
            if abs(rc_z) > 3.0:
                reasons.append(f"row count Z-score={rc_z:.2f}")
            if added:
                reasons.append(f"columns added: {added}")
            if removed:
                reasons.append(f"columns removed: {removed}")
            reason = "; ".join(reasons)

        return DriftReport(
            connection_id=current.connection_id,
            project_id=current.project_id,
            dataset_id=current.dataset_id,
            table_name=current.table_name,
            current_fingerprint=current,
            baseline_fingerprint_count=len(baseline),
            baseline_includes_synthetic=has_synthetic,
            overall_drift_score=round(overall, 6),
            max_psi_column=max_psi_col,
            max_psi_score=round(max_psi, 6),
            row_count_z_score=round(rc_z, 4),
            schema_delta=SchemaDelta(added=added, removed=removed),
            column_drifts=drifts,
            is_anomalous=is_anomalous,
            anomaly_reason=reason,
            max_psi_current_dist=max_psi_current_dist,
            max_psi_baseline_dist=max_psi_baseline_dist,
        )
