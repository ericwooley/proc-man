# ADR 0005: SQLite metadata and NDJSON run logs

- Status: Accepted
- Date: 2026-07-29
- Updated: 2026-08-06

## Context

proc-man needs durable process definitions and run history.
Process output can grow quickly and arrives while a run is active.

## Decision

- Store structured process and run state in SQLite.
- Enable WAL and foreign keys.
- Apply a busy timeout to every SQLite connection.
- Store each run in one append-only NDJSON file.
- Record sequence, time, stream, text, and partial-line state.
- Read and search retained records through the service.
- Download one run as text or NDJSON.

## Consequences

- Process output does not consume the SQLite write lock.
- Backups must include SQLite and the log directory.
- Deregistered processes keep their run snapshots and log files.
- V1 keeps log files until the user removes the data directory.

## Later work

Automatic retention can add file rotation and cleanup rules.
That work does not change the process registry model.
