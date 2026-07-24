# Domain model and lifecycle

## Aggregate structure

```text
Repository
└── Worktree
    └── Service (one command, one advertised port)
        └── Run
            └── Log record
```

Imperative services may exist without a worktree.

## Entities

### Repository

A local Git repository identity derived from the canonical Git common directory.
Repository name and remote metadata are presentation data, not identity.

### Worktree

A canonical filesystem path belonging to a repository. Its identity is the
combination of repository identity and canonical worktree root. Branch, commit,
manifest path, and display label are observed metadata.

A worktree is `active`, `missing`, or `deleting`.

### Service

The durable desired configuration for one command and one advertised TCP port.
Important attributes are:

- stable identifier and unique name within its worktree;
- configuration source: `manifest` or `imperative`;
- requested and assigned port;
- listen host;
- mode: `proxy` or `handoff`;
- protocol hint: `tcp`, `http`, or `https`;
- optional URL/path metadata;
- command kind and value;
- working directory and environment overrides;
- enablement and timeouts;
- log-retention configuration.

Manifest-owned configuration cannot be edited through service update endpoints.
Lifecycle actions remain allowed.

### Run

One attempt to launch a service. A run snapshots the effective command and
execution configuration so history remains intelligible after an imperative
service is edited or a manifest is reapplied.

It records the trigger, timestamps, backend port if any, PID/process group,
readiness, exit code, error, log metadata, and terminal reason.

### Log record

One tagged process-output record with a run-local monotonically increasing
sequence number, timestamp, stream (`stdout` or `stderr`), text, and partial-line
indicator when applicable.

## Service states

```text
                  enable
 disabled ─────────────────▶ idle
     ▲                        │  ▲
     │ disable                │  │ stop, exit, cancel,
     │                        │  │ startup failure
     │                      trigger
     │                        ▼  │
     └──────────────────── starting
                                │
                              ready
                                ▼
                             running
                                │
                              stop
                                ▼
                             stopping
```

The observable service state set is:

- `disabled`: no listener and no automatic trigger;
- `idle`: armed and waiting for traffic or manual start;
- `starting`: one launch is in progress;
- `running`: the run is ready;
- `stopping`: termination is in progress;
- `failed`: the latest launch failed and relaunch backoff is active;
- `conflict`: the advertised port cannot be bound safely;
- `stale`: the owning worktree path is missing.

Only one run may be starting or running for a service. Concurrent triggers join
the existing startup rather than creating more processes.

### Actions

- **Start** launches immediately, coalescing with an existing launch.
- **Stop** terminates the active run and returns to `idle`.
- **Restart** terminates any active run and launches again, bypassing failure
  backoff.
- **Cancel** terminates the current startup and returns to `idle`.
- **Disable** terminates any active run, closes/disarms the listener, and enters
  `disabled`.
- **Enable** binds the advertised listener and enters `idle`, or `conflict` if
  binding fails.
- **Deregister** stops the service and releases its port. Historical runs remain
  subject to retention unless an explicit purge is requested.

## Run states

A run moves through:

- `starting`;
- `ready`;
- `stopping`;
- one terminal state: `exited`, `failed`, `canceled`, or `interrupted`.

Readiness is successful TCP connection establishment to the command's bind port
within the startup timeout. The default timeout is 60 seconds.

If the command exits before readiness, fails to bind, or exceeds the timeout,
the run is `failed`. Request-driven relaunch uses exponential backoff beginning
at two seconds and capped at 60 seconds. A successful readiness transition or an
explicit Restart resets the backoff.

The daemon never performs an unattended always-restart loop.

## Worktree reconciliation

`worktree apply` is idempotent for the tuple:

```text
canonical Git common directory
+ canonical worktree root
+ service name
```

Applying a manifest:

1. validates the complete document;
2. resolves the worktree and relative working directories;
3. computes the desired set;
4. creates or updates manifest-owned services;
5. retains previous auto-assigned ports for matching services;
6. deregisters manifest-owned services no longer present;
7. leaves imperative services unchanged;
8. reports all changes in human-readable or JSON form.

CLI port overrides are part of that one apply operation. They do not create a
separate persistent override layer.

The daemon periodically checks registered worktree roots. A missing root is
marked `missing`, its processes are stopped, and its listeners are released. If
it returns within 24 hours, the prior enablement state is restored when its ports
can be rebound. After 24 hours the worktree registrations and their logs are
removed.

## Invariants

1. At most one active service owns a given listen-host/advertised-port pair.
2. At most one non-terminal run exists for a service.
3. A proxy-mode daemon owns the advertised listener in `idle`, `starting`, and
   `running`.
4. A handoff-mode daemon does not own the advertised listener while the child is
   expected to own it.
5. A manifest-owned service's configuration changes only through manifest
   reconciliation.
6. CLI and SPA actions go through the daemon API.
7. A public auto-assigned port remains stable until deregistration or explicit
   manifest change.
8. The login shell, working directory, expanded ports, command, and relevant
   environment are snapshotted on each run.

