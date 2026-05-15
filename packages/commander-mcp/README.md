# Project Commander MCP

`commander-mcp` exposes Project Commander runtime lifecycle controls to Codex-compatible MCP clients.

It calls the public GraphQL API through `commander-client`; it does not import server internals or launch processes itself.

## Configuration

```sh
PROJECT_COMMANDER_GRAPHQL_ENDPOINT=http://127.0.0.1:4000/graphql
PROJECT_COMMANDER_TOKEN=<automation-token>
yarn workspace commander-mcp start
```

The server also accepts `PROJECT_COMMANDER_URL` instead of `PROJECT_COMMANDER_GRAPHQL_ENDPOINT`; `/graphql` is appended automatically.

On the Project Commander server, configure one of:

```sh
PROJECT_COMMANDER_AUTOMATION_TOKEN=codex:<automation-token>
PROJECT_COMMANDER_AUTOMATION_TOKENS=codex:<token>,ci:<token>
```

## Tool Policy

The default lifecycle path is template based:

```json
{
  "host": "clearbox",
  "project": "varcad.io",
  "template": "docker-compose-web",
  "desiredState": "running"
}
```

Raw process definitions are blocked by default. To use them, the MCP process must be started with `PROJECT_COMMANDER_MCP_ALLOW_RAW_COMMANDS=true` and the tool input must include:

```json
{
  "privilegedScope": "raw-command"
}
```

This keeps Codex-facing execution on persisted Project Commander desired state and slave-managed process reconciliation instead of direct shell execution.

## Process Templates

Process templates are owned by the Project Commander server. MCP clients can list, resolve, upsert, delete, and ensure from templates through the GraphQL-backed catalog.

```json
{
  "host": "clearbox",
  "project": "varcad.io",
  "templateKey": "node.dev",
  "packageKey": "web",
  "processKeyTemplate": "{{package.key}}",
  "cwdTemplate": "{{project.hostPath}}/packages/web",
  "launchMode": "shell",
  "command": "yarn workspace web dev",
  "allowCodex": true
}
```

Scoped templates override broader templates by precedence: host+project, project, host, global, then inferred defaults. Disabled or non-Codex templates block fallback for the same key.

## Runtime Waits

`ensure_process` can wait for server-side health checks after the desired process is persisted:

```json
{
  "host": "clearbox",
  "project": "varcad.io",
  "template": "docker-compose-web",
  "wait": true,
  "timeoutMs": 90000
}
```

Templates can provide health checks, or callers can pass `healthChecksJson` directly. Supported checks are `process_status`, `http`, `tcp`, `log_pattern`, `graphql`, and `command_exit`. Log-pattern checks read managed process logs through Project Commander, not directly from the local filesystem.

## Shared-Drive Path Mapping

Phase 2 path mapping lets Codex pass a locally mounted path while the slave receives the host-local execution path.

Mounted paths detected on this workstation:

```text
/Volumes/public   -> 192.168.1.250 public share
/Volumes/public-1 -> 192.168.1.251 public share
```

Register mappings with:

```json
{
  "host": "clearbox",
  "logicalRoot": "clearbox-public",
  "codexPathPrefix": "/Volumes/public-1/play",
  "hostPathPrefix": "/opt/project-commander/slave/play"
}
```

Then `ensure_process` can use:

```json
{
  "host": "clearbox",
  "project": "varcad.io",
  "codexPath": "/Volumes/public-1/play/varcad.io",
  "template": "docker-compose-web"
}
```

The server rejects mappings whose `hostPathPrefix` is outside the host's approved runtime roots unless an explicit privileged override is supplied.

## Audit And Permissions

MCP calls authenticate with either legacy env bearer tokens or persisted `automation_api_tokens`. Persisted tokens support access modes, scopes, host/project/path constraints, raw-command flags, expiry, revocation, and last-used timestamps.

Useful administration tools:

```text
project_commander.list_automation_tokens
project_commander.create_automation_token
project_commander.revoke_automation_token
project_commander.list_runtime_audit_events
```

Access modes are `observe`, `operate-template`, `operate-project`, `operate-host`, `admin`, and `full-access`. Full-access tokens are equivalent to a trusted local operator but still route through server-side authorization and audit logging. Disable them with:

```sh
PROJECT_COMMANDER_FULL_ACCESS_TOKENS_ENABLED=false
```

Every lifecycle mutation sent through the MCP client includes `x-project-commander-tool` with the MCP tool name so `runtime_audit_events` records the request id, actor, tool, host, project, process key, status, and result.
