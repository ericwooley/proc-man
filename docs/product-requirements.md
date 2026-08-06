# Product requirements

## Purpose

Port Start provides one local inventory for development processes. Each process
has a label, tags, execution configuration, runs, and retained logs. A process
can be a long-running service or a one-shot task.

Developers and automation can register processes, find them without knowing
their source directory, execute them, inspect declared ports, and read current
or historical logs.

Git worktrees are one source of process registrations. They do not create a
separate resource, page, or ownership hierarchy.

## Users

The primary user is a developer who runs Port Start under one operating-system
account on Linux or macOS. Coding agents and local automation are supported
clients. V1 is single-user and single-host.

## Required capabilities

### Process registration

- Register one process through the CLI or API.
- Apply a versioned process manifest idempotently.
- Deregister one process or all processes from one manifest source.
- Require a human label and accept zero or more tags.
- Keep labels non-unique and use opaque IDs for actions.
- Preserve manifest or imperative source metadata for configuration changes.
- Keep source metadata out of primary navigation, filtering, and grouping.

### Inventory

- List all registered processes in one primary view.
- Search labels, tags, declared ports, and launch metadata.
- Filter by multiple tags, kind, state, and attention state.
- Group matching processes by tag.
- Show one process in each matching tag group when grouping is active.
- Keep every repeated row connected to the same stable process ID.
- Show an `untagged` group for processes without tags.

### Execution

- Support `service` and `task` process kinds.
- Start, stop, and restart a service.
- Allow at most one active service run.
- Run a task and cancel one active task run.
- Preserve each task invocation as an independent run.
- Start processes only through an explicit CLI, API, or dashboard action.
- Run every child in its own process group.
- Execute each child in its configured directory and login-shell environment.

### Labels and tags

- Require a label from 1 through 120 Unicode characters.
- Allow duplicate labels.
- Accept up to 32 tags per process.
- Store tags as unique lowercase strings after trimming whitespace.
- Limit each tag to 63 characters.
- Allow letters, numbers, period, underscore, hyphen, and colon.
- Let the dashboard suggest existing tags without constraining new tags.
- Apply repeated tag filters with AND semantics.

### Declared ports

- Allow each process to declare zero or more named TCP ports.
- Require explicit port numbers.
- Store host, protocol, and optional URL path metadata.
- Display copyable addresses and browser links.
- Expose declared values through explicit launch placeholders.
- Keep socket ownership and traffic outside Port Start.

### Logs

- Capture stdout and stderr for every run.
- Stream current output.
- Search retained output by text, tag, process, run state, and time.
- Download one run as text or structured records.
- Support configurable size, count, age, and unlimited retention.

### Administration

- Serve the application at `127.0.0.1:13337` by default.
- Provide a React/Vite SPA and a versioned JSON API.
- Provide a scriptable Go CLI with stable JSON output.
- Support an optional administration password.
- Install as a systemd user service or macOS LaunchAgent.

## Worktree automation use case

A worktree creation hook runs one idempotent manifest command from the new
directory. The manifest registers normal processes and can add tags such as
`project:storefront`, `branch:agent-42`, or `purpose:preview`.

A worktree removal hook deregisters the manifest source before it removes the
directory. No worktree record remains in Port Start.

## Success criteria

1. A user can find any process by label or tags.
2. A user can group the process list by tags.
3. A user can execute a service or task from the CLI and dashboard.
4. A user can inspect current and historical logs for one process.
5. A user can open or copy a declared endpoint.
6. A script can apply and remove a manifest idempotently.
7. A daemon restart restores process definitions and run history.

## Non-goals for V1

- Windows support.
- Multi-user isolation.
- Remote orchestration across machines.
- Containers or production workload scheduling.
- Process dependency graphs.
- Automatic restart policies.
- Attaching to external processes.
- Port allocation, listener ownership, traffic handling, or readiness checks.
- TLS termination.
- A dedicated repository or worktree inventory.
