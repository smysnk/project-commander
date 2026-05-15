# Project Commander MCP Server Capability Routes

## Purpose
This document describes how Project Commander can become MCP server capable against the current architecture, not the earlier local-only runtime shape.

The goal is not just "expose some tools". The goal is to expose the control plane that already exists in Project Commander in a way that MCP clients can safely use:

- discover projects and hosts
- inspect runtime, logs, telemetry, and desired-process state
- control project/service/process lifecycle
- use terminal and checkout workflows where they fit MCP's execution model

## Current Architecture Inventory

### Node backend (`packages/server`)
This is the current control-plane seam with the most complete surface area.

Relevant files:

- `packages/server/src/index.js`
- `packages/server/src/graphql/index.js`
- `packages/server/src/runtime/backends/goMasterRuntimeBackend.js`
- `packages/server/src/runtime/processRegistry.js`
- `packages/server/src/terminalSessionManager.js`
- `packages/server/src/projectCatalog.js`
- `packages/server/src/hostCatalog.js`
- `packages/server/src/hostDeployment.js`

What it already does:

- owns the HTTP server lifecycle
- exposes GraphQL queries and mutations for projects, hosts, runtime, terminals, and runtime registry
- already has a WebSocket event stream and event buffer
- persists desired processes, observed runs, host runtime state, and process runtime state
- brokers to the Go master agent
- manages deployment flows and terminal session orchestration

### Master agent (`packages/agent-master`)
This is the execution-plane coordinator.

Relevant files:

- `packages/agent-master/internal/master/server.go`
- `packages/agent-master/internal/master/runtime_control.go`
- `packages/agent-master/internal/master/slave_registry.go`
- `packages/agent-master/internal/master/slave_runtime_registry.go`
- `packages/agent-master/internal/master/slave_logs.go`
- `packages/agent-master/internal/master/slave_process_logs.go`
- `packages/agent-master/internal/master/events_stream.go`

What it already does:

- exposes gRPC APIs for runtime control and master metadata
- tracks registered slave agents
- stores in-memory desired-process mirrors and slave runtime state
- emits runtime and slave events
- serves slave log and process-log access

### Slave agent (`packages/agent-slave`)
This is the host-local executor.

Relevant files:

- `packages/agent-slave/cmd/pc-slave/main.go`
- `packages/agent-slave/cmd/pc-slave/process_manager.go`
- `packages/agent-slave/cmd/pc-slave/process_log_shipper.go`
- `packages/agent-slave/cmd/pc-slave/discovery_reporting.go`
- `packages/agent-slave/cmd/pc-slave/telemetry_sampler.go`
- `packages/agent-slave/cmd/pc-slave/checkout.go`

What it already does:

- reconciles desired processes against actual host processes
- launches managed processes and writes logs to per-process log files
- reports discovered projects, heartbeats, telemetry, and reconciliation back through the master
- executes checkout and kill flows

## What MCP Should Mean For This Project
For Project Commander, MCP should expose the control plane, not the internal implementation layers.

That means:

- MCP clients should not need to know about GraphQL, WebSocket message formats, or gRPC details.
- MCP clients should interact with stable tools, resources, and prompts that map onto the existing control-plane concepts:
  - projects
  - hosts
  - desired processes
  - observed runs
  - logs
  - terminal sessions

## MCP Constraints That Matter Here
The current MCP spec defines tools, resources, and prompts, over JSON-RPC, using `stdio` or Streamable HTTP transports. Resources can optionally support subscriptions, and tools should be human-mediated for sensitive actions. This materially affects the design here.

Implications for Project Commander:

1. The current `/ws` protocol is not MCP transport.
   - It can still be reused internally as an event source.
   - Externally, the MCP surface should use `stdio` or Streamable HTTP only.

2. Destructive actions need explicit tool boundaries.
   - Starting/stopping services, deploying hosts, killing processes, editing desired processes, and sending terminal input should all be separate tools.

3. High-volume data should prefer resources over oversized tool payloads.
   - logs
   - runtime snapshots
   - host and process telemetry
   - project/service metadata

4. Fully interactive PTY behavior is not a first-class MCP primitive.
   - Terminal support needs to be modeled as a session resource plus session tools, not as a raw duplex TTY stream.

## Route 1: Node Backend As The MCP Server
This is the recommended route.

### Why this is the best fit
The Node backend already aggregates all of the following in one place:

- persisted data
- host and project catalogs
- runtime registry
- terminal session orchestration
- deployment workflows
- master/slave coordination
- log query routing

That makes it the cleanest place to expose an MCP facade without rewriting the control plane.

### Implementation shape
Add a new MCP module in `packages/server`, for example:

- `packages/server/src/mcp/server.js`
- `packages/server/src/mcp/tools/*.js`
- `packages/server/src/mcp/resources/*.js`
- `packages/server/src/mcp/prompts/*.js`

Use the official TypeScript/JavaScript MCP SDK:

- package: `@modelcontextprotocol/sdk`

Even though `packages/server` is plain CommonJS JavaScript today, that is not a blocker. The MCP facade can be:

- a small ESM island under `src/mcp`
- or a separate package if the module-boundary friction becomes annoying

### What Route 1 can expose cleanly

#### Tools
Read/write actions that already exist or are close to existing logic:

- `projects.list`
- `project.runtime.get`
- `project.runtime.start`
- `project.runtime.stop`
- `project.service.start`
- `project.service.stop`
- `project.port_range.get`
- `project.port_range.set`
- `hosts.list`
- `host.add`
- `host.delete`
- `host.deploy_slave`
- `host.upgrade_slave`
- `host.checkout_project`
- `runtime.desired_process.ensure`
- `runtime.desired_process.delete`
- `runtime.process.soft_kill`
- `runtime.process.hard_kill`
- `terminal.session.start`
- `terminal.session.send_input`
- `terminal.session.close`

#### Resources
Read-heavy state and tail-style data:

- `pc://projects`
- `pc://projects/{projectId}`
- `pc://projects/{projectId}/runtime`
- `pc://projects/{projectId}/services`
- `pc://hosts`
- `pc://hosts/{hostId}`
- `pc://hosts/{hostId}/runtime`
- `pc://hosts/{hostId}/desired-processes`
- `pc://hosts/{hostId}/observed-runs`
- `pc://process-runs/{runId}`
- `pc://process-runs/{runId}/telemetry`
- `pc://process-runs/{runId}/log`
- `pc://terminal-sessions/{sessionId}`

Resource templates are a strong fit for paged/tail data:

- `pc://logs/{scope}?cursor={cursor}&limit={limit}`
- `pc://process-runs/{runId}/log?cursor={cursor}&limit={limit}`

#### Prompts
These are optional. They should not block the initial implementation.

Good candidates later:

- `summarize-host-health`
- `summarize-runtime-failure`
- `prepare-process-reconciliation-report`
- `prepare-deployment-debug-summary`

### Advantages

- lowest duplication of business logic
- can reuse current server auth and deployment policy decisions
- cleanest place to mix persisted state and live runtime state
- best fit for Streamable HTTP later
- easiest path to expose both local and remote control-plane features

### Weaknesses

- Node backend becomes one more public protocol surface to harden
- there is still an adapter layer to maintain between GraphQL/runtime objects and MCP schemas
- terminal interaction must be modeled carefully to avoid pretending MCP is a shell protocol

## Route 2: Master Agent As The MCP Server
This is plausible, but not the best primary route.

### Implementation shape
Add MCP support directly in `packages/agent-master` using the official Go SDK:

- package: `github.com/modelcontextprotocol/go-sdk/mcp`

Expose the current master state directly as tools/resources.

### Where this route is strong

- runtime control is already centered in the master
- slave runtime state, slave logs, and process logs already flow through the master
- Go is a good fit for a long-running MCP server, especially over `stdio` or Streamable HTTP

### Gaps and costs

- the master does not own the persisted Sequelize data model
- manual hosts, host metadata, directory metadata, and database-backed desired-process definitions originate in the Node layer
- terminal session orchestration is currently implemented in Node, not the master
- deployment and password-prompt workflows are Node-driven
- this route either duplicates control-plane concerns in Go or forces the Node backend to remain a hidden dependency anyway

### Bottom line
This route is good for a low-level runtime MCP surface, but poor as the primary public control-plane MCP surface.

## Route 3: Dual MCP Surfaces
This means:

- Node backend exposes the high-level control-plane MCP server
- master agent exposes a lower-level execution-plane MCP server

Possible split:

- Node MCP: projects, hosts, deployment, desired processes, terminal sessions, coarse logs
- Master MCP: runtime snapshots, slave state, process logs, process telemetry, low-level kill/reconciliation operations

### Advantages

- clean separation of operational domains
- useful if power users want direct execution-plane access without the full app stack
- allows incremental hardening of each surface independently

### Costs

- duplicated capability naming and policy decisions
- clients must choose which MCP server to trust/use
- versioning becomes harder
- the Node server may still need to federate master data, which weakens the benefit

### Bottom line
This is a viable future shape, but too much surface area for the first implementation.

## Route 4: Per-Slave MCP Servers
Each slave host would expose its own MCP server, either embedded in the slave or as a sibling process.

### Why people consider this

- direct host-local control
- direct project filesystem access
- reduced hop count for logs and process control

### Why this is the wrong default here

- it fights the current master/slave control topology
- every host becomes another MCP endpoint to discover, secure, and configure
- the central persisted process registry and host metadata still live above the slave
- cross-host workflows become harder, not easier

### Bottom line
Only worth considering if Project Commander later wants host-local advanced automation independent of the central control plane.

## Recommended Capability Split

### Tools
Use tools for mutations and explicit actions.

Recommended v1 tools:

- project start/stop
- service start/stop
- host add/delete
- host deploy/upgrade
- desired-process ensure/delete
- process soft-kill/hard-kill
- terminal session start/send/close
- checkout project

### Resources
Use resources for read-heavy, refreshable, or subscribable state.

Recommended v1 resources:

- project list and detail
- host list and detail
- runtime snapshot
- desired processes
- observed runs
- host telemetry
- process telemetry
- tail-style logs
- terminal transcript snapshot

### Prompts
Do not start with prompts unless a concrete client needs them. Prompts are useful, but they are not required to make the system MCP capable.

## Transport Recommendations

### Phase 1 transport
`stdio`

Why:

- simplest path for local clients and MCP Inspector
- least security surface while validating tool/resource shape
- aligns with the spec's "support stdio whenever possible" guidance

### Phase 2 transport
Streamable HTTP

Why:

- Project Commander already runs as a networked control plane
- notifications and subscriptions matter for logs, runtime changes, and host/process telemetry
- remote agents and remote clients are a natural future fit

### What not to do
Do not try to treat the current WebSocket API as MCP transport. Keep it internal or legacy-client-facing.

## Hard Parts To Solve Cleanly

### 1. Terminal semantics
The current terminal manager is SSH-shell oriented. MCP is not a raw TTY protocol.

Recommended approach:

- treat terminal sessions as durable session resources
- use tools to start a session, send input, and close a session
- expose transcript snapshots as resources
- optionally expose read cursors for transcript tailing

Do not try to present the terminal as if MCP were a byte-stream transport.

### 2. Log tailing
Project Commander already has tail/seek logic and per-process log files.

Recommended approach:

- expose logs as paged resources with stable cursor semantics
- optionally support resource subscriptions for append notifications
- keep strict `limit` bounds

### 3. Destructive actions and trust boundaries
Per the MCP tool model, the client should keep a human in the loop. On the server side:

- validate host/project/process identity against known records
- require explicit arguments for destructive actions
- redact secrets in outputs
- keep audit logs for tool calls

### 4. Stdio hygiene
If the Node backend is launched as an MCP `stdio` subprocess, it must not write arbitrary output to `stdout`.

That means:

- MCP messages only on `stdout`
- all logging on `stderr`
- likely a dedicated MCP entrypoint rather than reusing the normal Express startup directly

### 5. Long-running operations
Deployments, upgrades, checkout operations, and process reconciliation can outlive a single short request.

Recommended approach:

- tool returns a command or operation id immediately
- progress and final state are readable from resources
- optional notifications announce state changes

## Unconsidered Needs And Likely Follow-On Asks

### Multi-user and auth
If Streamable HTTP is exposed beyond localhost, this needs:

- authentication
- authorization by capability or host/project scope
- audit logging
- rate limiting

### Stable identity design
MCP URIs and tool arguments need stable identifiers.

Use:

- host id or agent UUID for hosts
- project id plus path as a fallback
- desired process id plus process key
- run id for observed process instances

### Client expectations
Some MCP clients are tool-first and ignore resources heavily. Others surface resources well. The initial capability mix should assume:

- tools will be the most portable
- resources are still the right shape for logs and telemetry
- prompts are optional

### Possible adjacent feature
Separate from becoming an MCP server, Project Commander could later become an MCP client and broker external MCP servers into its own UI. That is adjacent, but it is not required for this work.

## Recommended Route
Choose Route 1 first: Node backend as the MCP server.

Reasoning:

- it matches the actual control-plane ownership in this repo
- it minimizes duplication
- it can expose the full system, not just the execution plane
- it can still delegate to the master agent exactly as today
- it leaves open a later Route 3 split if a low-level master MCP surface becomes worthwhile

## Practical Rollout

### Step 1
Add a dedicated MCP entrypoint in `packages/server` using `@modelcontextprotocol/sdk`.

### Step 2
Ship a read-mostly surface first:

- list projects
- list hosts
- get runtime snapshot
- get desired processes
- get observed runs
- read logs

### Step 3
Add mutation tools:

- project/service control
- desired-process ensure/delete
- process soft/hard kill
- checkout project

### Step 4
Add terminal session tools and transcript resources.

### Step 5
Add Streamable HTTP and harden auth, audit, and rate limiting.

## Decision Summary

### Best first implementation
Node backend MCP facade over the existing control plane.

### Best future extension
Optional second MCP surface in the master agent only if a low-level execution-plane API becomes valuable on its own.

### Avoid for now

- per-slave MCP servers
- raw terminal-over-MCP assumptions
- exposing the internal WebSocket protocol as if it were MCP

## Official References

- MCP transports: <https://modelcontextprotocol.io/specification/2025-06-18/basic/transports>
- MCP tools: <https://modelcontextprotocol.io/specification/2025-06-18/server/tools>
- MCP resources: <https://modelcontextprotocol.io/specification/2025-06-18/server/resources>
- MCP prompts: <https://modelcontextprotocol.io/specification/2025-06-18/server/prompts>
- Official TypeScript SDK: <https://github.com/modelcontextprotocol/typescript-sdk>
- Official Go SDK: <https://github.com/modelcontextprotocol/go-sdk>
