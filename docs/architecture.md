# Architecture

## Overview

Port Start is distributed as one Go binary with three roles:

1. The **daemon** supervises processes, executes registered commands, persists
   worktree metadata, captures logs, and serves the control plane.
2. The **CLI** is a client of the control-plane API and never edits SQLite or
   process state directly.
3. The **administration SPA** is a React/Vite application embedded in the Go
   binary and is also an API client.

The daemon is the only authority for managed-process lifecycle state.

```text
                              administration port
                     CLI ───────┐
                                ▼
                         ┌───────────────┐
              Browser ──▶│ Admin API/SPA │
                         └───────┬───────┘
                                 │
                         ┌───────▼────────┐
                         │     Daemon     │
                         │ process manager│
                         └───┬────────┬───┘
                             │        │
                 SQLite metadata      └──── log segment files
                             │
                     ┌───────▼────────┐
                     │ managed process│──── declared endpoints
                     └────────────────┘
```

Declared endpoints describe where a managed process is configured to listen.
The process binds its own sockets. Port Start stores and displays those values
alongside process state, commands, and logs.

## Control plane

The administration server binds `127.0.0.1:13337` by default. Configuration,
environment, and daemon flags may override its host and port. The server exposes:

- the embedded SPA;
- versioned JSON endpoints under `/api/v1`;
- a published OpenAPI document;
- Server-Sent Events for process, run, and log updates;
- health and readiness endpoints.

The CLI and SPA use these interfaces instead of privileged internal paths.
Starting a second daemon for the same data directory fails through a
single-instance lock.

An optional password protects the control plane. Password-free loopback access
is the normal configuration. Binding beyond loopback is allowed with a prominent
warning when authentication is disabled. V1 treats non-loopback use as
trusted-network use.

## Registration and reconciliation

`port-start worktree register` discovers a Git worktree, reads its manifest,
validates the complete document, and submits a desired registration to the
daemon. Repeating the same registration is idempotent.

The daemon identifies a worktree by its canonical Git common directory and
canonical worktree root. Within one worktree, process and command names are
stable keys. Registration reconciles manifest-owned definitions in one
transaction while leaving imperative definitions unchanged.

Port declarations are validated for name, host, numeric range, protocol, and URL
shape. They are stored as configuration rather than acquired resources.
Registration therefore succeeds independently of current socket availability.

Re-registration may change a definition while one of its runs is active. The
active run continues with its immutable launch snapshot; the new definition
becomes the configuration for the next run. Control-plane responses expose both
values whenever they differ.

## Process execution

Process and command definitions use either an argv array or an explicit shell
string. Argv is the default. Both forms run through the user's configured login
shell so toolchain initialization is available.

For argv definitions, the shell wrapper uses `exec "$@"` so stored argument
boundaries are preserved. Shell strings deliberately use the login shell's
parsing semantics.

Before launch, the daemon sets the working directory and expands:

- `{definition_id}` and `PORT_START_DEFINITION_ID`;
- `{run_id}` and `PORT_START_RUN_ID`;
- a named port such as `{port.http}` and its normalized environment variable,
  such as `PORT_START_PORT_HTTP`.

For worktree-associated definitions it also expands `{worktree_root}` and sets
`PORT_START_WORKTREE_ROOT`. Standalone definitions omit that environment
variable and reject `{worktree_root}` during validation; their configured `cwd`
remains the explicit execution location.

Definitions may map a declared port into an application-specific variable:

```yaml
env:
  PORT: "{port.http}"
```

Each run receives its own process group. A normal stop or cancel sends SIGTERM,
waits ten seconds by default, and sends SIGKILL if necessary. The daemon
terminates all managed process groups during an intentional shutdown.

A managed process becomes `running` when its child is created successfully and
remains running while that child process group is alive. Declared endpoints are
presentation and execution metadata; they do not gate lifecycle transitions.
One-shot command invocations use the same execution and logging boundary and
reach a terminal state when the command exits.

## Persistence

SQLite stores durable structured state:

- settings and schema migrations;
- repositories, worktrees, and observed Git metadata;
- process and command definitions with source ownership;
- declared ports and link metadata;
- process state and run history;
- process identity and terminal results;
- log segment metadata;
- authentication password and session metadata.

SQLite runs with write-ahead logging, foreign keys, a busy timeout, and embedded
sequential migrations.

Process output is stored outside SQLite as bounded append-only segments. See
[Logging and retention](logging.md).

## Recovery

On startup the daemon:

1. acquires the single-instance lock and opens or migrates SQLite;
2. marks unfinished runs interrupted and safely reconciles recorded process
   groups;
3. loads registered worktrees, process definitions, command definitions, and
   declared ports;
4. serves the administration API and SPA;
5. starts retention and missing-worktree checks.

Processes start only through explicit actions, so recovery does not relaunch
previously active processes. Historical runs and declared endpoint links remain
available immediately.

## Technology boundaries

- Go 1.24 for the daemon and CLI.
- Standard `net/http` for the control plane.
- Cobra for the command hierarchy and help system.
- A pure-Go SQLite driver for Linux/macOS portability.
- React with TypeScript and Vite for the SPA.
- OpenAPI as the public HTTP contract, with generated frontend types.
- Embedded frontend assets and embedded SQL migrations.

Core state transitions, validation, reconciliation, retention decisions, command
expansion, and presentation mapping remain deterministic modules. Processes,
filesystem access, Git, SQLite, clocks, and service managers stay behind
explicitly injected boundaries.
