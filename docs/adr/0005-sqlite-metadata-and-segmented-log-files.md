# ADR 0005: SQLite metadata and segmented log files

- Status: Accepted
- Date: 2026-07-29
- Updated: 2026-08-06

## Context

Port Start needs durable process definitions and run history. Process logs are
large, appended continuously, streamed, searched, and downloaded.

## Decision

- Store structured state and segment metadata in SQLite.
- Enable WAL, foreign keys, a busy timeout, and migrations.
- Store output in per-run append-only NDJSON segments.
- Record sequence, time, stream, and partial-line state.
- Default to 50 MiB per run and 20 runs per process.
- Support byte, count, age, and unlimited retention.
- Search retained files with literal or RE2 matching.
- Stream and download through the daemon.

## Consequences

- High-volume logs do not dominate the SQLite write lock.
- Backups must include the database and log directory.
- Recovery reconciles segment metadata and files.
- Bounded direct scans remain sufficient for V1.
