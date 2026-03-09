# Project Commander MCP Server Implementation Plan

## Goal
Implement Project Commander as a Model Context Protocol (MCP) server so MCP clients can discover projects, control runtime, read logs, and manage environment/port settings through standardized tools/resources.

## Current Baseline (Inference from code)
- Core runtime operations already exist in server runtime manager:
  - `toggleProjectRuntime`
  - `toggleServiceRuntime`
  - `getProjectRuntime`
  - `getProjectLogs`
  - `getProjectLaunchEnvironment`
  - `getProjectProcessStats`
  - `getProjectPortRangeSettings`
  - `setProjectPortRangeSettings`
- These are exposed today through GraphQL in:
  - `../packages/server/src/graphql/index.js`
- This strongly supports an adapter approach (MCP layer on top of existing service logic).

## Architecture
1. Add MCP server entrypoint in `packages/server` (no runtime rewrite).
2. Reuse existing runtime manager functions as MCP tool handlers.
3. Expose read-heavy state as MCP resources.
4. Keep GraphQL and MCP side-by-side initially.

## Recommended Transport Strategy
1. Phase 1: `stdio` transport (fastest path, local-first).
2. Phase 2: optional Streamable HTTP transport for remote/hosted clients.

## Capability Design
### Tools (initial set)
1. `list_projects`
2. `get_project_runtime`
3. `toggle_project_runtime`
4. `toggle_service_runtime`
5. `get_project_logs` (with `limit`, `afterId`, `serviceNames`)
6. `get_project_environment`
7. `get_project_process_stats`
8. `get_project_port_range_settings`
9. `set_project_port_range_settings`

### Resources (initial set)
1. `project://list`
2. `project://{projectPath}/runtime`
3. `project://{projectPath}/logs/latest`
4. `project://{projectPath}/environment`
5. `project://{projectPath}/process-stats`
6. `project://{projectPath}/port-range`

### Optional prompts
1. “Troubleshoot non-starting service”
2. “Summarize last N log errors”
3. “Prepare project runtime snapshot”

## Implementation Phases
## Phase 1: Core MCP Server (POC)
1. Add MCP dependencies and entrypoint (e.g., `packages/server/src/mcp/index.js`).
2. Implement server lifecycle and capability declarations.
3. Implement core tools using runtime manager methods.
4. Add basic argument validation and normalized errors.
5. Add npm/yarn scripts:
   - `server:mcp:stdio`

Acceptance criteria:
1. MCP inspector can connect via stdio.
2. All core tools execute and return structured outputs.
3. No regressions to existing GraphQL workflows.

## Phase 2: Resources + Runtime Events
1. Add resource handlers for runtime/log/env/process snapshots.
2. Bridge existing runtime events into MCP notifications where applicable.
3. Add stable pagination and payload bounds for logs/resources.

Acceptance criteria:
1. Resource reads work for all active projects.
2. Runtime status updates are observable by MCP clients.

## Phase 3: Hardened Deployment
1. Add Streamable HTTP transport option.
2. Add authentication/authorization for non-local deployments.
3. Add rate limits, payload limits, and safer error redaction.
4. Add docs for client registration examples.

Acceptance criteria:
1. Remote clients can connect securely.
2. Security controls are enabled by default for HTTP mode.

## Validation and Testing Plan
1. Unit tests for each tool handler (input validation + happy path + error path).
2. Integration tests against runtime manager with seeded projects/services.
3. Contract tests for MCP responses (shape and schema consistency).
4. Manual MCP Inspector smoke tests:
   - connect
   - call tools
   - read resources
   - observe updates

## Security and Safety Requirements
1. Restrict destructive actions to explicit tools only.
2. Validate `projectPath` inputs against known discovered projects.
3. Enforce max limits (`limit`, payload sizes, timeouts).
4. Redact sensitive values from environment outputs where required.
5. If HTTP transport is enabled, require auth and same-origin/CORS policy controls.

## Operational Requirements
1. Structured logs for all MCP calls (`tool`, `durationMs`, `status`, `projectPath`).
2. Feature flag for MCP enablement.
3. Configurable transport mode (`stdio` / `http`).
4. Health endpoint for HTTP mode.

## Rollout Plan
1. Week 1:
   - Phase 1 complete
   - internal usage via MCP Inspector and one target client
2. Week 2:
   - Phase 2 complete
   - broader team trial
3. Week 3+:
   - Phase 3 hardening
   - documentation + release

## Risks and Mitigations
1. Risk: runtime side effects from concurrent control calls.
   - Mitigation: serialize mutations per project path.
2. Risk: large log payloads.
   - Mitigation: strict limit defaults and truncation markers.
3. Risk: duplicate business logic between GraphQL and MCP.
   - Mitigation: keep runtime manager as single source of truth.

## Estimated Effort
1. POC (stdio + core tools): 1-2 days.
2. Production-ready (resources, events, HTTP, security, tests): 1-2 weeks.

## Deliverables
1. MCP server code in `packages/server`.
2. Scripts and run instructions.
3. Tool/resource contract documentation.
4. Automated test coverage for tool/resource handlers.
