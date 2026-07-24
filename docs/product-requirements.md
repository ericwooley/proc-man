# Product requirements

## Purpose

Port Start makes local development services available at stable, discoverable
ports without requiring every worktree's processes to run continuously.

A developer registers a port and launch command. Port Start listens while the
command is stopped. Traffic to the port starts the command, presents useful
startup feedback when possible, and eventually reaches the command. A permanent
administration server exposes the same controls through a CLI, HTTP API, and
React single-page application.

Git worktrees are a first-class use case. A worktree can declaratively advertise
its services, including automatically allocated ports, so its links appear in
the dashboard immediately and start with one click.

## Users

The primary user is a developer running Port Start as their own operating-system
user on a Linux or macOS workstation. V1 is single-user and single-host; it is
not a multi-tenant process scheduler.

## Required capabilities

### Managed services

- Register, inspect, update, enable, disable, and deregister a command associated
  with one advertised TCP port.
- Allocate an exact port or an available port automatically.
- Start a command from incoming traffic or an explicit control-plane action.
- Support arbitrary TCP traffic, with optional HTTP or HTTPS metadata for links
  and HTTP-specific startup behavior.
- Support both permanent TCP proxying and literal port handoff. Proxying is the
  default.
- Start, stop, restart, and cancel processes and show their current state.
- Re-arm a stopped or exited service instead of restarting it continuously.
- Start or stop all services belonging to a worktree concurrently.

### Worktrees

- Apply a checked-in `.port-start.yaml` manifest idempotently.
- Discover and group services by Git repository and worktree.
- Keep automatically chosen ports stable across manifest reapplication and
  daemon restart.
- Detect missing worktree paths, stop and disarm their services, and delete them
  after a 24-hour grace period.
- Allow imperative registrations outside a manifest without making
  manifest-managed configuration mutable.

### Startup experience

- For an idle plain-HTTP service, show a self-contained startup page for browser
  navigation requests.
- Stream current startup logs and state to that page.
- Allow Restart and Cancel from the page.
- Reload the originally requested URL after the service accepts connections.
- Do not replace API requests, POST requests, TLS, or arbitrary TCP traffic with
  HTML.

### Administration

- Provide a permanent administration server at `127.0.0.1:13337` by default.
- Serve a React/Vite SPA and a documented, versioned JSON API.
- Provide a scriptable Go CLI with stable JSON output and unusually complete
  help text suitable for both humans and automated agents.
- Support an optional administration password and configurable bind host.
- Install and operate as a systemd user service on Linux or a LaunchAgent on
  macOS.

### Logs

- Capture stdout and stderr with ordering metadata.
- Stream current output, search retained output with literal or regular
  expression matching, and download it as text or structured records.
- Retain multiple process runs and support configurable size, count, age, and
  unlimited retention policies.

## Success criteria

Port Start is successful when all of the following are true:

1. A newly created worktree can run one idempotent CLI command and appear in the
   dashboard with working links.
2. Clicking an idle HTTP service link displays live startup output and then loads
   the service without another manual navigation.
3. A raw TCP client can trigger and use a proxy-mode service without protocol
   translation.
4. A command that must bind its advertised port can run in handoff mode.
5. Process state and historical logs are visible and controllable from both the
   CLI and SPA.
6. A daemon restart restores enabled listeners and stable assigned ports without
   silently remapping them.

## Non-goals for V1

- Windows support.
- Multi-user isolation or permissions.
- Remote orchestration across machines.
- Containers, Kubernetes, or production workload scheduling.
- UDP or Unix-domain-socket triggers.
- Dependency graphs or ordered startup among worktree services.
- Automatic restart without a new request or explicit user action.
- TLS termination for managed services or the administration server.
- Editing manifest-owned service configuration from the SPA or direct service
  update commands.

