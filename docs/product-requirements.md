# Product requirements

## Purpose

proc-man provides one local inventory for development processes.

The product helps a developer find a process, run it, inspect its ports, and read its logs.

Coding agents and scripts can register the same processes through the CLI or API.

## Process registration

- Register one process through the CLI, API, or application.
- Register an imperative command without a manifest file.
- Require a label and process kind.
- Accept zero or more tags.
- Accept an argv command or explicit shell command.
- Store a working directory and environment overrides.
- Store zero or more declared ports.
- Deregister a process by its stable ID.

## Manifest registration

- Read the nearest `.proc-man.yaml` file.
- Apply one manifest idempotently.
- Reconcile entries by manifest path and stable key.
- Remove one manifest source through a command.
- Keep imperative processes outside manifest reconciliation.

## Inventory

- Show the most recently updated processes on the primary page.
- Load older process definitions only after an explicit page action.
- Limit each process page to 25 definitions.
- Search labels, tags, commands, directories, and declared ports.
- Apply inventory search and filters before pagination.
- Filter by process kind.
- Filter by an exact working directory.
- Filter by one or more tags.
- Group matching processes by working directory.
- Group matching processes by tag.
- Show an `untagged` group when required.

## Process details

- Open a stable route for one process.
- Show the label, ID, kind, state, and tags.
- Show the command, directory, environment, and declared ports.
- Show current and retained runs.
- Show full logs for the selected run.
- Filter logs by stream and text.
- Download a selected run.
- Return to the process inventory through the Processes navigation.

## Execution

- Start, stop, and restart a service.
- Keep one active run for each service.
- Run a task.
- Cancel an active task run.
- Keep a snapshot for each run.
- Capture stdout and stderr.
- Start each child in its own process group.
- Start processes only after an explicit action.

## Local service

- Serve the application on `127.0.0.1:13337` by default.
- Bind loopback hosts only.
- Persist process and run state in SQLite.
- Persist run output in NDJSON files.
- Install as a Linux systemd user service.
- Install as a macOS LaunchAgent.

## Worktree use case

A worktree hook can run `proc-man register`.
The manifest can add project, branch, or purpose tags.

A removal hook can run `proc-man deregister`.
The hook passes the manifest source before removing the directory.

Worktrees remain an automation context.
The process registry remains the product model.

## V1 limits

- Linux and macOS only.
- One operating-system user.
- One local host.
- No automatic service restart policy.
- No process dependency graph.
- No external process attachment.
- No remote control plane.
- No deployment workflow.
