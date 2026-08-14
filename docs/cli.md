# CLI

## Connection

The CLI calls the local service for process commands and all run commands.

The administration URL resolves in this order:

1. `--admin-url`
2. `PROC_MAN_ADMIN_URL`
3. `http://127.0.0.1:13337`

Add `--json` for stable machine output.

## Agent instructions

Print reusable markdown instructions for coding agents:

```sh
proc-man --agent-instructions
proc-man --agent-instructions >> AGENTS.md
```

This command does not require the local service.

## Command tree

```text
proc-man
├── serve
├── daemon
│   ├── install
│   ├── uninstall
│   ├── start
│   ├── stop
│   ├── restart
│   └── status
├── process
│   ├── register
│   ├── update
│   ├── deregister
│   ├── list
│   ├── status
│   ├── start
│   ├── stop
│   ├── restart
│   ├── run
│   ├── cancel
│   └── logs
├── run -- COMMAND [ARG...]
│   ├── list
│   ├── status
│   └── logs
├── tag
│   └── list
├── register
├── deregister
├── open
└── api
    └── openapi
```

## Run the service

```sh
proc-man serve
proc-man serve --port 13337
proc-man serve --data-dir /path/to/data
proc-man serve --login-shell /bin/zsh
```

The `--host` value must resolve to a loopback address.

## Register a long-running service

`process register` creates one long-running process without a manifest file.
The current directory becomes the working directory when `--cwd` is absent.

```sh
proc-man process register \
  --label "Storefront web" \
  --kind service \
  --tag frontend \
  --tag project:storefront \
  --port http=http://127.0.0.1:4310/ \
  --env NODE_ENV=development \
  --cwd "$PWD" \
  -- npm run dev -- --port 4310
```

Use `--shell` for a shell command:

```sh
proc-man process register \
  --label "API server" \
  --kind service \
  --cwd "$PWD" \
  --shell 'exec ./scripts/start-api'
```

## Run a one-shot command

```sh
proc-man run -- npm test
```

The command uses the directory that invoked proc-man.
It creates an audit run without registering a process.
The local service must be running.
The CLI streams stdout and stderr while the service retains the same records.
The audit run stores the directory, exact arguments, timestamps, output, and exit code.
The command receives the caller environment but does not receive stdin.
An interrupt cancels the active audit run.
The command returns the child exit code when the child fails.
The `--json` flag cannot be used with a direct command.

## Find processes

```sh
proc-man process list
proc-man process list --directory .
proc-man process list --tag frontend --tag project:storefront
proc-man process list --kind service --state running
proc-man process list --query 4310
proc-man process status PROCESS_ID
proc-man tag list
```

Repeated tag flags use AND behavior.
The directory filter uses an exact absolute path.
The CLI resolves relative directory values before it calls the API.
The query searches IDs, labels, tags, commands, directories, and declared ports.

## Update and deregister

```sh
proc-man process update PROCESS_ID --label "Storefront preview"
proc-man process update PROCESS_ID --tag frontend --tag preview
proc-man process deregister PROCESS_ID
```

Manifest-owned processes reject direct updates.
Apply their manifest again to update them.

Deregistration stops active runs and removes the process definition.
Retained run snapshots and logs remain.

## Manage a service

```sh
proc-man process start PROCESS_ID
proc-man process stop PROCESS_ID
proc-man process restart PROCESS_ID
```

These commands reject task processes.

## Managed task compatibility

Existing registered task definitions can still use these commands:

```sh
proc-man process run PROCESS_ID
proc-man process cancel PROCESS_ID --run RUN_ID
```

The run command returns immediately with a run ID.
Use the run commands to inspect its result.
Use direct runs for new one-shot commands.

## Read runs and logs

```sh
proc-man run list
proc-man run list --directory .
proc-man run list --process PROCESS_ID
proc-man run list --kind task --state exited
proc-man run status RUN_ID
proc-man process logs PROCESS_ID
proc-man process logs PROCESS_ID --run RUN_ID
proc-man process logs PROCESS_ID --stream stderr --query error
proc-man run logs RUN_ID
proc-man run logs RUN_ID --format ndjson --output run.ndjson
```

`process logs` selects the latest run by default.
The run directory filter uses an exact absolute path.
The CLI resolves a relative run directory before it calls the API.
Direct audit runs have no process ID.

## Open a declared endpoint

```sh
proc-man open ENDPOINT_ID
```

The command opens HTTP and HTTPS endpoints in the system browser.
The command prints TCP addresses.

## Apply a manifest

```sh
proc-man register
proc-man register --file ./config/processes.yaml
proc-man register --dry-run --json
proc-man deregister --source "$PWD/.proc-man.yaml"
```

Without `--file`, registration searches parent directories for `.proc-man.yaml`.

## Manage the user service

Use this command as the default daemon setup on Linux and macOS:

```sh
proc-man daemon install --now
```

Linux installs a systemd user service.
macOS installs a per-user LaunchAgent.

Manage the installed daemon:

```sh
proc-man daemon status
proc-man daemon restart
proc-man daemon stop
proc-man daemon start
proc-man daemon uninstall
```

## JSON output

Success uses this envelope:

```json
{
  "ok": true,
  "data": {},
  "warnings": []
}
```

API errors include a stable code and message.

## Exit codes

Direct runs return the child exit code.
Other commands use these exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Invalid command or request |
| `3` | Resource not found |
| `4` | Lifecycle conflict |
| `5` | Access failure |
| `6` | Local service unavailable |
| `7` | Service error |
