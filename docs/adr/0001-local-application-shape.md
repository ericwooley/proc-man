# ADR 0001: Local application shape

- Status: Accepted
- Date: 2026-07-24

## Context

The application is a local development tool. It must reserve registered ports,
start commands on demand, expose permanent administration through a CLI and web
application, persist configuration, and retain process logs.

## Decision

- Implement the daemon and CLI in Go.
- Persist durable application data in SQLite.
- Implement the administration UI as a React application built with Vite and
  served as a single-page application.
- Reserve one permanent administration port independently of the managed ports.
- Embed the production frontend and SQLite migrations in the Go binary.
- Make the daemon the sole owner of process and lifecycle state. The CLI and SPA
  are clients of one documented administration API.
- Support Linux and macOS as a per-user local-development service.

## Consequences

- The Go daemon is the authority for process and port state.
- The CLI and SPA should use the same administration API rather than owning
  separate control paths.
- A single installed binary can serve the complete application.
- High-volume process output is not required to be stored in SQLite; ADR 0005
  defines the log boundary.
- Windows and multi-user scheduling are not V1 targets.

## Alternatives considered

### Separate daemon, CLI, and frontend distributions

This allows independent release cycles but makes local installation, version
compatibility, and service management more complicated.

### Electron or another desktop application

A desktop shell could own process state, but it would couple supervision to an
interactive session and weaken CLI-first automation.

### CLI access directly to SQLite

This removes an HTTP round trip but creates multiple lifecycle authorities and
cannot safely coordinate in-memory listeners and processes.

