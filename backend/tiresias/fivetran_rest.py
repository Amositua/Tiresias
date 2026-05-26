"""Fivetran REST client — dev-only fallback. Never used in the demo path."""

from __future__ import annotations

import json

import httpx


class FivetranRestClient:
    """
    Direct Fivetran REST API wrapper. Dev-only — use when the MCP server is not running.
    Set FIVETRAN_USE_REST_FALLBACK=true to enable. Never active during the demo.
    """

    _BASE = "https://api.fivetran.com"

    def __init__(self, api_key: str, api_secret: str) -> None:
        self._auth = (api_key, api_secret)

    async def get_schema_config(self, connection_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{self._BASE}/v1/connections/{connection_id}/schemas",
                auth=self._auth,
                timeout=30.0,
            )
            r.raise_for_status()
            return r.json()

    async def quarantine_table(
        self, connection_id: str, schema_name: str, table_name: str
    ) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.patch(
                f"{self._BASE}/v1/connections/{connection_id}/schemas/{schema_name}/tables/{table_name}",
                auth=self._auth,
                json={"enabled": False},
                timeout=30.0,
            )
            r.raise_for_status()
            return r.json()
