# ADR 0002: Managed port modes

- Status: Accepted
- Date: 2026-07-24

## Context

Port Start must hold an advertised port while a development server is stopped,
launch it on incoming traffic, and make the traffic reach the new process.

An arbitrary command cannot bind a port already owned by the daemon. Conversely,
not every command can be configured to use a different backend port. Preserving
the first accepted connection during a literal handoff is also unreliable: a
child that does not enable `SO_REUSEADDR` may be unable to bind while that
connection remains open.

The data plane must support protocols beyond HTTP, while providing a useful
browser startup experience for local web applications.

## Decision

Support two explicit modes per service.

### Proxy mode

- It is the default.
- The daemon permanently owns the advertised TCP listener.
- The command receives an assigned loopback backend port.
- The daemon forwards raw TCP after readiness.
- Non-navigation traffic may be queued during startup, with a default limit of
  64 connections and 60-second startup timeout.

### Handoff mode

- It is opt-in for commands that must bind the advertised port.
- The daemon closes accepted connections and its listener before launch.
- The command receives the advertised port.
- TCP/HTTPS clients must retry; non-navigation HTTP receives a retryable 503.
- After readiness, a port that remains free for three seconds is reclaimed and
  any surviving process group is stopped.

For a service declared as plain HTTP, eligible browser navigations receive a
self-contained startup page that streams logs and state, permits Restart or
Cancel, and reloads the original URL at readiness. Other request kinds are never
replaced with HTML.

## Consequences

- Configurable commands get reliable first-connection behavior and protocol
  transparency in proxy mode.
- Hard-coded-port commands remain supported with an explicit retry gap.
- HTTPS is passthrough and cannot display the startup page.
- The daemon needs an HTTP header parser only for declared HTTP services while
  idle/starting; it is not an application-layer reverse proxy when running.
- Backend-port allocation has a small close-before-child-bind race because
  arbitrary commands do not support socket activation.

## Alternatives considered

### Proxy mode only

Simpler and more reliable, but excludes applications that cannot accept an
assigned port.

### Literal handoff only

Allows commands to use the advertised port but introduces refusal windows,
unreliable first requests, and limited visibility while the child owns it.

### Inherited listening file descriptors

This could make handoff atomic but requires every managed application to support
socket activation or a Port Start-specific file-descriptor contract.

### Best-effort connection preservation during handoff

Kernel validation showed the replacement bind can fail when the child does not
use address reuse. A deterministic retry contract is preferable to
application-dependent behavior.

