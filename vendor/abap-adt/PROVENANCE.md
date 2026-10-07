# Bundled ABAP ADT MCP runtime

Captured 2026-10-03 from the user's reviewed local installation:
`C:/Users/fanrh/AppData/Local/CodexMCP/mcp-abap-abap-adt-api`.

Upstream identity: https://github.com/mario-andreschak/mcp-abap-abap-adt-api, package version 0.1.1, MIT license (see LICENSE).

This is the local reviewed build, including local changes described in UPSTREAM.md; it is not represented as an unchanged public npm release. Compiled dist files were copied unchanged. No SAP profile, credentials, logs, or developer node_modules were copied. Compiled-file SHA-256 values are recorded in runtime-manifest.json.

Dependencies are installed from this directory's package-lock.json via `npm ci --omit=dev --ignore-scripts`. A narrowly scoped lockfile update moved transitive axios to 1.20.0 to address the audit findings reported by the registry; the runtime production dependency audit then reported zero vulnerabilities. The source installation and its dependencies were not modified.

The workbench launches `dist/index.js` with its own Node executable and per-call SAP environment. It defaults to this bundled location; SAP_MCP_ENTRY is an optional deployment override. There is no browser-facing MCP configuration or HTTP MCP listener.

Runtime prerequisite: Node ^22.22.2 or ^24.15.0. The tested workbench runtime is Node 24.19.0.
