# Codex Integration Routes

## Purpose

This document outlines how the `@openai/codex` npm package could be integrated into Project Commander, what fits the current architecture well, what does not, and which route is the most practical to implement first.

It is based on:

- the current Project Commander architecture in:
  - `packages/web`
  - `packages/server`
  - `packages/agent-master`
  - `packages/agent-slave`
- the runtime/process registry already present in the app
- OpenAI Codex product documentation:
  - [OpenAI Codex CLI – Getting Started](https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started)
  - [Codex is now generally available](https://openai.com/index/codex-now-generally-available/)
  - [Codex](https://openai.com/codex)

## Verified Product Reality

Before choosing an integration route, the important constraint is this:

- `@openai/codex` is primarily a terminal-first CLI package.
- OpenAI documents it as a local coding agent that reads, edits, and runs code on the local machine.
- OpenAI also documents approval modes such as suggest, auto-edit, and full-auto.
- OpenAI separately documents a Codex SDK for embedded/app workflows.

That means:

- if the requirement is specifically `@openai/codex`, the most natural integration is subprocess execution on a host
- if the requirement is a deeply embedded agent API, the better long-term fit is likely the Codex SDK rather than the CLI package itself

This document still focuses on how the CLI package could be used inside Project Commander.

## Current Project Commander Surfaces Relevant To Codex

### Web

The Next.js app already has the right operator surfaces for Codex:

- projects pane
- runtime tab
- host detail views
- log viewer with tail/seek behavior
- terminal tab

Relevant files:

- `packages/web/src/features/home/components/panels/RuntimePanel.js`
- `packages/web/src/features/home/components/panels/LogsPanel.js`
- `packages/web/src/features/home/components/panels/TerminalPanel.js`

### Server

The Node backend already has the right orchestration primitives:

- GraphQL mutations and queries
- websocket push to the UI
- persisted host/project/process state
- terminal session management
- runtime registry / desired process / observed run model

Relevant files:

- `packages/server/src/index.js`
- `packages/server/src/graphql/index.js`
- `packages/server/src/runtime/processRegistry.js`
- `packages/server/src/terminalSessionManager.js`

### Agents

The Go master/slave layer already gives Project Commander a remote execution fabric:

- slave registration and heartbeats
- desired process reconciliation
- observed process telemetry
- managed process log shipping
- remote kill controls

Relevant files:

- `packages/agent-master/internal/master`
- `packages/agent-slave/cmd/pc-slave`

This is a strong fit for Codex as a host-scoped coding worker.

## Main Integration Goals

There are several distinct ways Codex could add value here:

1. Ask Codex to operate on a selected project.
2. Run Codex on a selected host, not just locally.
3. Stream Codex output into the existing logs pane.
4. Let operators stop or restart Codex runs through existing runtime controls.
5. Keep an audit trail of what prompt ran, where it ran, and what changed.
6. Optionally support an interactive Codex session, not only batch execution.

## Route 1: Local Node-Backend Wrapper Around Codex CLI

### Summary

The Node backend launches the Codex CLI on the same machine as the server, scoped to a selected local project directory.

### How It Would Work

- Add a GraphQL mutation such as `startCodexTask(projectPath, prompt, mode, model)`.
- The server spawns the Codex CLI as a subprocess.
- The subprocess is registered in the existing process registry.
- Stdout/stderr are written to the existing managed-process log path.
- The UI views the Codex run as another managed process.

### Why It Fits

- minimal distributed-systems work
- reuses current runtime registry, logs, and kill controls
- no new agent protocol is required for the first version

### Limits

- local machine only
- no remote-host support
- still leaves interactive Codex session support unresolved

### Effort

- low

### Recommendation

- useful only as a bootstrap route
- not sufficient if Codex is expected to operate on slave-host projects

## Route 2: Slave-Hosted Codex Runs As Managed Processes

### Summary

Treat Codex as a first-class managed process type that executes on the selected slave host inside the selected project directory.

### How It Would Work

- The web UI adds a `Run Codex` action at the project and host level.
- The server stores a Codex task definition or desired process definition.
- The master relays it to the slave as a desired process or command.
- The slave launches the Codex CLI on that host.
- The slave writes Codex stdout/stderr to the same `<pid>.log` process log directory already used by managed processes.
- The existing log tail path shows Codex output in the logs pane.
- Existing soft/hard kill flows terminate the run.

### Why It Fits

This is the best architectural fit for the project as it exists today:

- Project Commander already has host-aware process management.
- Managed-process logs already stream back into the UI.
- The UI already has process telemetry and kill controls.
- Codex is naturally host-scoped because the repo checkout, filesystem, shell tools, and secrets all live on the host.

### Needed Changes

#### Web

- Add `Run Codex` actions to:
  - project rows
  - runtime tab
  - host detail views
- Add a Codex task form:
  - prompt
  - approval mode
  - optional model
  - optional working directory override
  - optional branch/worktree target
- Add a Codex run detail view:
  - prompt
  - mode
  - current status
  - latest output
  - exit code

#### Server

- Add a first-class Codex job/task record, or encode Codex within the existing desired-process model.
- Persist:
  - prompt
  - model
  - approval mode
  - host id
  - project id/path
  - initiating user
  - run id
  - exit status
- Decide whether Codex is:
  - a one-shot command
  - or a managed process subtype

#### Agent Protocol

- Likely add a dedicated command type such as `codex_run`.
- The current generic process model can run Codex, but a typed command is cleaner because Codex runs are task-oriented rather than service-oriented.

#### Slave

- Ensure the target host has:
  - Node/npm available
  - `@openai/codex` installed or installable
  - OpenAI credentials available in a safe way
- Launch Codex in the project working directory.
- Capture stdout/stderr into the managed process log file.

### Main Risks

- host-side credential distribution
- package installation consistency across machines
- toolchain drift across hosts
- approval-mode semantics need to be mapped cleanly into a remote headless execution model

### Effort

- medium

### Recommendation

- this is the recommended first real integration route

## Route 3: Interactive Codex In The Existing Terminal Tab

### Summary

Run Codex as an interactive CLI session inside the Terminal tab.

### Why It Is Attractive

- closest match to how `@openai/codex` is designed to be used
- gives the operator live back-and-forth control
- can preserve Codex-native approval flows

### Why It Does Not Fit Cleanly Today

The current terminal implementation is not a true full-screen PTY terminal emulator. It is a line-oriented shell session manager. That is fine for bash-style command interaction, but it is a weak fit for a rich terminal UI.

Relevant file:

- `packages/server/src/terminalSessionManager.js`

Current gaps:

- no real VT100/PTY rendering layer in the browser
- no full keystroke-stream model
- no alternate-screen handling
- no robust support for TUI redraws

### Implication

If Codex is expected to run in its natural interactive form, Project Commander would need:

- true PTY session transport end to end
- websocket keystroke streaming
- terminal rendering in the browser
- session persistence across tab switches

### Effort

- high

### Recommendation

- do not start here unless interactive Codex is the primary requirement

## Route 4: Async Background Coding Jobs

### Summary

Use Codex as a delegated background worker for tasks like:

- implement a feature
- update a dependency
- fix a failing test suite
- draft a migration
- write docs

### How It Would Work

- User creates a Codex task against a project/host.
- Project Commander schedules the task onto a host.
- The task runs in a dedicated worktree or workspace clone.
- Codex executes asynchronously.
- The result is:
  - patch files
  - a branch/worktree
  - commit(s)
  - a summary artifact
- The UI shows task progress and results.

### Why It Fits Project Commander

Project Commander already trends toward a control-plane model:

- hosts
- jobs/processes
- telemetry
- logs
- long-lived tasks

This route turns Project Commander into a distributed coding-task orchestrator, not only a runtime monitor.

### Major Missing Pieces

- worktree lifecycle management
- artifact/result storage
- patch/branch review workflow
- concurrency controls and quotas
- retry and resume semantics

### Effort

- high

### Recommendation

- strong long-term route
- not the right first slice

## Route 5: Test-Reporter / CI Remediation Flow

### Summary

Use Codex to respond to failing test suites or runtime regressions.

### Why It Is Interesting In This Repo

This repo already has unified reporting through `test-station` and has multiple layers:

- web tests
- server tests
- Go agent tests

That makes it a good candidate for:

- "explain this failing test report"
- "attempt a fix on a branch"
- "summarize likely root causes"

### How It Could Work

- On failed test-report runs, create a Codex remediation task.
- Feed the normalized test artifact path into the Codex prompt.
- Run Codex against the failing workspace.
- Return:
  - summary
  - changed files
  - test rerun result

### Why This Should Not Be Phase 1

- it depends on having a stable Codex execution substrate first
- it is downstream of Route 1 or Route 2

### Effort

- medium after base Codex execution exists

## Route 6: Direct Browser Integration

### Summary

Import `@openai/codex` into the Next.js frontend and run it from the browser.

### Recommendation

- do not do this

### Why

- credentials would be exposed or awkwardly proxied
- local filesystem and terminal semantics do not belong in the browser
- remote host execution becomes unnatural
- the current app already has a stronger server/agent execution architecture

## Recommended Implementation Order

## Phase 1

Implement Codex as a non-interactive host-scoped task on top of the existing runtime/process model.

Shape:

- host + project selected
- prompt submitted
- server persists task
- slave launches Codex CLI
- output tails into logs pane
- soft/hard kill works through existing controls

This provides real value quickly and fits the current architecture.

## Phase 2

Separate Codex task records from generic desired services if the semantics diverge too much.

This is likely once the app needs:

- prompt history
- task outcomes
- structured result artifacts
- branch/worktree ownership

## Phase 3

Add richer operator features:

- rerun
- clone-from-task
- compare task outputs
- task templates
- test-station remediation

## Phase 4

Only then evaluate whether true interactive Codex terminal sessions are worth building.

## Specific Design Decision: CLI Wrapper vs SDK

If the project must use `@openai/codex` specifically:

- use subprocess execution on the host
- do not try to deeply embed CLI internals into the app

If the project wants a first-class embedded coding agent:

- the Codex SDK is likely the better long-term foundation
- keep the UI, task model, and host execution model the same
- swap the execution engine later if needed

This suggests a good compatibility strategy:

- define a Project Commander `coding_task` abstraction
- let the task executor be pluggable
- start with Codex CLI
- later allow Codex SDK without rewriting the UI model

## Gaps And Unconsidered Needs

These need explicit design before implementation:

### Credentials

- Where do OpenAI credentials live?
- per host
- per user
- per workspace
- shared service account

### Approval Mapping

Codex’s approval modes need to map into Project Commander policy:

- should remote hosts be allowed to run auto-edit or full-auto?
- should only local hosts allow write/execute?
- is there a project-level policy?

### Repo Safety

- should Codex run only in a detached worktree?
- should it be blocked on dirty working trees?
- should it ever run against the main checkout directly?

### Host Tooling

- not every slave host may have Node/npm
- not every host may be allowed outbound internet
- package installation/update strategy must be explicit

### Prompt And Artifact Storage

- prompts may contain sensitive architecture or incident details
- task outputs may include sensitive code
- retention and redaction policy are needed

### Cost Controls

- model selection
- per-host quotas
- per-user quotas
- cancellation behavior

### Observability

- Codex tasks should emit structured lifecycle events:
  - queued
  - started
  - output appended
  - waiting for approval
  - completed
  - failed
  - cancelled

### Multi-Tenant Concerns

If Project Commander will ever be multi-user:

- who may launch Codex on which host?
- who may inspect Codex logs and prompts?
- who owns resulting branches/worktrees?

## Recommendation

The best route for this codebase is:

1. implement Codex as a host-scoped task executed by the slave agent
2. treat it as a managed process with log tailing and kill controls
3. keep the execution abstraction broad enough that Codex CLI can later be swapped or supplemented by the Codex SDK

The route to avoid is direct browser integration.

The route to defer is fully interactive terminal-based Codex until the terminal subsystem is upgraded to real PTY/TUI support.
