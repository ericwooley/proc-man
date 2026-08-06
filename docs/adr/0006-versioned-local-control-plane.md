# ADR 0006: Versioned local control plane

- Status: Accepted
- Date: 2026-07-29
- Updated: 2026-08-06

## Context

The CLI and React application need the same process lifecycle rules.
Direct database access would create separate authorities.

## Decision

- Serve one JSON API under `/api/v1`.
- Bind the administration server to loopback hosts only.
- Make the CLI and React application API clients.
- Use opaque process, endpoint, and run IDs.
- Publish lifecycle events through Server-Sent Events.
- Publish live run records through a separate event route.
- Expose health, readiness, settings, and OpenAPI routes.

## Consequences

- The CLI and application share state and errors.
- Automation can use stable JSON without reading SQLite.
- React Router routes can refresh through the embedded SPA fallback.
- Local clients require no credential configuration.

V1 remains local development only.
