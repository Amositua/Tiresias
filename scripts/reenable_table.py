"""Re-enable a Fivetran table that was quarantined via modify_connection_table_config."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env", override=True)

from tiresias.mcp_client import FivetranMCPClient


async def reenable(connector_id: str, schema_name: str, table_name: str) -> None:
    key = os.environ["FIVETRAN_API_KEY"]
    secret = os.environ["FIVETRAN_API_SECRET"]
    client = FivetranMCPClient(key, secret)

    print(f"Re-enabling {schema_name}.{table_name} on connector {connector_id} ...")
    result = await client._call(
        "modify_connection_table_config",
        {
            "schema_file": "open-api-definitions/connections/modify_connection_table_config.json",
            "connection_id": connector_id,
            "schema_name": schema_name,
            "table_name": table_name,
            "request_body": json.dumps({"enabled": True}),
        },
        allow_writes=True,
    )
    print("Done.")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser()
    p.add_argument("--connector", default="wanderer_financing")
    p.add_argument("--schema", default="hubspot")
    p.add_argument("--table", default="deal_pipeline_stage")
    args = p.parse_args()

    asyncio.run(reenable(args.connector, args.schema, args.table))
