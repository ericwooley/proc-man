## proc-man process management

Use proc-man as the process registry for this repository.
Associate each process with its working directory.
Register long-running commands as services.
Register one-shot commands as tasks.
Add tags that identify the project, component, and purpose.
Declare each HTTP or TCP port that the command uses.

### Find registered processes

List processes for the current directory before you register or start a process:

```sh
proc-man process list --directory "$PWD"
```

Use the process ID from this list for status, lifecycle, and log commands.

### Register a service

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

### Register a task

```sh
proc-man process register \
  --label "<label>" \
  --kind task \
  --cwd "$PWD" \
  --tag "project:<project>" \
  -- <command> [args...]
```

### Manage processes and logs

Use start, stop, and restart for services.
Use run for tasks.

```sh
proc-man process status PROCESS_ID
proc-man process start PROCESS_ID
proc-man process stop PROCESS_ID
proc-man process restart PROCESS_ID
proc-man process run PROCESS_ID
proc-man process logs PROCESS_ID
proc-man run list --process PROCESS_ID
proc-man run logs RUN_ID
```

Use `proc-man open ENDPOINT_ID` to open a declared HTTP endpoint.
Use `proc-man process deregister PROCESS_ID` when the process no longer belongs to this directory.
Retained run logs remain available after deregistration.
