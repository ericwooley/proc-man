# ADR 0002: Declared ports are process metadata

- Status: Accepted
- Date: 2026-07-29
- Updated: 2026-08-06

## Context

Development processes often use custom ports. Users need to find those values
later. The child process already owns its listeners.

## Decision

- Let each process declare zero or more named ports.
- Require an explicit port number.
- Store host, protocol, and optional HTTP path.
- Use declarations for inventory, links, launch values, and run snapshots.
- Keep lifecycle independent of endpoint reachability.
- Permit overlapping declarations with a deterministic warning.
- Keep the child and operating system authoritative for sockets.

## Consequences

- Port Start has no traffic path or socket lifecycle.
- Registration does not depend on current socket state.
- One process can show several endpoints.
- Logs and process state remain the diagnostic sources.

## Alternatives

Port reservation prevents the child from binding the same address. Automatic
allocation creates ownership and race concerns. Process inspection cannot show
intended ports for stopped processes.
