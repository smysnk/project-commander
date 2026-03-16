# Project Commander

Project Commander is a local-first control plane for development projects and remote build hosts.

It gives you a single web UI for:

- discovering projects on the local machine and on registered slave agents
- starting and stopping project runtimes
- streaming logs with tail-style viewing
- inspecting environment and process state
- opening interactive terminal sessions on slave agents
- deploying, upgrading, and monitoring remote slave agents from a master agent

The application is built for teams or individuals who want one place to supervise many repos and many machines without manually jumping between terminals, SSH sessions, and ad hoc scripts.

## How It Works

Project Commander is split into four main parts:

- `packages/web`
  Next.js frontend for projects, runtime status, hosts, logs, and terminal interaction.
- `packages/server`
  Node.js backend that exposes GraphQL and websocket APIs, persists app state, and brokers UI actions.
- `packages/agent-master`
  Go master agent responsible for runtime control, slave coordination, log access, and host communication.
- `packages/agent-slave`
  Go slave agent that runs on managed hosts, reports health and discovered projects, executes remote commands, and can watch project directories for restart-on-change workflows.

At runtime, the typical flow is:

1. The web app connects to the Node backend over GraphQL and websocket.
2. The Node backend talks to the Go master agent.
3. The Go master agent manages local runtime state and connected slave agents.
4. Slave agents report heartbeats, discovered projects, logs, and command results back through the master.

## Core Capabilities

### Project Management

- detect projects from configured directories
- support manually-added project paths
- show runtime status, ports, services, and process state
- discover project metadata on slave hosts and surface it in the main project list

### Host Management

- register slave agents with the master agent
- add hosts manually from the UI
- deploy or re-deploy slave agents to remote machines
- manage host-specific directories used for project discovery and checkout
- show host health, last heartbeat, version, and logs

### Runtime Control

- start or stop projects and individual services
- inspect launch environment and port range configuration
- surface runtime status from the master agent in the UI

### Logs And Terminal

- stream runtime, master, and slave logs into the UI
- query logs in tail/seek windows instead of loading entire files
- filter logs by level and package
- open long-lived interactive terminal sessions against slave hosts

## Repository Layout

- `packages/web`: Next.js application
- `packages/server`: Express + GraphQL + websocket backend
- `packages/agent-master`: Go master agent
- `packages/agent-slave`: Go slave agent
- `packages/agent-shared`: shared protobuf generation output for Go packages
- `proto`: protobuf contracts between the server, master agent, and slave agent
- `scripts`: deployment and build scripts
- `docs`: architecture notes, implementation plans, and deployment guides

## Quick Start

```bash
cp .env.example .env
yarn install
yarn dev
```

Default local endpoints:

- Web UI: `http://localhost:3000`
- Node backend GraphQL: `http://localhost:4000/graphql`
- Node backend health: `http://localhost:4000/health`

`yarn dev` runs the monorepo development stack and is intended to bring up the web app, server, and agent workspaces that provide a `dev` script.

## Useful Commands

```bash
# Start the full development stack
yarn dev

# Build the web and server packages
yarn build

# Build everything, including Go agents
yarn build:all

# Run only the web frontend
yarn dev:web

# Run only the Node backend
yarn dev:server

# Run the Go master agent in dev mode
yarn agent:master:dev

# Run the Go slave agent in dev mode
yarn agent:slave:dev

# Build Go protobuf bindings
yarn proto:generate:go
```

## Testing

Canonical root test entrypoints:

```bash
# Run the unified workspace test report
yarn test

# Run the unified workspace test report with coverage enabled where supported
yarn test:coverage
```

These commands run the vendored `test-station` 0.2.x CLI through the repo-level [test-station.config.mjs](/Users/josh/play/project-commander/test-station.config.mjs). The wrapper at [run-vendored-test-station.mjs](/Users/josh/play/project-commander/scripts/test-station/run-vendored-test-station.mjs) executes `references/test-station` in its own workspace context and bootstraps that vendored checkout on first use if needed.

Canonical test artifacts are written to:

- `artifacts/workspace-tests/report.json`
- `artifacts/workspace-tests/index.html`
- `artifacts/workspace-tests/raw/`

`report.json` is the machine-readable source of truth. `index.html` is the drillable human-facing report. `raw/` contains per-suite native artifacts such as normalized NDJSON and Playwright JSON payloads.

### CI Report Publishing

The GitHub Actions test workflow publishes the canonical workspace report to:

- `https://test-station.smysnk.com/api/ingest`

The workflow uses shared-key auth through the GitHub Actions secret:

- `TEST_STATION_INGEST_SHARED_KEY`

The hosted `test-station` deployment must be configured with the matching server-side `INGEST_SHARED_KEY`.

Optional artifact storage wiring mirrors the upstream `test-station` deployment pattern:

- variables:
  - `S3_BUCKET`
  - `S3_STORAGE_PREFIX`
  - `S3_PUBLIC_URL`
  - `S3_AWS_REGION`
- secrets:
  - `S3_AWS_ACCESS_KEY_ID`
  - `S3_AWS_SECRET_ACCESS_KEY`

When those are configured, the workflow syncs `artifacts/workspace-tests/` to S3 before publishing the ingest payload so the hosted report can link back to uploaded artifacts.

## Deployment

Project Commander includes deployment helpers for remote hosts.

```bash
# Deploy a slave agent to a remote host
yarn deploy:slave --host user@remote-host

# Deploy the application stack to a remote host
yarn deploy:stack --host user@remote-host
```

More detail is available in [docs/remote-deployment.md](docs/remote-deployment.md).

## Environment

Copy [.env.example](.env.example) to `.env` and adjust values for your local machine, master agent, and deployment setup.

Important configuration areas include:

- web and server ports
- master agent socket and network endpoints
- slave shared key configuration
- default project discovery directory
- deployment and runtime settings

## Purpose Summary

Project Commander exists to make a development machine cluster feel like one controllable workspace. Instead of manually managing processes, logs, ports, project discovery, and shell access across many repositories and hosts, the app centralizes those operations behind a single master/slave runtime model and a browser UI.
