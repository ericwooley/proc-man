# Testing strategy

## Principles

Most behavior belongs in deterministic modules with plain inputs and outputs.
Socket, process, clock, filesystem, Git, SQLite, authentication entropy, and
service-manager operations are injected boundaries.

The suite follows a testing pyramid:

1. extensive pure/domain tests;
2. focused integration tests with real local boundaries;
3. a small number of end-to-end browser flows.

Bug fixes begin with a failing regression test.

## Pure tests

### Domain and lifecycle

- Every valid and invalid service/run state transition.
- Concurrent trigger coalescing.
- Stop versus disable semantics.
- Restart backoff reset and exponential bounds.
- Three-second handoff reclaim decision.
- Stale-worktree grace and restoration using a fake clock.

### Manifest and reconciliation

- Empty, malformed, unknown, duplicate, and boundary-value fields.
- Exact versus auto ports and stable reapplication.
- Placeholder/environment expansion in proxy and handoff modes.
- Commands containing spaces, quotes, Unicode, empty arguments, and shell
  metacharacters.
- Manifest removal without affecting imperative services.
- Manifest-owned update rejection.
- Dry-run plans matching committed reconciliation.

### Logs and retention

- Interleaved stdout/stderr sequence assignment.
- Partial and oversized lines.
- Segment rotation retaining newest data.
- Combined byte/count/age constraints and unlimited mode.
- Literal and RE2 search, invalid expressions, casing, stream filtering, and
  retention gaps.

### API and authentication

- Error-code/status mapping.
- Password hashing and verification.
- Session expiry and revocation.
- Capability scoping, expiry, and exact-origin checks.
- Stable CLI JSON and exit-code mapping.

## Integration tests

Use temporary data directories, real SQLite databases, loopback sockets, and
small purpose-built helper executables.

Required cases:

- fresh migration, sequential upgrades, WAL settings, and foreign keys;
- second-daemon lock rejection;
- auto-port allocation remains bound and persists;
- exact collision creates a service conflict without stopping administration;
- proxy mode preserves raw bytes, half-closes, WebSockets, and multiple clients;
- one launch serves up to 64 queued connections and rejects overflow;
- HTTP navigation gets the interstitial while POST/API traffic does not;
- proxy readiness forwards queued traffic;
- handoff releases the port for a child that does not set `SO_REUSEADDR`;
- handoff non-navigation HTTP receives `503 Retry-After`;
- handoff port-free stability triggers reclaim after three seconds;
- timeout, early exit, cancellation, and TERM-to-KILL escalation;
- stopping one process group does not signal another;
- daemon restart marks unfinished runs interrupted and does not signal a
  PID-reused process;
- log follow reconnects by sequence and reports retention gaps;
- missing worktree stop, restore, and 24-hour deletion;
- systemd and LaunchAgent render/install adapters through test filesystem and
  command fakes.

Platform-specific process/socket suites run on both Linux and macOS. The Go race
detector covers supervisor, log fan-out, and event broadcasting.

## Frontend tests

React component tests cover:

- dashboard grouping and every service/worktree state;
- manifest-owned read-only messaging;
- one-click service links and Start/Stop All;
- login, logout, and expired sessions;
- log filtering, following, reconnect gaps, and downloads;
- startup interstitial states, live output, Restart, Cancel, failure, cooldown,
  and ready reload.

Contract tests validate frontend-generated types against the checked-in OpenAPI
document.

## End-to-end tests

Keep E2E coverage to critical user journeys:

1. Apply a fixture worktree manifest, open an idle proxy-mode Vite service,
   observe the startup page and logs, and arrive at the Vite app automatically.
2. Start a handoff fixture that must bind its advertised port, observe the
   startup page, reload into the child, stop it, and verify daemon reclamation.
3. Search and download logs from a completed run through both SPA and CLI.
4. Stop All and Start All a multi-service worktree and verify per-service
   partial-failure reporting.

## Acceptance gates

Before release:

- Go unit, integration, race, and static-analysis checks pass.
- Frontend unit tests, typecheck, and production build pass.
- OpenAPI and manifest schema examples validate.
- Linux and macOS service/process tests pass.
- The embedded SPA is served from the release binary.
- CLI help snapshots contain examples, JSON usage, environment variables, exit
  codes, and next actions for every command.

