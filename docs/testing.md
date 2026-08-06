# Testing strategy

## Principles

Deterministic modules own validation and state decisions. Inject process,
filesystem, SQLite, clock, authentication, and service-manager boundaries.

Use this test pyramid:

1. Pure domain tests.
2. Focused integration tests.
3. limited end-to-end tests.

Bug fixes start with a failing regression test.

## Pure tests

### Labels, tags, and inventory

- Label length and Unicode boundaries.
- Duplicate labels with distinct IDs.
- Tag trimming, lowercase normalization, validation, and duplicates.
- Free-form tag creation and existing-tag suggestions.
- Repeated tag filters with AND semantics.
- Search across labels, tags, ports, and launch metadata.
- Tag grouping with repeated process IDs and unique aggregate counts.
- untagged grouping.

### Process lifecycle

- Every service state transition.
- Concurrent Start and Restart coalescing.
- Stop, exit, launch failure, and interruption.
- Task invocation overlap and cancellation.
- Invalid-kind actions.
- Missing working-directory errors.
- configuration updates during active runs.

### Manifest and ports

- Malformed, unknown, duplicate, and boundary fields.
- Process key reconciliation.
- Manifest removal without changing imperative processes.
- Zero, one, and multiple ports.
- Port normalization and overlap warnings.
- Command arguments, shell strings, and placeholders.
- dry-run plans matching committed reconciliation.

### Logs and retention

- Stdout and stderr sequencing.
- Partial and oversized lines.
- Segment rotation.
- Size, count, age, and unlimited retention.
- Literal and RE2 search.
- Label, tag, kind, state, and time filters.
- retention gaps.

### API and authentication

- Stable serialization and errors.
- Password hashing and sessions.
- CLI JSON and exit mapping.
- process, tag, run, and port responses.

## Integration tests

Use temporary data directories, real SQLite, and small helper executables.

Required cases:

- Migrations and daemon lock.
- Imperative registration and deregistration.
- Idempotent manifest reconciliation.
- Argv and shell execution.
- Service Start, Stop, Restart, and process-group termination.
- Overlapping task runs and cancellation.
- Declared-port persistence without socket acquisition.
- Active-run snapshots during updates.
- Restart recovery without relaunch.
- Log follow and retention gaps.
- Missing working-directory errors.
- systemd and LaunchAgent adapters.

Linux and macOS run platform process suites. The Go race detector covers the
supervisor, log fan-out, and event broadcaster.

## Frontend tests

React tests cover:

- One process inventory as the primary screen.
- Label search and tag filters.
- Tag grouping and repeated process identity.
- List-to-detail navigation and browser history.
- Process configuration, ports, environment summary, and run history.
- Service and task actions.
- Declared endpoints.
- Full logs, stream filters, search, follow, and downloads.
- Manifest-owned messages.
- Empty, loading, error, and daemon-unavailable states.
- keyboard, focus, and responsive behavior.

## End-to-end tests

1. Register a service, filter it by tag, start it, inspect logs, and stop it.
2. Register a task, run it, cancel another run, and inspect history.
3. Group processes by tag and verify repeated rows use one process ID.
4. Open one process, select a retained run, filter its streams, and search logs.
5. Return to the inventory and verify that its filters remain.
6. Search and download logs from a completed run.
7. Apply and remove a manifest source.

## Acceptance gates

- Go unit, integration, race, and static checks pass.
- Frontend tests, typecheck, and build pass.
- OpenAPI and manifest examples validate.
- Linux and macOS service tests pass.
- The release binary serves the SPA.
- CLI help includes examples, JSON, environment variables, errors, and next
  actions.
