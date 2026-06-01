"""Fivetran MCP client — stdio transport, spawns the Fivetran MCP server as a subprocess."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

_SERVER_SCRIPT = (
    Path(__file__).parent.parent.parent / "mcp" / "server" / "server.py"
)

_SCHEMA_GET_CONFIG = "open-api-definitions/connections/connection_schema_config.json"
_SCHEMA_MODIFY_TABLE = "open-api-definitions/connections/modify_connection_table_config.json"


@runtime_checkable
class FivetranClient(Protocol):
    async def get_schema_config(self, connection_id: str) -> dict: ...
    async def quarantine_table(self, connection_id: str, schema_name: str, table_name: str) -> dict: ...


class FivetranMCPClient:
    """Production Fivetran client via the official Fivetran MCP server (stdio)."""

    def __init__(self, api_key: str, api_secret: str) -> None:
        self._key = api_key
        self._secret = api_secret

    def _server_params(self, allow_writes: bool) -> StdioServerParameters:
        env = {
            **os.environ,
            "FIVETRAN_API_KEY": self._key,
            "FIVETRAN_API_SECRET": self._secret,
        }
        if allow_writes:
            env["FIVETRAN_ALLOW_WRITES"] = "true"
        else:
            # Explicitly remove the flag even if it is set in the parent environment.
            # This is gate 2: write subprocess is ONLY created when allow_writes=True.
            env.pop("FIVETRAN_ALLOW_WRITES", None)
        return StdioServerParameters(
            command=sys.executable,
            args=[str(_SERVER_SCRIPT)],
            env=env,
        )

    async def _call(
        self,
        tool: str,
        arguments: dict[str, Any],
        allow_writes: bool = False,
    ) -> dict:
        async with stdio_client(self._server_params(allow_writes)) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                result = await session.call_tool(tool, arguments)

        text = result.content[0].text
        if text.startswith("Error:") or text.startswith("Fivetran API error:"):
            raise RuntimeError(f"MCP {tool!r} failed: {text}")
        return json.loads(text)

    async def get_schema_config(self, connection_id: str) -> dict:
        return await self._call(
            "get_connection_schema_config",
            {"schema_file": _SCHEMA_GET_CONFIG, "connection_id": connection_id},
            allow_writes=False,
        )

    async def quarantine_table(
        self, connection_id: str, schema_name: str, table_name: str
    ) -> dict:
        """Disable the table at the Fivetran source. Requires FIVETRAN_ALLOW_WRITES subprocess."""
        return await self._call(
            "modify_connection_table_config",
            {
                "schema_file": _SCHEMA_MODIFY_TABLE,
                "connection_id": connection_id,
                "schema_name": schema_name,
                "table_name": table_name,
                "request_body": json.dumps({"enabled": False}),
            },
            allow_writes=True,
        )

    async def reenable_table(
        self, connection_id: str, schema_name: str, table_name: str
    ) -> dict:
        """Re-enable a previously quarantined table. Requires FIVETRAN_ALLOW_WRITES subprocess."""
        return await self._call(
            "modify_connection_table_config",
            {
                "schema_file": _SCHEMA_MODIFY_TABLE,
                "connection_id": connection_id,
                "schema_name": schema_name,
                "table_name": table_name,
                "request_body": json.dumps({"enabled": True}),
            },
            allow_writes=True,
        )
