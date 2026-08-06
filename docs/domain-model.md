# Domain model and lifecycle

## Aggregate structure

```text
Process definition
├── Label
├── Tags
├── Declared ports
└── Runs
    └── Log records
```

Manifest source data records provenance and reconciliation ownership. It is not
a parent resource in the product model.

## Process definition

A process definition is the durable configuration for one executable. It has:

- An opaque stable ID.
- A required human label.
- Zero or more normalized tags.
- Kind `service` or `task`.
- Manifest or imperative source ownership.
- Argv or an explicit shell string.
- A working directory and environment overrides.
- Zero or more declared ports.
- stop, task, and log-retention limits.

Labels are presentation data and need not be unique. Selectors use opaque IDs.
Manifest entries also have a stable key for idempotent reconciliation. The
dashboard does not show that key as the process identity.

## Tags

Tags are process metadata for discovery and grouping. V1 stores free-form
normalized tags. The server trims whitespace, converts tags to lowercase, and
rejects duplicates after normalization.

Repeated tag filters use AND semantics. When the dashboard groups by tag, one
process can appear in several groups. Each row uses the same process ID and
state. Aggregate counts count unique process IDs.

## Process kinds

### Service

A service is a long-running process. It supports Start, Stop, and Restart. It
has at most one active run.

### Task

A task is a one-shot process. It supports Run and Cancel. Each invocation has
its own run. Separate invocations can overlap.

Both kinds use the same labels, tags, declared ports, run history, log capture,
retention, and discovery model.

## Declared port

A declared port records a name, explicit port number, host, protocol hint, and
optional HTTP path. It supports discovery, links, launch substitution, and run
snapshots.

The child process owns its sockets. A declaration does not reserve a port and
does not affect process state.

## Run

A run is one service start or task invocation. It snapshots the label, tags,
kind, command, working directory, environment overrides, declared ports, and
execution limits.

A run records its trigger, timestamps, process identity, exit code, terminal
reason, and log metadata. History remains clear after the process definition
changes or disappears.

## Log record

A log record has a run-local sequence number, receive timestamp, stream,
text, and partial-line marker.

## Service states

```text
                         start
 stopped ─────────────────────────────────▶ starting
    ▲                                           │
    │                         child created     │ launch error
    │                                           ▼
    │              process exit             failed
    │                   ┌───────────────────────┘
    │                   │
    │                running
    │                   │
    │                  stop
    │                   ▼
    └─────────────── stopping
```

The state set is `stopped`, `starting`, `running`, `stopping`, and `failed`.
A missing working directory does not create another durable state. Start or Run
returns `cwd_unavailable`.

Start returns the current run while a service is starting or running. Stop is
idempotent. Concurrent Restart requests join one replacement operation.

## Run states

A run moves through `starting`, `running`, and `stopping`, then reaches
`exited`, `failed`, `canceled`, or `interrupted`.

A child launch moves the run to `running`. A normal exit records the exit code.
A launch error creates a failed run. Port declarations do not determine state.

## Configuration changes during a run

Each run keeps its launch snapshot. An update changes the next run only.
Responses expose `configured` and `active_run.configuration` when they differ.

Clients use active-run ports while the run is active. They use configured ports
when no run is active. Clients label changed configured ports as next-run
values.

## Manifest reconciliation

`proc-man register` reads a process manifest and reconciles entries by:

```text
canonical manifest path
+ process key
```

Registration:

1. Validate the complete manifest.
2. Resolve each relative working directory from the manifest directory.
3. Create or update matching manifest-owned processes.
4. Stop and deregister removed manifest-owned processes.
5. Leave imperative processes unchanged.
6. Return stable process selectors and a change plan.

`proc-man deregister --source` stops active runs and removes current
definitions from that manifest source. Retained runs remain until retention
deletes them, unless the request purges logs.

## Invariants

1. A service has at most one non-terminal run.
2. Every process has one label and one stable ID.
3. Tags are unique within one process after normalization.
4. Every declared port number is explicit.
5. Process state follows the child process group.
6. Every client action uses the daemon API.
7. Every run snapshots its execution configuration.
8. Updating a definition does not change an active run.
9. Removing a definition stops or cancels its active runs.
