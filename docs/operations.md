# Operations

## Supported platforms

proc-man supports Linux and macOS.

- Linux uses a systemd user service.
- macOS uses a per-user LaunchAgent.
- Both platforms use Unix process groups.

## Default paths

Linux data:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/proc-man/
```

macOS data:

```text
$HOME/Library/Application Support/proc-man/
```

The data directory contains:

- `state.db`
- `state.db-wal`
- `state.db-shm`
- `daemon.lock`
- `logs/`

Use `proc-man serve --data-dir PATH` to select another data directory.

## Foreground service

```sh
proc-man serve
```

Useful flags:

```text
--host
--port
--data-dir
--web-dir
--login-shell
--stop-timeout
```

The host must be a loopback host.
The default URL is `http://127.0.0.1:13337`.

`--web-dir` serves a local frontend build instead of embedded files.
Use this option only during frontend development.

## User-service installation

Use this command as the default daemon setup on Linux and macOS:

```sh
proc-man daemon install --now
```

The command installs the user service and starts it immediately.
The generated service file records the current executable path.

Run this command after Homebrew installation and upgrades.
Run `proc-man daemon uninstall` before Homebrew removes the Formula.

Check the installed daemon:

```sh
proc-man daemon status
```

Linux writes:

```text
$HOME/.config/systemd/user/proc-man.service
```

macOS writes:

```text
$HOME/Library/LaunchAgents/dev.proc-man.plist
```

The macOS LaunchAgent writes daemon output here:

```text
$HOME/Library/Logs/proc-man/daemon.log
$HOME/Library/Logs/proc-man/daemon-error.log
```

The error log includes process launch failures, such as denied working-directory access.

Manage the installed service:

```sh
proc-man daemon start
proc-man daemon stop
proc-man daemon restart
proc-man daemon uninstall
```

Uninstall removes only the service definition.
It keeps SQLite and run logs.

## Manifest automation

Any source directory can contain `.proc-man.yaml`.

Registration:

```sh
cd /path/to/source
proc-man register --json
```

Deregistration:

```sh
proc-man deregister --source "$PWD/.proc-man.yaml" --json
```

This pattern works for repositories, worktrees, generated directories, and local tools.
The service stores process records.

## Startup recovery

An unclean shutdown marks unfinished runs as interrupted.
Active process states return to stopped.

The service does not start old services during recovery.

## Missing directories

A process remains registered when its working directory disappears.

Start and Run return `cwd_unavailable`.
The application still shows the configuration and old logs.

## Shutdown

The service stops managed process groups during shutdown.

It sends SIGTERM first.
It sends SIGKILL after the stop limit.

SQLite and log files remain for the next start.

## Local development

proc-man is a local development service.
The repository contains no deployment configuration.
