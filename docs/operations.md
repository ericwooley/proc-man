# Operations and installation

## Supported platforms

V1 supports Linux and macOS.

- Linux service integration uses a systemd user unit.
- macOS service integration uses a per-user LaunchAgent.
- Process supervision uses Unix process groups and SIGTERM/SIGKILL.

Windows is explicitly out of scope.

## Data locations

Defaults:

### Linux

- Configuration:
  `${XDG_CONFIG_HOME:-$HOME/.config}/port-start/config.yaml`
- Database and lock:
  `${XDG_DATA_HOME:-$HOME/.local/share}/port-start/`
- Process logs:
  `${XDG_STATE_HOME:-$HOME/.local/state}/port-start/logs/`

### macOS

- Configuration and database:
  `$HOME/Library/Application Support/port-start/`
- Process logs:
  `$HOME/Library/Logs/port-start/`

`PORT_START_DATA_DIR` or `serve --data-dir` overrides the database, lock, and
process-log root for testing or custom installations. Directories and
credential-bearing files use user-only permissions.

## Configuration precedence

Daemon configuration resolves in this order:

1. explicit command flag;
2. `PORT_START_*` environment variable;
3. configuration file;
4. built-in default.

Important settings include:

- admin host and port;
- data directory;
- login shell;
- global startup/stop limits;
- default log retention;
- worktree-missing scan interval and grace period.

The worktree scan interval defaults to 60 seconds and the missing-path grace
period defaults to 24 hours.

The default administration endpoint is `127.0.0.1:13337`. Managed services also
default to `127.0.0.1`, with explicit per-service override.

## User-service installation

```sh
port-start daemon install --now
```

The installer:

1. resolves the current executable to an absolute path;
2. records the configured admin endpoint, data paths, and login shell;
3. renders the platform service definition;
4. writes it to the user service location;
5. reloads the user service manager;
6. starts and verifies readiness when `--now` is true.

Linux writes `~/.config/systemd/user/port-start.service`. macOS writes
`~/Library/LaunchAgents/dev.port-start.daemon.plist`.

The service definition references the installed executable rather than copying
it. Upgrades replace that executable and then run `port-start daemon restart`.

Uninstall stops and removes the service definition but preserves configuration,
SQLite, and logs. `daemon uninstall --purge` additionally deletes application
data after an explicit confirmation, or noninteractively with `--yes`.

## Login shell

The default launch shell is the account's configured login shell. It may be
overridden in daemon configuration.

Argv commands run through a login-shell wrapper that performs profile
initialization and then `exec`s the exact argument vector. Shell-string commands
run as login-shell programs. This lets systemd/LaunchAgent launches find
developer toolchains normally configured by shell profiles.

Shell initialization output becomes part of the managed run log. A shell profile
that requires an interactive terminal or blocks noninteractive login shells is
an operator configuration error and must surface clearly in startup logs.

## Password operation

Authentication is disabled by default.

```sh
port-start auth set-password
port-start auth clear-password
```

The server stores only an Argon2id password hash. Password changes revoke every
session. A non-loopback `--host` is allowed with or without a password, but the
daemon and dashboard display a persistent high-visibility warning when exposed
without authentication.

Because V1 does not terminate TLS, non-loopback administration is appropriate
only on a trusted local network or behind an operator-managed secure tunnel or
reverse proxy.

## Startup and recovery

Startup proceeds in this order:

1. create and permission-check data directories;
2. acquire the single-daemon lock;
3. open SQLite and apply embedded migrations;
4. reconcile unfinished run/process metadata;
5. bind the admin endpoint;
6. bind enabled managed listeners;
7. start background retention and worktree checks;
8. report ready.

A single service port conflict does not prevent administration from starting.
The service enters `conflict`, and the CLI/SPA show the address and remediation.

After an unclean daemon exit, unfinished runs become `interrupted`. The daemon
validates recorded process identity before signaling a stored process group so
PID reuse cannot target an unrelated process. If identity cannot be validated,
it does not signal; any resulting port ownership is reported as a conflict.

## Worktree disappearance

The daemon checks worktree roots periodically.

- First missing observation: record `missing_since`, stop processes, release
  listeners, and show the worktree as missing.
- Path returns before 24 hours: clear missing state and restore prior enabled
  listeners where possible.
- Missing continuously for 24 hours: remove registrations and purge their logs.

This grace protects against temporary filesystem or mount loss while ensuring
deleted worktrees eventually free their durable state.

## Graceful shutdown

The daemon stops accepting new launches, terminates all managed process groups,
waits for their configured stop timeout, force-kills survivors, flushes log
writers and SQLite, then releases listeners and exits.

Handoff children are not deliberately left behind during an upgrade because
their logs and lifecycle could no longer be supervised safely.
