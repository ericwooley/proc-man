# Testing strategy

## Principles

Most behavior belongs in deterministic modules with plain inputs and outputs.
Process, clock, filesystem, Git, SQLite, authentication entropy, and
service-manager operations are injected boundaries.

The suite follows a testing pyramid:

1. extensive pure and domain tests;
2. focused integration tests with real local boundaries;
3. a small number of end-to-end browser flows.

Bug fixes begin with a failing regression test.

## Pure tests

### Domain and lifecycle

- Every valid and invalid process/run state transition.
- Start from stopped, failed, starting, running, stopping, and stale states.
- Concurrent Start coalescing for starting and running processes.
- Stop and Restart behavior from every process state, including concurrent
  requests during stopping.
- Concurrent Restart requests coalescing into one replacement run.
- Stop, Restart, process exit, launch failure, cancel, and interruption.
- Command invocation independence from process state.
- Missing-worktree grace and restoration using a fake clock.

### Manifest and reconciliation

- Empty, malformed, unknown, duplicate, and boundary-value fields.
- Zero, one, and multiple declared ports.
- Port-name normalization and environment-variable collision detection.
- Explicit port range, protocol, host, and URL-path validation.
- Duplicate declared endpoints producing deterministic warnings.
- Named port, worktree, definition, and run placeholder expansion.
- Commands containing spaces, quotes, Unicode, empty arguments, and shell
  metacharacters.
- Manifest removal without affecting imperative definitions.
- Re-registration during an active run preserving the run snapshot while
  exposing next-run configuration.
- Manifest-owned update rejection.
- Dry-run plans matching committed reconciliation.

### Logs and retention

- Interleaved stdout/stderr sequence assignment.
- Partial and oversized lines.
- Segment rotation retaining newest data.
- Combined byte, count, and age constraints plus unlimited mode.
- Literal and RE2 search, invalid expressions, casing, stream filtering, and
  retention gaps.

### API and authentication

- Error-code and status mapping.
- Password hashing and verification.
- Session expiry and revocation.
- Stable CLI JSON and exit-code mapping.
- Worktree, process, command, run, and declared-port serialization.

## Integration tests

Use temporary data directories, real SQLite databases, and small purpose-built
helper executables.

Required cases:

- fresh migration, sequential upgrades, WAL settings, and foreign keys;
- second-daemon lock rejection;
- idempotent registration and explicit deregistration;
- argv and shell execution through a test login shell;
- process Start coalescing and one-active-run enforcement;
- process Stop, Restart, early exit, TERM-to-KILL escalation, and process-group
  isolation;
- independent and overlapping one-shot command invocations;
- command timeout and cancellation;
- named port placeholder and environment expansion;
- standalone definition worktree-root placeholder rejection and environment
  omission;
- declared-port persistence without socket acquisition;
- imperative update during an active run preserving active links and exposing
  pending next-run links;
- daemon restart marking unfinished runs interrupted without relaunching them;
- PID-reuse protection during recovery;
- log follow reconnect by sequence and retention-gap reporting;
- missing worktree stop, restore, and 24-hour deletion;
- systemd and LaunchAgent render/install adapters through test filesystem and
  command fakes.

Platform-specific process suites run on Linux and macOS. The Go race detector
covers the supervisor, log fan-out, and event broadcasting.

## Frontend tests

React component tests cover:

- dashboard grouping and every worktree, process, command, and run state;
- manifest-owned read-only messaging;
- declared endpoint links and copy actions;
- process Start, Stop, Restart, Start All, and Stop All;
- one-shot command Run and Cancel;
- login, logout, and expired sessions;
- log filtering, following, reconnect gaps, and downloads;
- empty, loading, partial-failure, and daemon-unavailable states.

Contract tests validate frontend-generated types against the checked-in OpenAPI
document.

## End-to-end tests

Keep E2E coverage to critical user journeys:

1. Register a fixture worktree, start its web process, open the declared HTTP
   endpoint, follow logs, and stop the process.
2. Run a fixture one-shot test command, observe its output, and inspect its
   terminal result.
3. Search and download logs from a completed run through both SPA and CLI.
4. Start All and Stop All for a multi-process worktree and verify per-process
   partial-failure reporting.
5. Deregister a worktree and verify its active runs stop and its definitions
   leave the current inventory.

## Acceptance gates

Before release:

- Go unit, integration, race, and static-analysis checks pass.
- Frontend unit tests, typecheck, and production build pass.
- OpenAPI and manifest schema examples validate.
- Linux and macOS service/process tests pass.
- The embedded SPA is served from the release binary.
- CLI help snapshots contain examples, JSON usage, environment variables, exit
  codes, and next actions for every command.
