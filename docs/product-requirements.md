# Product requirements

## Purpose

Port Start makes agent-created development worktrees easy to find and operate.
A worktree registers its named processes, optional one-shot commands, and the
ports each process expects to use. The registration becomes a durable inventory
available from a CLI, HTTP API, and browser dashboard.

Developers can start, stop, and restart supervised processes; run registered
commands; inspect current state; open declared HTTP endpoints; and search,
follow, or download captured output without first reconstructing how a
worktree was configured.

## Users

The primary user is a developer running Port Start as their own operating-system
user on a Linux or macOS workstation. Automated coding agents and worktree
creation scripts are first-class clients. V1 is single-user and single-host.

## Required capabilities

### Worktree registration

- Register a Git worktree from a checked-in `.port-start.yaml`.
- Make registration idempotent so creation hooks can call it repeatedly.
- Deregister a worktree explicitly from its removal hook.
- Group registered processes, commands, declared ports, runs, and logs by Git
  repository and worktree.
- Detect missing worktree paths, stop their active processes, and remove their
  registration after a 24-hour grace period.
- Support standalone imperative registrations for tools that are not associated
  with a Git worktree.

### Managed processes

- Register, inspect, update, start, stop, restart, and deregister a named
  long-running process.
- Execute each process in its configured worktree directory and login-shell
  environment.
- Run each process in its own process group and terminate the group predictably.
- Keep at most one active run for a process definition.
- Report process state independently of declared-port state.
- Start processes only through an explicit CLI, API, or dashboard action.
- Start or stop all processes belonging to a worktree concurrently.

### Registered commands

- Register named one-shot commands such as `test`, `migrate`, or `seed`.
- Execute and cancel a command from the CLI, API, or dashboard.
- Preserve each invocation as a distinct run with its own status and logs.
- Allow independent command invocations without changing long-running process
  state.

### Declared ports

- Allow each process to declare zero or more named TCP ports.
- Require explicit port numbers; registration does not allocate ports.
- Store host, protocol, and optional URL path metadata for discoverability.
- Display copyable addresses and browser links in the CLI and dashboard.
- Expose declared values to the launched process through explicit placeholders
  and environment variables.
- Treat declarations as process configuration: the launched process remains the
  socket owner and determines whether each endpoint is available.

### Administration

- Provide a permanent administration server at `127.0.0.1:13337` by default.
- Serve a React/Vite SPA and a documented, versioned JSON API.
- Provide a scriptable Go CLI with stable JSON output and complete help suitable
  for humans and automated agents.
- Support an optional administration password and configurable bind host.
- Install and operate as a systemd user service on Linux or a LaunchAgent on
  macOS.

### Logs

- Capture stdout and stderr for every managed process and registered-command
  invocation with ordering metadata.
- Stream current output, search retained output with literal or regular
  expression matching, and download it as text or structured records.
- Retain multiple runs and support configurable size, count, age, and unlimited
  retention policies.

## Success criteria

Port Start is successful when all of the following are true:

1. A worktree-creation hook can run one idempotent registration command and
   receive its worktree, process, command, and declared-port inventory as JSON.
2. A developer can identify and open the HTTP endpoint for any registered
   worktree without inspecting its scripts or environment.
3. A developer can start, stop, and restart a worktree process from both the CLI
   and dashboard.
4. A developer can run a registered one-shot command and inspect its result.
5. Current and historical logs remain visible and searchable from the CLI and
   dashboard.
6. A worktree-removal hook can deregister the worktree, stop its managed
   processes, and release its durable configuration.
7. A daemon restart restores registrations and run history while accurately
   marking previously active runs as interrupted.

## Non-goals for V1

- Windows support.
- Multi-user isolation or permissions.
- Remote orchestration across machines.
- Containers, Kubernetes, or production workload scheduling.
- Process dependency graphs or ordered worktree startup.
- Automatic restart policies.
- Attaching to processes that were started outside Port Start.
- Port allocation, listener ownership, traffic handling, or application
  readiness inference.
- TLS termination for managed endpoints or the administration server.
- Editing manifest-owned definitions from the SPA or direct update commands.
