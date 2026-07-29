# ADR 0001: Local application shape

- Status: Accepted
- Date: 2026-07-29

## Context

Port Start is a local development tool for registering and operating processes
associated with Git worktrees. It must provide permanent administration through
a CLI and web application, supervise process groups, persist configuration, and
retain process logs.

The same lifecycle rules must apply whether an action comes from a person,
worktree hook, coding agent, CLI script, or browser session.

## Decision

- Implement the daemon and CLI in Go.
- Persist durable application data in SQLite.
- Implement the administration UI as a React application built with Vite and
  served as a single-page application.
- Reserve one permanent administration port for the control plane.
- Embed the production frontend and SQLite migrations in the Go binary.
- Make the daemon the sole owner of managed-process and run state.
- Make the CLI and SPA clients of one documented administration API.
- Support Linux and macOS as a per-user local-development service.

## Consequences

- Process supervision and log capture continue when the interactive dashboard
  and launching CLI session close.
- The CLI and SPA observe the same validation and lifecycle behavior.
- A single installed binary serves the complete application.
- High-volume process output is stored outside SQLite according to ADR 0005.
- Windows and multi-user scheduling remain outside V1.

## Alternatives considered

### Separate daemon, CLI, and frontend distributions

Independent release cycles add local installation and version-compatibility
work without improving the single-user workflow.

### Desktop application as the lifecycle authority

An interactive desktop session would make background process supervision and
CLI-first worktree hooks less reliable.

### CLI access directly to SQLite

Direct database writes create several lifecycle authorities and cannot safely
coordinate active process groups or live log streams.
