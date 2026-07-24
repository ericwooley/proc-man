# ADR 0005: SQLite metadata and segmented log files

- Status: Accepted
- Date: 2026-07-24

## Context

Port Start needs durable configuration and run history in SQLite, but process
logs can be large, continuously appended, streamed, searched, and downloaded.
Putting every output chunk into the same SQLite database would increase write
contention and make database growth and backup behavior surprising.

Logs still need stdout/stderr identity, useful ordering, bounded retention, and
restart-safe cursors.

## Decision

- Store structured durable application state and log-segment metadata in SQLite.
- Enable WAL, foreign keys, a busy timeout, and embedded migrations.
- Store process output in per-run append-only NDJSON segments.
- Assign a sequence, receive timestamp, stream tag, and partial-line marker to
  each record.
- Retain the newest output when per-run size limits rotate old segments.
- Default to 50 MiB per run and 20 runs per service.
- Support independently configurable maximum bytes, run count, maximum age, and
  explicit unlimited retention.
- Search retained files directly with literal or RE2 matching; do not add a V1
  full-text index.
- Stream and download through the daemon rather than exposing filesystem paths.

## Consequences

- High-volume logs do not dominate SQLite's write lock.
- Database-only backup does not include process logs; operational backup must
  include the application state/log directory.
- Segment metadata and files require recovery reconciliation after an unclean
  exit.
- Cross-stream order means daemon receive order, not a stronger kernel-provided
  guarantee.
- Bounded files make direct scans acceptable for V1.

## Alternatives considered

### Store all output chunks in SQLite

Creates one backup artifact but increases write amplification, database size,
and contention with lifecycle/configuration updates.

### Plain combined log file

Simple, but loses reliable stdout/stderr tags and stable record cursors.

### Files plus full-text index

Improves repeated search latency but adds index synchronization, migrations, and
recovery complexity before bounded direct scans have proven insufficient.

