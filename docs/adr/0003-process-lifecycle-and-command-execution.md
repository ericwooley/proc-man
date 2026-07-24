# ADR 0003: Process lifecycle and command execution

- Status: Accepted
- Date: 2026-07-24

## Context

Development servers often spawn child processes, use shell-initialized
toolchains, and exit or temporarily release their port. Port Start must remain
predictable when commands fail, users stop them, the daemon upgrades, or a
worktree disappears.

The daemon normally starts from a user service manager, whose environment may
not contain the toolchain paths configured by the developer's shell.

## Decision

- Model one command and one advertised port as one service.
- Launch on demand from traffic or explicit action.
- Do not restart automatically after exit. Re-arm and wait for new traffic or
  an explicit start.
- Apply failed-launch exponential backoff from two to 60 seconds.
- Define Stop as termination followed by armed idle; define Disable as
  termination and disarming.
- Run every command in its own process group.
- On stop, send SIGTERM, wait ten seconds by default, then SIGKILL.
- Terminate all managed process groups on intentional daemon shutdown.
- Start and stop worktree services concurrently, without dependency ordering.
- Run through the user's login shell. Preserve argv boundaries with an
  `exec "$@"` wrapper; permit shell parsing only through an explicit shell-string
  command.
- Expose the selected bind port through `{port}` and `PORT`, plus namespaced
  execution variables.
- For handoff, reclaim a previously ready port after it remains free for three
  seconds, even if a wrapper process remains alive.

## Consequences

- User actions have separate, unsurprising meanings: Stop does not permanently
  disable one-click startup.
- Process groups cover ordinary child trees without requiring command-specific
  adapters.
- Double-forked or independently daemonized children are outside the supported
  supervision contract.
- Login-shell initialization makes language version managers available but can
  add output or delay; broken interactive-only profiles surface in the run log.
- Worktree Start All may partially succeed, so aggregate actions must report a
  result for every service.

## Alternatives considered

### Always restart

Useful for production supervisors, but conflicts with on-demand local resource
use and can create unattended crash loops.

### Stop also disables

Reduces the action set but makes a normal process stop unexpectedly remove
on-demand behavior.

### Inherit only the service-manager environment

More deterministic, but frequently omits `node`, `npm`, language managers, and
other tools a developer expects from their login environment.

### Snapshot the applying CLI's environment

Improves immediate fidelity but persists secrets and stale environment values in
the database.

