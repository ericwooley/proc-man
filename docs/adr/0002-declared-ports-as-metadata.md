# ADR 0002: Declared ports are process metadata

- Status: Accepted
- Date: 2026-07-29
- Updated: 2026-08-06

## Context

Development processes often use custom ports.
Users need to find those values later.

## Decision

- Let each process declare zero or more named ports.
- Require an explicit port number.
- Store host, protocol, and optional HTTP path.
- Use declarations for inventory, links, launch values, and run snapshots.
- Keep lifecycle independent of endpoint reachability.
- Permit overlapping declarations.

## Consequences

- One process can show several endpoints.
- Logs and process state remain the diagnostic sources.
- The child command binds its required sockets.

## Alternatives

Port allocation adds configuration that proc-man does not need.
Explicit declarations remain visible for stopped processes.
