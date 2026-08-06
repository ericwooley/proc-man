# ADR 0006: Versioned local control plane

- Status: Accepted
- Date: 2026-07-29
- Updated: 2026-08-06

## Context

Port Start needs consistent process administration through a CLI, browser, and
automation. Direct database or process-group access would split authority.

## Decision

- Provide one JSON API under `/api/v1`.
- Publish OpenAPI and stable CLI JSON.
- Make the CLI and SPA API clients.
- Bind `127.0.0.1:13337` by default.
- Support an optional Argon2id password.
- Use HttpOnly SameSite sessions for the SPA.
- Warn on non-loopback access without authentication.
- Use SSE for process, run, and log updates.
- Keep TLS outside V1.

## Consequences

- All clients use the same lifecycle behavior.
- Automation receives a documented contract.
- Optional remote access requires a trusted network or external secure tunnel.
