# Architecture

## Overview

Port Start is one Go binary with three roles:

1. The daemon supervises processes, persists definitions, captures logs, and
   serves the control plane.
2. The CLI uses the control-plane API.
3. The embedded React/Vite SPA uses the same API.

The daemon is the only authority for process and run state.

```text
                         administration port
                  CLI ─────────┐
                               ▼
 Browser ───────────────▶ API and SPA
                               │
                         Process daemon
                          │          │
                   SQLite state   log segments
                          │
                    child process ─── declared ports
```

The process inventory is flat. Labels and tags provide human organization.
Manifest source data provides reconciliation ownership only.

## Control plane

The administration server binds `127.0.0.1:13337` by default. It exposes:

- The embedded SPA.
- JSON endpoints under `/api/v1`.
- An OpenAPI document.
- Server-Sent Events for process, run, and log updates.
- health and readiness endpoints.

The CLI and SPA never edit SQLite or signal process groups directly. A
single-instance lock prevents two daemons from using one data directory.

Password-free loopback access is the default. An optional password protects the
control plane. Non-loopback access without authentication shows a persistent
warning.

## Registration

Imperative registration creates one process. Manifest registration validates a
complete file and reconciles its process entries in one transaction.

Each process receives an opaque stable ID. Labels can repeat. Tags are
normalized metadata. A manifest entry uses its canonical manifest path and
stable key for reconciliation.

Source roots, Git repositories, and worktrees are not API parents. Automation
can add source-related tags when those values help discovery.

## Process execution

A process has kind `service` or `task`. Both kinds use argv or an explicit
shell string. The login shell initializes the toolchain environment.

Argv definitions use `exec "$@"` to preserve argument boundaries. Shell strings
use the login shell parser.

Before launch, the daemon sets the working directory and expands:

- `{definition_id}` and `PORT_START_DEFINITION_ID`.
- `{run_id}` and `PORT_START_RUN_ID`.
- `{manifest_dir}` and `PORT_START_MANIFEST_DIR` for manifest-owned processes.
- named port values such as `{port.http}` and `PORT_START_PORT_HTTP`.

Each run receives its own process group. Stop or Cancel sends SIGTERM, waits ten
seconds by default, and sends SIGKILL when required. An intentional daemon
shutdown terminates all managed process groups.

Service state follows the active process group. Task invocations use the same
execution and log boundary. Declared ports do not gate lifecycle transitions.

## Persistence

SQLite stores:

- Settings and schema migrations.
- Process definitions, labels, tags, and source ownership.
- Commands, working directories, and environment overrides.
- Declared ports.
- Service state and run history.
- Process identity and terminal results.
- Log segment metadata.
- authentication data.

SQLite uses WAL, foreign keys, a busy timeout, and embedded migrations.
Append-only NDJSON segments store process output outside SQLite.

## Recovery

On startup the daemon:

1. Acquire the single-instance lock.
2. Open SQLite and apply migrations.
3. Mark unfinished runs as interrupted.
4. Validate recorded process identities.
5. Load process definitions and declared-port metadata.
6. Serve the API and SPA.
7. starts log retention.

Recovery does not restart services. The dashboard can use restored labels and
tags immediately.

## Technology boundaries

- Go 1.24 for the daemon and CLI.
- Standard `net/http` for the control plane.
- Cobra for CLI commands.
- A pure-Go SQLite driver.
- React, TypeScript, and Vite for the SPA.
- OpenAPI for the HTTP contract.
- Embedded frontend assets and SQL migrations.

State transitions, validation, reconciliation, tag filtering, retention,
command expansion, and presentation mapping remain deterministic. Process,
filesystem, SQLite, clock, and service-manager work stays behind injected
boundaries.
