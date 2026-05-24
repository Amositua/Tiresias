# Fivetran MCP Server

Clone the upstream repo into this directory before running the orchestrator.

## Setup

```bash
git clone https://github.com/fivetran/fivetran-mcp .
cp .env.example .env
# Add FIVETRAN_API_KEY and FIVETRAN_API_SECRET
npm install
npm start
```

## Tools used by Tiresias

| Tool | When called |
|---|---|
| `list_connections` | Confirm connector is active |
| `get_connection_schema_config` | Inspect which columns/tables are syncing |
| `modify_connection_table_config` | Disable a bad column after human approval |
| `sync_connection` | Re-sync after fix is applied |
| `run_connection_setup_tests` | Validate connection after modification |
