# ADR 0001: Local application shape

- Status: Accepted
- Date: 2026-07-29
- Updated: 2026-08-06

## Context

Port Start must provide permanent local process administration through a CLI
and web application. It must supervise process groups, persist configuration,
and retain logs.

The same lifecycle rules must apply to people, coding agents, scripts, and
browser sessions.

## Decision

- Implement the daemon and CLI in Go.
- Persist structured state in SQLite.
- Implement the UI in React and Vite.
- Reserve one administration port.
- Embed frontend assets and migrations in the Go binary.
- Make the daemon the only owner of process and run state.
- Make the CLI and SPA clients of one API.
- Support Linux and macOS as per-user services.

## Consequences

- Process supervision continues after a CLI or browser session closes.
- The CLI and SPA use the same validation and lifecycle behavior.
- One installed binary serves the application.
- High-volume output stays outside SQLite.

## Alternatives

Separate distributions add installation and version work. A desktop authority
cannot provide reliable background supervision. Direct SQLite access creates
several lifecycle authorities.
