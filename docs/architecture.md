# Architecture

## System shape

proc-man ships as one Go binary.

The binary has three parts:

1. The service supervises child process groups.
2. The CLI calls the local HTTP API.
3. The embedded React application calls the same API.

```text
CLI ────────┐
            ▼
Browser ─▶ Local API ───────▶ Process supervisor ───────▶ Child process
            │                         │
            ▼                         ▼
          SQLite                  NDJSON logs
```

The service owns registered process and retained run state.
The CLI and React application do not access SQLite directly.
Direct runs create stored audit state without process definitions.

## Local control plane

The service binds `127.0.0.1:13337` by default.
It rejects non-loopback host values.

The server exposes:

- The embedded React application.
- JSON routes under `/api/v1`.
- Process and run events through Server-Sent Events.
- Run log events through Server-Sent Events.
- Health and readiness routes.

A data-directory lock prevents two services from sharing one database.

## Process registry

The process registry is flat.
Each process has an opaque ID, a human label, and zero or more tags.

Labels can repeat.
Tags provide filtering and grouping.
The working directory associates each process with one directory.
Clients can filter or group the flat registry by this value.

Manifest source data records configuration provenance.
Source paths do not create application navigation or API parents.

## Process execution

Direct runs execute one argv command in the invoking directory.
The service starts the command with the caller environment.
The CLI streams retained stdout and stderr records while the command runs.
They wait for completion and return the child exit code.
They do not forward stdin.
They create a run record and log file without a process definition.
An interrupted CLI cancels its active direct run.

A process has kind `service` or `task`.

Services support Start, Stop, and Restart.
One service can have one active run.

Tasks support Run and Cancel.
Separate task runs can overlap.

Each run starts in its own Unix process group.
Stop and Cancel send SIGTERM first.
The supervisor sends SIGKILL after the configured stop limit.

Argv commands preserve argument boundaries.
Shell commands use the configured login shell.

The supervisor adds `PROC_MAN_RUN_ID` to every run.
It adds these environment values to registered runs:

- `PROC_MAN_PROCESS_ID`
- `PROC_MAN_PORT_<NAME>`
- `PROC_MAN_HOST_<NAME>`

Commands can use `{process_id}`, `{definition_id}`, `{run_id}`, and `{port.<name>}` placeholders.
Direct argv values do not expand proc-man placeholders.

## Declared ports

Declared ports are process metadata.
Each port contains a name, host, number, protocol, and optional path.

The application displays HTTP links and copyable TCP addresses.
The supervisor also adds declared values to the run environment.

Lifecycle state comes from the managed child process.
Declared endpoint reachability does not change lifecycle state.

## Persistence

SQLite stores:

- Process definitions and tags.
- Commands, directories, and environment overrides.
- Declared ports.
- Process state.
- Run snapshots and terminal results.

SQLite uses WAL, foreign keys, and a per-connection busy timeout.

Each run writes one append-only NDJSON file.
The file contains ordered stdout and stderr records.

## Recovery

Service startup follows this sequence:

1. Create the data directory.
2. Acquire the data-directory lock.
3. Open and configure SQLite.
4. Mark unfinished runs as interrupted.
5. Reset active process states to stopped.
6. Start the API and application server.

Recovery does not start old services.

## Frontend

The frontend uses React, TypeScript, Vite, and React Router.

The inventory route is `/`.
The process detail route is `/process/:processId`.

The header owns the product brand.
The navigation rail contains only the Processes route.

The production build lives in `internal/web/dist`.
Go embeds this directory into the binary.
