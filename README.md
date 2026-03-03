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
