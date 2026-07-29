# ADR 0006: Versioned local control plane

- Status: Accepted
- Date: 2026-07-29

## Context

Port Start needs consistent administration through a CLI, browser interface, and
automation. Allowing clients to edit SQLite or manage process groups
independently would split authority and create lifecycle races.

Normal operation is local and single-user, but operators may choose another
administration bind host.

## Decision

- Provide one documented JSON control-plane API under `/api/v1`.
- Publish OpenAPI and treat the API and CLI JSON output as supported scripting
  contracts.
- Make the CLI and embedded React SPA ordinary API clients.
- Bind `127.0.0.1:13337` by default and allow explicit host and port override.
- Leave authentication disabled by default on loopback.
- Support an optional password stored as an Argon2id hash.
- Use HttpOnly SameSite sessions for the SPA and short-lived login sessions for
  CLI commands.
- Warn prominently when binding beyond loopback without a password.
- Use SSE for process, run, and live-log updates with cursors and explicit gap
  events.
- Keep TLS deployment outside the V1 server boundary.

## Consequences

- All clients observe the same validation and lifecycle behavior.
- Worktree hooks can rely on a documented JSON contract.
- OpenAPI and CLI help become maintained product interfaces.
- Optional remote binding is appropriate on trusted networks or through an
  external secure tunnel.
- SSE fits state and output streams because they are predominantly
  server-to-client.

## Alternatives considered

### CLI reads SQLite directly

Direct reads and writes cannot coordinate live process groups or in-memory event
streams and create a second lifecycle authority.

### Unix socket for CLI plus HTTP for SPA

Two transports duplicate contracts and do not remove the need for a browser
control plane.

### HTTP Basic authentication

Basic authentication repeatedly transmits the reusable password and provides a
poorer SPA login experience.

### Mandatory built-in TLS for non-loopback

Certificate management expands the local-first V1 operational surface. Trusted
network use and operator-managed secure tunnels remain explicit deployment
choices.
