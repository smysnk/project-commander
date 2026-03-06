# Project Discovery App

Yarn monorepo with a Next.js frontend and an Express server for project discovery.

## Workspaces

- `packages/web`: Next.js UI
- `packages/server`: Discovery API

## Quick Start

```bash
cp .env.example .env
yarn install
yarn dev
```

- Web: `http://localhost:${WEB_PORT:-3000}`
- Server: `http://localhost:${SERVER_PORT:-4000}`

## Discovery Rules

- Folder with `package.json` -> `node-project`
- Folder with `package.json` + `packages/` -> `node-monorepo`
- Folder with `go.mod` -> `go-project`
- Folder with `go.work` OR a `go.mod` that contains nested child `go.mod` files -> `go-monorepo`
- Folder with `Makefile`, `makefile`, or `GNUmakefile` -> `hasMakefile=true`

Only folders whose **folder name** matches `PROJECT_FOLDER_PATTERN` are evaluated as candidate projects.

## API Endpoints

- `POST /graphql` (default frontend endpoint)
- `GET /api/discovery/config`
- `PUT /api/discovery/config`
- `GET /api/discovery/projects`
- `GET /health`

## Runtime Variables Pattern

- Frontend bootstraps runtime config from GraphQL `runtimeConfig` query.
- Runtime config is stored in Redux under `runtime.config`.
- The app writes runtime config to `window.__RUNTIME_CONFIG__`.
- Frontend defaults GraphQL requests to `/graphql`.

## Go Master Agent (Weeks 1-4)

Week 1-4 companion-agent implementation is available:

- Protobuf contracts:
  - `proto/projectcommander/master/v1/master_control.proto`
  - `proto/projectcommander/master/v1/master_events.proto`
  - `proto/projectcommander/slave/v1/slave_control.proto`
- Go agent modules:
  - `packages/agent-master` (`pc-master` + runtime control)
  - `packages/agent-slave` (`pc-slave`)
  - `packages/agent-shared` (generated Go protobuf stubs)
- Go master runtime control is implemented for:
  - runtime snapshots/logs/process stats
  - launch environment + port-range settings
  - start/stop/restart service
  - start/stop project
- Node smoke client:
  - `packages/server/src/agent/smoke.js`

Useful commands:

```bash
# Regenerate Go protobuf stubs
yarn proto:generate:go

# Build every target (web + server + pc-master + pc-slave)
yarn build:all

# Run Go master locally over UDS (dev watch/reload mode)
yarn agent:master:dev

# Build Go master binary
yarn agent:master:build

# Run Go slave locally (dev watch/reload mode)
yarn agent:slave:dev

# Build Go slave binary
yarn agent:slave:build

# Run Node->Go smoke RPC checks (requires master running)
yarn agent:master:smoke
```

Runtime backend:

- Go master backend is always enabled for the server runtime.

Slave workload watch/reload:

- When `pc-slave` is started with `PC_SLAVE_PROJECT_PATH` (or `--project-path`), it launches `PC_SLAVE_LAUNCH_COMMAND` (default: `yarn dev`).
- The slave watches `<project>/packages` for file changes.
- Ignore patterns are loaded from `<project>/.gitignore`.
- On detected changes, the slave restarts the launched workload process.

## Remote Deployment

Deployment tooling is available for SSH + systemd environments:

```bash
# Deploy only the slave agent to a remote host
yarn deploy:slave --host user@remote-host

# Deploy master + GraphQL server + Next.js web to a remote host
yarn deploy:stack --host user@remote-host
```

Detailed options and examples:

- [Remote Deployment Guide](docs/remote-deployment.md)
