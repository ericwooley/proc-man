# Domain model and lifecycle

## Aggregate structure

```text
Repository
└── Worktree
    ├── Process definition
    │   ├── Declared port
    │   └── Run
    │       └── Log record
    └── Command definition
        └── Run
            └── Log record
```

Standalone imperative definitions may exist without a worktree.

## Entities

### Repository

A local Git repository identity derived from the canonical Git common directory.
Repository name and remote metadata are presentation data, not identity.

### Worktree

A canonical filesystem path belonging to a repository. Its identity is the
combination of repository identity and canonical worktree root. Branch, commit,
manifest path, and display label are observed metadata.

A worktree is `active`, `missing`, or `deleting`.

### Process definition

The durable configuration for one named, supervised, long-running command.
Important attributes are:

- stable identifier and unique name within its worktree;
- configuration source: `manifest` or `imperative`;
- command kind and value;
- working directory and environment overrides;
- zero or more named declared ports;
- stop timeout and log-retention configuration.

Manifest-owned configuration changes through worktree registration.
Lifecycle actions remain available from every client.

### Command definition

The durable configuration for a named one-shot action such as `test`, `migrate`,
or `seed`. It contains a command, working directory, environment overrides,
optional execution timeout, and log-retention policy. Each invocation creates an
independent run and may be canceled while active.

### Declared port

A named endpoint that a process is configured to use. It records an explicit
port number, host, protocol hint (`tcp`, `http`, or `https`), and optional URL
path.

The declaration supports discovery, links, and launch-time substitution. Socket
availability and ownership remain properties of the launched application and
operating system.

### Run

One process start or command invocation. A run snapshots the effective command,
working directory, environment overrides, declared ports, and execution
configuration so history remains intelligible after re-registration.

It records the trigger, timestamps, PID/process group, exit code, error, terminal
reason, and log metadata.

### Log record

One tagged process-output record with a run-local monotonically increasing
sequence number, timestamp, stream (`stdout` or `stderr`), text, and partial-line
indicator when applicable.

## Process states

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

The observable state set is:

- `stopped`: registered with no active run;
- `starting`: one launch is in progress;
- `running`: the managed process group is alive;
- `stopping`: termination is in progress;
- `failed`: the latest launch could not create a running process;
- `stale`: the owning worktree path is missing and new starts are blocked.

At most one active run exists for a process definition. Concurrent Start actions
for a process that is `starting` or `running` return the existing run rather
than launching duplicates.

### Process actions

- **Start** behaves by current state:
  - from `stopped` or `failed`, create a new run;
  - from `starting` or `running`, return the existing run unchanged;
  - from `stopping`, return `invalid_state` so the caller can retry after the
    process reaches `stopped`;
  - from `stale`, return `worktree_stale`.
- **Stop** begins termination from `starting` or `running`, returns the existing
  stop operation from `stopping`, and succeeds without changing state from
  `stopped`, `failed`, or `stale`.
- **Restart** creates a new run from `stopped` or `failed`; from `starting`,
  `running`, or `stopping`, it waits for termination and then creates one new
  run; concurrent Restart requests for the same current run join that one
  restart operation; from `stale`, Restart returns `worktree_stale`.
- **Deregister** stops the process and removes its active definition.

### Command actions

- **Run** creates a new command invocation.
- **Cancel** terminates one active invocation.
- **Deregister** cancels every active invocation, then removes the current
  command definition.

Command invocations do not change a process definition's state.

## Configuration changes during a run

Every run uses the configuration snapshot taken when it launched. Updating an
imperative definition or re-registering a manifest-owned definition stores the
configuration for the next run and does not alter or stop an active run.

While a process is active, status responses expose both:

- `active_run.configuration`, including the ports and command used by the
  running process; and
- `configured`, the definition that the next run will use.

CLI and dashboard links use the active run's declared ports while a process is
`starting`, `running`, or `stopping`. They use the configured definition while
the process is `stopped`, `failed`, or `stale`. When the values differ, clients
label the configured values as pending the next start.

## Run states

A run moves through:

- `starting`;
- `running`;
- `stopping`;
- one terminal state: `exited`, `failed`, `canceled`, or `interrupted`.

Successful child creation moves a run to `running`. A normal process exit records
its exit code and returns a process definition to `stopped`. A launch error
creates a failed run. Port declarations do not determine run state.

The daemon does not relaunch a process after exit. A new run always follows an
explicit action.

## Worktree reconciliation

`worktree register` is idempotent for the tuple:

```text
canonical Git common directory
+ canonical worktree root
+ definition kind
+ definition name
```

Registration:

1. validates the complete manifest;
2. resolves the worktree and relative working directories;
3. computes the desired process, command, and declared-port set;
4. creates or updates matching manifest-owned definitions;
5. stops and deregisters manifest-owned definitions no longer present;
6. leaves imperative definitions unchanged;
7. reports all changes in human-readable or JSON form.

The daemon periodically checks registered worktree roots. A missing root is
marked `missing` and its managed processes and command invocations are stopped.
If it returns within 24 hours, the prior registration becomes active again.
After 24 hours the registration and retained logs are removed.

## Invariants

1. At most one non-terminal run exists for a process definition.
2. Every process port name is unique within that process.
3. Every declared port is explicit; registration does not synthesize a value.
4. Process state follows the managed process group rather than endpoint state.
5. A manifest-owned definition changes only through worktree registration.
6. CLI and SPA actions go through the daemon API.
7. Every run snapshots its command, working directory, declared ports, and
   relevant environment overrides.
8. Deregistering a worktree stops every active run associated with it.
9. Updating a definition never changes the configuration snapshot of an active
   run.
