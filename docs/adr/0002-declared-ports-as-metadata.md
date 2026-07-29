# ADR 0002: Declared ports are process metadata

- Status: Accepted
- Date: 2026-07-29

## Context

Agent-created worktrees commonly assign different ports to otherwise identical
development processes. Those values are difficult to rediscover later, yet the
process itself is already responsible for binding and serving its endpoints.

Port Start needs enough port information to show useful links, explain a
worktree's configuration, populate launch arguments, and preserve intelligible
run history. Treating a port as a daemon-owned network resource would couple
process management to application traffic and socket behavior.

Some processes expose several endpoints, such as an application server,
debugger, metrics server, or inspector. Others expose none.

## Decision

- Let each process definition declare zero or more named TCP ports.
- Require every declaration to contain an explicit port number.
- Store host, protocol hint, and optional HTTP(S) path with each port.
- Use declarations for inventory, links, launch-time placeholders, environment
  variables, and run snapshots.
- Keep process lifecycle independent of endpoint reachability.
- Allow overlapping declarations and return a deterministic warning naming the
  affected definitions.
- Make the launched process and operating system authoritative for socket
  availability.

## Consequences

- Port Start has no application traffic path or per-process socket lifecycle.
- A process can expose several useful links without splitting into artificial
  definitions.
- Registration remains deterministic and does not depend on current machine
  socket state.
- A displayed endpoint may be unavailable while its process is stopped,
  starting internally, misconfigured, or failed after launch; logs and process
  state remain the diagnostic sources.
- Worktree tooling chooses port values before registration and can pass them
  through generated manifests.
- Overlap warnings help find likely mistakes without claiming exclusive
  ownership of an address.

## Alternatives considered

### Reserve every declared address

Reservation makes a declaration appear authoritative but prevents the child
from binding the same address and introduces a network data plane outside the
process-manager goal.

### Allocate an available port during registration

Allocation creates an ownership expectation and a race between selection and
child launch. Explicit worktree configuration keeps the source of truth clear.

### Infer ports from running processes

Operating-system inspection is platform-specific, incomplete for stopped
processes, and cannot preserve intended links before launch.

### Limit each process to one port

This keeps the schema smaller but misrepresents ordinary development processes
that expose application, debug, or metrics endpoints together.
