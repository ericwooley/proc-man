# ADR 0003: Explicit process lifecycle and command execution

- Status: Accepted
- Date: 2026-07-29

## Context

Development worktrees contain both long-running processes and useful one-shot
commands. They often spawn child processes and rely on shell-initialized
toolchains. Port Start must make both execution styles easy to invoke and
diagnose while keeping lifecycle behavior predictable.

The daemon normally starts from a user service manager, whose environment may
not contain the toolchain paths configured by the developer's shell.

## Decision

- Model a named long-running executable as a process definition.
- Model a named one-shot executable as a command definition.
- Start every process and command only through an explicit control-plane action.
- Permit at most one active run for a process definition and coalesce concurrent
  Start requests.
- Give every command invocation an independent run.
- Do not restart a process automatically after exit or daemon recovery.
- Define Stop as termination of an active process run.
- Define Restart as termination followed by a new process run.
- Define Cancel as termination of one command invocation.
- Run every child in its own process group.
- On termination, send SIGTERM, wait ten seconds by default, then SIGKILL.
- Terminate managed process groups on intentional daemon shutdown.
- Start and stop worktree processes concurrently, without dependency ordering.
- Run through the user's login shell. Preserve argv boundaries with an
  `exec "$@"` wrapper and permit shell parsing only through an explicit
  shell-string command.
- Expose worktree, definition, run, and named declared-port values through
  explicit placeholders and namespaced environment variables.

## Consequences

- A process never starts because another application contacted one of its
  declared endpoints.
- One-shot tasks receive the same log capture, cancellation, and history as
  long-running processes.
- Process groups cover ordinary child trees without requiring
  command-specific adapters.
- Double-forked or independently daemonized children remain outside the
  supported supervision contract.
- Login-shell initialization makes language version managers available but can
  add output or delay; profile failures surface in the run log.
- Worktree-wide operations may partially succeed, so aggregate actions report a
  result for every process.

## Alternatives considered

### Long-running processes only

This handles development servers but leaves tests, migrations, and setup tasks
outside the worktree inventory and log experience.

### Execute one-shot commands directly in the CLI

Direct execution loses durable run identity, shared cancellation, background
operation, and consistent log access from the dashboard.

### Automatic restart

Production-style restart policies can create unattended crash loops and obscure
the explicit local-development action that produced a run.

### Inherit only the service-manager environment

The daemon's stable environment frequently omits language runtimes and tools a
developer expects from their login environment.

### Snapshot the registering CLI's environment

Persisting the caller's environment captures secrets and becomes stale as the
developer changes shell configuration.
