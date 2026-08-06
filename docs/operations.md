# Operations and installation

## Supported platforms

V1 supports Linux and macOS.

- Linux uses a systemd user unit.
- macOS uses a per-user LaunchAgent.
- Process supervision uses Unix process groups.

## Data locations

### Linux

- Configuration: `${XDG_CONFIG_HOME:-$HOME/.config}/port-start/config.yaml`
- Database: `${XDG_DATA_HOME:-$HOME/.local/share}/port-start/`
- Logs: `${XDG_STATE_HOME:-$HOME/.local/state}/port-start/logs/`

### macOS

- Configuration and database:
  `$HOME/Library/Application Support/port-start/`
- Logs: `$HOME/Library/Logs/port-start/`

`PORT_START_DATA_DIR` or `serve --data-dir` overrides the database, lock, and
run-log root. Credential files use user-only permissions.

## Configuration precedence

1. Command flag.
2. `PORT_START_*` environment variable.
3. Configuration file.
4. built-in default.

Important settings include the administration endpoint, data directory, login
shell, stop limit, task limit, and retention defaults.

## User-service installation

```sh
port-start daemon install --now
```

The installer writes a systemd user unit or LaunchAgent, reloads the service
manager, and verifies readiness when `--now` is true.

Uninstall preserves configuration, SQLite, and logs. `--purge --yes` removes
application data.

## Login shell

The default launch shell is the account login shell. Argv commands use a wrapper
that initializes the profile and then preserves argument boundaries. Shell
strings use explicit shell parsing.

Profile output becomes run output. A blocking or interactive profile causes a
run error.

## Password operation

Authentication is disabled by default.

```sh
port-start auth set-password
port-start auth clear-password
```

The daemon stores an Argon2id hash. A password change revokes all sessions.
Non-loopback access without authentication shows a persistent warning.

## Manifest automation

Any directory can contain `.port-start.yaml`.

```sh
cd /path/to/source
port-start register --json
```

Removal automation uses the source path:

```sh
port-start deregister --source "$PWD/.port-start.yaml" --json
```

This pattern works for Git worktrees, ordinary repositories, generated
directories, and local tools. Port Start stores process records, not worktree
records.

## Startup and recovery

Startup:

1. Check data-directory permissions.
2. Acquire the daemon lock.
3. Apply SQLite migrations.
4. Reconcile unfinished runs.
5. Load processes, tags, runs, and declared ports.
6. Bind the administration endpoint.
7. Start retention.
8. reports ready.

An unclean exit marks unfinished runs interrupted. The daemon verifies process
identity before it signals a stored process group. Recovery never starts a
service automatically.

## Missing working directories

Port Start keeps a process registered when its configured directory disappears.
Start and Run return `cwd_unavailable`. The process remains visible by label and
tags so the user can inspect its configuration and retained logs.

Automation should deregister obsolete processes explicitly.

## Graceful shutdown

The daemon rejects new runs, terminates managed process groups, waits for stop
limits, flushes logs and SQLite, and exits.
