# ADR 0006: Versioned local control plane

- Status: Accepted
- Date: 2026-07-24

## Context

Port Start needs consistent administration through a CLI, browser interface, and
automation. Allowing clients to edit SQLite or manage processes independently
would split authority and create race conditions with listener ownership.

Normal operation is local and single-user, but operators may choose another
admin bind host. The startup interstitial also needs limited cross-origin access
to one service's status and controls.

## Decision

- Provide one documented JSON control-plane API under `/api/v1`.
- Publish OpenAPI and treat the API and CLI JSON output as supported scripting
  contracts.
- Make the CLI and embedded React SPA ordinary API clients.
- Bind `127.0.0.1:13337` by default and allow explicit host/port override.
- Leave authentication disabled by default on loopback.
- Support an optional password stored as an Argon2id hash.
- Use HttpOnly SameSite sessions for the SPA and short-lived login sessions for
  CLI commands.
- Warn prominently when binding beyond loopback without a password.
- Use narrowly scoped, expiring bearer capabilities for startup interstitial
  state/log streaming and Restart/Cancel.
- Use SSE for state and live-log updates with cursors and explicit gap events.
- Do not provide built-in TLS in V1.

## Consequences

- All clients observe the same validation and lifecycle behavior.
- OpenAPI and CLI help become maintained product interfaces.
- Optional remote binding is suitable only for trusted networks or an external
  secure tunnel/proxy.
- Startup-page capabilities require exact-origin CORS handling and careful scope
  tests.
- SSE is sufficient because control streams are predominantly server-to-client;
  WebSockets are unnecessary.

## Alternatives considered

### CLI reads SQLite directly

Cannot coordinate active listeners or in-memory process state and creates a
second lifecycle authority.

### Unix socket for CLI plus HTTP for SPA

Provides a strong local boundary but duplicates transports and does not remove
the need for a web control plane.

### HTTP Basic authentication

Simple, but repeatedly transmits the reusable password and provides a poorer SPA
login experience.

### Mandatory TLS for non-loopback

Safer on untrusted networks but requires certificate configuration outside the
local-first V1 goal. The application warns and documents the trusted-network
boundary instead.

