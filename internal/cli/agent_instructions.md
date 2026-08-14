## proc-man process management

Use proc-man to manage long-running services for this repository.
Associate each registered service with its working directory.
Register only long-running commands as services.
Run one-shot commands directly without registration.
Add tags that identify the project, component, and purpose.
Declare each HTTP or TCP port that the service uses.

### Start the proc-man daemon

Use this command as the default daemon setup on Linux and macOS:

```sh
proc-man daemon install --now
```

The command installs and starts the current user service.

### Find registered processes

List processes for the current directory before you register or start a service:

```sh
proc-man process list --directory "$PWD"
```

Use the process ID from this list for status, lifecycle, and log commands.

### Register a long-running service

```sh
proc-man process register \
  --label "<label>" \
  --kind service \
  --cwd "$PWD" \
  --tag "project:<project>" \
  --tag "component:<component>" \
  --port "http=http://127.0.0.1:<port>/" \
  -- <command> [args...]
```

Omit the port flag when the process has no port.

### Run a one-shot command

```sh
proc-man run -- <command> [args...]
```

The command uses the directory that invoked proc-man.
It does not register a process or require the proc-man daemon.
It waits for completion and streams stdin, stdout, and stderr directly.
It does not retain output or run history.

### Manage registered services and logs

Use start, stop, and restart for registered services.

```sh
proc-man process status PROCESS_ID
proc-man process start PROCESS_ID
proc-man process stop PROCESS_ID
proc-man process restart PROCESS_ID
proc-man process logs PROCESS_ID
proc-man run list --process PROCESS_ID
proc-man run logs RUN_ID
```

Use `proc-man open ENDPOINT_ID` to open a declared HTTP endpoint.
Use `proc-man process deregister PROCESS_ID` when the process no longer belongs to this directory.
Retained run logs remain available after deregistration.
