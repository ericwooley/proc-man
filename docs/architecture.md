# Architecture

## Overview

Port Start is distributed as one Go binary with three roles:

1. The **daemon** owns listeners, supervises processes, persists state, captures
   logs, and serves the control plane.
2. The **CLI** is a client of the control-plane API and never edits SQLite or
   process state directly.
3. The **administration SPA** is a React/Vite application embedded in the Go
   binary and is also an API client.

The daemon is the only authority for lifecycle and port state.

```text
                              administration port
                     CLI ───────┐
                                ▼
                         ┌───────────────┐
              Browser ──▶│ Admin API/SPA │
                         └───────┬───────┘
                                 │
                         ┌───────▼───────┐
                         │    Daemon     │
                         │ state machine │
                         └───┬───────┬───┘
                             │       │
                 SQLite metadata     └──── log segment files
                             │
              advertised TCP listener
                             │
                     ┌───────▼────────┐
                     │ proxy or       │
                     │ port handoff   │
                     └───────┬────────┘
                             ▼
                      managed process
```

## Control plane

The administration server binds `127.0.0.1:13337` by default. Configuration,
environment, and daemon flags may override its host and port. The server exposes:

- the embedded SPA;
- versioned JSON endpoints under `/api/v1`;
- a published OpenAPI document;
- Server-Sent Events for state and log updates;
- health and readiness endpoints.

The CLI and SPA use these interfaces instead of privileged internal paths.
Starting a second daemon for the same data directory fails through a
single-instance lock.

An optional password protects the control plane. Password-free loopback access
is the normal configuration. Binding beyond loopback is allowed, but operating
without a password must produce a prominent warning. V1 does not provide TLS and
therefore treats non-loopback use as trusted-network use.

## Data plane

Each service has one advertised TCP address and one launch command. The service
declares one of two modes.

### Proxy mode

The daemon keeps the advertised listener for the service's entire lifetime. On
startup it chooses an available loopback port, expands the command's port
variables, and launches the process on that backend port.

Once ready, every accepted connection is forwarded as an unmodified byte stream.
This supports HTTP, HTTPS passthrough, WebSockets, databases, and other TCP
protocols without protocol-specific proxy behavior.

While startup is in progress:

- an HTML navigation to a service declared as plain HTTP receives the startup
  interstitial;
- other HTTP and raw TCP connections may be held and forwarded after readiness;
- no more than 64 connections are held for one launch;
- excess connections receive a retryable HTTP response when recognizable as
  HTTP, or are closed otherwise.

The daemon retains the advertised listener when the command stops, so re-arming
is immediate.

### Handoff mode

Handoff is for commands that cannot bind a daemon-assigned backend port.

The daemon initially owns the advertised listener. On the first trigger it:

1. serves the startup page when the trigger is an eligible HTTP navigation;
2. closes every accepted connection and the advertised listener;
3. launches the command with the advertised port as its bind port;
4. monitors the process group and advertised port.

Keeping the first TCP connection open is deliberately not part of this contract.
An arbitrary child may not enable `SO_REUSEADDR`, in which case an existing
accepted connection prevents it from binding.

Non-navigation HTTP receives `503 Service Unavailable` with `Retry-After`.
HTTPS and other TCP clients are closed and must retry. A dashboard-initiated
start can avoid exposing that retry to a user by waiting for readiness before
navigating.

After a handoff service has been ready, a continuously bindable port indicates
that the service no longer owns it. After three seconds the daemon terminates any
remaining process group, finalizes the run, and reclaims the listener.

## HTTP startup interstitial

Only `GET` or `HEAD` requests accepting `text/html` use the interstitial
response. `GET` receives a single HTML document with inline styles and
JavaScript; `HEAD` receives the equivalent headers with no body. No supporting
asset requests are needed from the managed port. Handoff responses explicitly
close the HTTP connection before the child is launched.

The page contains a random, short-lived capability token scoped to:

- read the service and current run state;
- stream the current run's logs;
- restart the current launch;
- cancel the current launch.

The token does not grant general administration access. It expires ten minutes
after issuance or 60 seconds after the scoped startup reaches a terminal state,
whichever happens first. The admin server permits only the exact startup-page
origin for these token-bearing cross-origin requests.

When the daemon reports readiness, the page reloads the original URL. Cancel
ends the current attempt and leaves the service idle and armed. Restart
terminates the current attempt and begins a new one immediately.

## Process execution

Commands are represented either as an argv array or an explicit shell string.
Argv is the default. Both forms run through the user's configured login shell so
toolchain initialization from the login environment is available.

For argv commands, the shell wrapper uses `exec "$@"` so the stored argument
boundaries are not re-parsed. Shell strings deliberately use the login shell's
parsing semantics.

The daemon sets the working directory before starting the shell and expands:

- `{port}` and `PORT`: the command's actual bind port;
- `{public_port}` and `PORT_START_PUBLIC_PORT`: the advertised port;
- `PORT_START_PORT`: the command's actual bind port;
- `PORT_START_MODE`, `PORT_START_SERVICE_ID`, and
  `PORT_START_WORKTREE_ROOT`: execution context.

In proxy mode `{port}` is the assigned backend port. In handoff mode it is the
advertised port.

Each run receives its own process group. A normal stop sends `SIGTERM`, waits ten
seconds, and sends `SIGKILL` if necessary. The daemon terminates all managed
process groups during an intentional shutdown.

## Persistence

SQLite stores durable structured state:

- settings and schema migrations;
- worktrees and their observed Git metadata;
- service desired configuration and source ownership;
- exact or assigned public ports;
- service lifecycle state;
- run history and process identity;
- log segment metadata;
- authentication password and session metadata.

SQLite runs with write-ahead logging, foreign keys, a busy timeout, and embedded
sequential migrations.

Process output is deliberately stored outside SQLite as bounded append-only
segments. See [Logging and retention](logging.md).

## Recovery and conflicts

On startup the daemon:

1. acquires the single-instance lock and opens/migrates SQLite;
2. marks unfinished runs interrupted and reconciles recorded process groups;
3. loads enabled, non-stale services;
4. binds their persisted advertised ports;
5. reports individual services as `conflict` rather than terminating the daemon
   if a port cannot be reclaimed.

An automatically assigned public port is not silently changed during restart.
Stable links are more important than hiding a collision.

For proxy backend ports, the daemon obtains an ephemeral loopback port immediately
before process launch. A backend port applies only to one run and is not a
durable service address.

## Technology boundaries

- Go 1.24 for the daemon and CLI.
- Standard `net/http` control plane and data-plane socket primitives.
- Cobra for the command hierarchy and help system.
- A pure-Go SQLite driver for Linux/macOS portability.
- React with TypeScript and Vite for the SPA.
- OpenAPI as the public HTTP contract, with generated frontend types.
- Embedded frontend assets and embedded SQL migrations.

Core state transitions, validation, reconciliation, retention decisions, and
command expansion must remain deterministic modules. Sockets, processes,
filesystem access, Git, SQLite, clocks, and service managers stay behind
explicitly injected boundaries.
