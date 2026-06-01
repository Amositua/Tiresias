"""GitHub API client — creates fix branches, commits corrected dbt SQL, opens PRs."""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any


class GitHubClient:
    _BASE = "https://api.github.com"

    def __init__(self, token: str, repo: str) -> None:
        self._token = token
        self._repo = repo  # e.g. "Amositua/Tiresias"

    # ── HTTP ──────────────────────────────────────────────────────────────────

    def _req(self, method: str, path: str, body: dict | None = None) -> Any:
        url = f"{self._BASE}{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            url,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self._token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
                "User-Agent": "Tiresias-Agent/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as exc:
            msg = exc.read().decode(errors="replace")
            raise RuntimeError(f"GitHub {method} {path} → {exc.code}: {msg}") from exc

    # ── Repo helpers ──────────────────────────────────────────────────────────

    def _default_branch_sha(self) -> tuple[str, str]:
        """Return (branch_name, latest_commit_sha)."""
        repo = self._req("GET", f"/repos/{self._repo}")
        branch = repo["default_branch"]
        ref = self._req("GET", f"/repos/{self._repo}/git/ref/heads/{branch}")
        return branch, ref["object"]["sha"]

    def _create_branch(self, name: str, sha: str) -> None:
        self._req("POST", f"/repos/{self._repo}/git/refs", {
            "ref": f"refs/heads/{name}",
            "sha": sha,
        })

    def _get_file(self, path: str, branch: str) -> tuple[str, str]:
        """Return (decoded_content, blob_sha)."""
        info = self._req("GET", f"/repos/{self._repo}/contents/{path}?ref={branch}")
        content = base64.b64decode(info["content"]).decode()
        return content, info["sha"]

    def _update_file(
        self,
        path: str,
        content: str,
        message: str,
        sha: str,
        branch: str,
    ) -> None:
        self._req("PUT", f"/repos/{self._repo}/contents/{path}", {
            "message": message,
            "content": base64.b64encode(content.encode()).decode(),
            "sha": sha,
            "branch": branch,
        })

    def _open_pr(self, title: str, body: str, head: str, base: str) -> dict:
        return self._req("POST", f"/repos/{self._repo}/pulls", {
            "title": title,
            "body": body,
            "head": head,
            "base": base,
        })

    # ── Public API ────────────────────────────────────────────────────────────

    def create_fix_pr(
        self,
        fixes: list[Any],  # list[FixSuggestion]
        report_id: str,
        table: str,
        column: str,
        reasoning: str,
    ) -> dict:
        """
        Create a branch, apply every fix to the corresponding dbt SQL file,
        and open a pull request.  Returns {pr_url, pr_number, branch}.
        """
        ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        branch = f"tiresias/fix-{table}-{column}-{ts}"

        default_branch, sha = self._default_branch_sha()
        self._create_branch(branch, sha)

        committed: list[str] = []
        for fix in fixes:
            file_path = f"dbt/models/staging/{fix.model_name}.sql"
            try:
                current, file_sha = self._get_file(file_path, default_branch)
                # Apply the fix: replace the broken snippet with the corrected one
                fixed_content = current.replace(
                    fix.original_snippet, fix.fixed_snippet
                )
                if fixed_content == current:
                    # Snippet not found verbatim — write the full fixed file directly
                    fixed_content = fix.fixed_snippet
                self._update_file(
                    path=file_path,
                    content=fixed_content,
                    message=(
                        f"fix({fix.model_name}): use stable stage_id "
                        f"instead of mutable label — Tiresias {report_id[:8]}"
                    ),
                    sha=file_sha,
                    branch=branch,
                )
                committed.append(fix.model_name)
            except Exception as exc:
                # File doesn't exist yet — skip without failing the PR
                import structlog
                structlog.get_logger(__name__).warning(
                    "github_fix_file_skip", model=fix.model_name, error=str(exc)
                )

        pr_body = _build_pr_body(fixes, report_id, table, column, reasoning)
        pr = self._open_pr(
            title=f"fix({table}): replace mutable label filter with stable stage_id — Tiresias auto-fix",
            body=pr_body,
            head=branch,
            base=default_branch,
        )
        return {
            "pr_url": pr["html_url"],
            "pr_number": pr["number"],
            "branch": branch,
            "committed_models": committed,
        }

    def get_pr_state(self, pr_number: int) -> dict:
        """Return {state, merged, merged_at, html_url}."""
        pr = self._req("GET", f"/repos/{self._repo}/pulls/{pr_number}")
        return {
            "state": pr["state"],
            "merged": pr.get("merged", False),
            "merged_at": pr.get("merged_at"),
            "html_url": pr["html_url"],
        }


# ── PR body ────────────────────────────────────────────────────────────────

def _build_pr_body(
    fixes: list[Any],
    report_id: str,
    table: str,
    column: str,
    reasoning: str,
) -> str:
    fix_blocks = "\n\n".join(
        f"### `{f.model_name}.sql`\n\n"
        f"**Before** (breaks on every label rename):\n```sql\n{f.original_snippet}\n```\n\n"
        f"**After** (stable, rename-proof):\n```sql\n{f.fixed_snippet}\n```\n\n"
        f"_{f.explanation}_"
        for f in fixes
    )

    return f"""## Tiresias Auto-Fix · `{report_id[:8]}`

### What was detected

**Table:** `{table}` · **Column:** `{column}`

> {reasoning}

### Why the filter was broken

`label` is a user-editable display string in HubSpot. Any CRM admin can rename a pipeline
stage from a dropdown. `stage_id` is the permanent system identifier that never changes
regardless of what the stage is called.

### Changes in this PR

{fix_blocks}

### After merging

Tiresias will **automatically re-enable** `{table}` in Fivetran once this PR is merged.
The next sync will flow through the fixed model and the VP pipeline dashboard will recover.

---
*Generated automatically by [Tiresias](https://github.com/{{}}) · pre-cognitive data quality agent*
*Do not modify the SQL manually — accept or reject this PR as-is.*
"""
