# Domain model

## Process

A process is a durable executable definition.

```text
Process
├── id and selector
├── label
├── tags
├── kind
├── state
├── source
├── command
├── working directory
├── environment overrides
└── declared ports
```

The process ID is the action selector.
The label is human text and can repeat.

The process kind is `service` or `task`.

The process state is:

- `stopped`
- `starting`
- `running`
- `stopping`
- `failed`

## Command

A command uses one representation:

- An argv array.
- An explicit shell string.

The working directory must exist when a run starts.
The process remains registered when its directory disappears.
Start and Run return `cwd_unavailable` when the directory is missing.

## Declared port

A declared port has:

- An opaque endpoint ID.
- A name that is unique within the process.
- A host.
- An integer port from 1 through 65535.
- A protocol of `tcp`, `http`, or `https`.
- An optional HTTP path.

Declared ports remain visible when the process is stopped.

## Run

A run represents one service start or task execution.

A run stores:

- An opaque run ID.
- The current process ID when the definition still exists.
- A complete process snapshot.
- State and process ID.
- Start and end times.
- Exit code and error text.
- Log file path.

Run states are:

- `starting`
- `running`
- `stopping`
- `exited`
- `failed`
- `canceled`
- `interrupted`

Terminal run states keep their history.
Deregistering a process keeps its run snapshots.

## Service lifecycle

```text
stopped → starting → running → stopping → stopped
                     │
                     └───────────────→ failed
```

Start creates a run.
Stop signals the active process group.
Restart stops the active run and creates a new run.

## Task lifecycle

Run creates an independent run.
Cancel signals one active task run.

The process state returns to stopped after a task ends.
Run history shows the result of each invocation.

## Tags

The server trims and lowercases tags.
Each process stores a unique tag set.

Repeated tag filters use AND behavior.
Tag grouping can show one process in several groups.

## Source

An imperative process has source kind `imperative`.

A manifest process has:

- Source kind `manifest`.
- A canonical manifest path.
- A stable manifest key.

The source controls manifest reconciliation.
The source does not control process navigation.
