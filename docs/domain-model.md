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

The working directory also associates the process with a directory.
Clients can filter or group processes by this exact value.
The directory remains process data and does not become a parent resource.

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

A run represents one service start, registered task execution, or direct command.

A run stores:

- An opaque run ID.
- An optional process ID for registered execution.
- A complete process snapshot.
- State and operating-system process ID.
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

## Direct audit run

A direct audit run has no registered process ID.
Its snapshot uses the `direct` source kind and the `task` process kind.
The snapshot stores the invoking directory and exact argv command.
The audit stores timestamps, terminal state, exit code, and output records.
The caller environment controls execution but does not enter the snapshot.
Clients can filter run history by the exact snapshot directory.

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

Run creates an independent registered task run.
Cancel signals one active registered or direct task run.

The process state returns to stopped after a task ends.
Run history shows the result of each invocation.

## Tags

The server trims and lowercases tags.
Each process stores a unique tag set.

Repeated tag filters use AND behavior.
Tag grouping can show one process in several groups.

## Source

An imperative process has source kind `imperative`.

A direct audit run has source kind `direct`.

A manifest process has:

- Source kind `manifest`.
- A canonical manifest path.
- A stable manifest key.

The source controls manifest reconciliation.
The source does not control process navigation.
