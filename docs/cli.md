# CLI contract

## Principles

`port-start` is both a human interface and a stable automation interface.

- Every control command talks to the daemon API.
- Human output goes to stdout; diagnostics go to stderr.
- `--json` produces stable machine-readable output and no decorative text.
- Mutating commands support `--dry-run` when a useful validation or change plan
  can be produced.
- Prompts are used only when stdin is a TTY and a command explicitly permits
  them. Automation never hangs waiting for input.
- Ambiguous selectors fail with candidates instead of choosing implicitly.

Global endpoint resolution order is:

1. `--admin-url`;
2. `PORT_START_ADMIN_URL`;
3. persisted CLI configuration;
4. `http://127.0.0.1:13337`.

## Command tree

```text
port-start
├── serve
├── daemon
│   ├── install
│   ├── uninstall
│   ├── start
│   ├── stop
│   ├── restart
│   └── status
├── worktree
│   ├── register
│   ├── deregister
│   ├── list
│   └── prune
├── process
│   ├── register
│   ├── update
│   ├── deregister
│   ├── list
│   ├── status
│   ├── start
│   ├── stop
│   ├── restart
│   └── logs
├── command
│   ├── register
│   ├── update
│   ├── deregister
│   ├── list
│   ├── run
│   ├── cancel
│   └── logs
├── run
│   ├── status
│   └── logs
│       └── download
├── open
├── auth
│   ├── set-password
│   └── clear-password
├── schema
│   └── manifest
├── api
│   └── openapi
└── completion
```

## Daemon commands

`port-start serve` runs the daemon in the foreground. Important flags are
`--host`, `--port`, `--data-dir`, `--config`, and `--login-shell`.

`port-start daemon install --now` installs the current executable as the user's
systemd service or LaunchAgent and starts it. `--now=false` installs without
starting. Uninstall keeps application data unless `--purge` is given.

## Worktree registration

```sh
port-start worktree register
port-start worktree register --file ./config/dev-processes.yaml
port-start worktree register --dry-run --json
port-start worktree deregister /path/to/worktree
port-start worktree list --json
port-start worktree prune --missing-for 24h
```

`register` returns repository and worktree identity, process definitions,
command definitions, declared ports and links, and created, updated, or removed
results. A worktree-creation hook can use the JSON form safely and repeatedly.

`deregister` stops active runs and removes current definitions. Historical runs
remain under their retention policies unless `--purge-logs` is supplied.

## Imperative registration

Long-running process:

```sh
port-start process register web \
  --port http=http://127.0.0.1:4310/ \
  --cwd "$PWD" \
  -- npm run dev -- --host 127.0.0.1 --port 4310
```

One-shot command:

```sh
port-start command register test \
  --cwd "$PWD" \
  -- npm test
```

Shell strings use an explicit flag:

```sh
port-start command register migrate \
  --cwd "$PWD/apps/api" \
  --shell 'exec ./scripts/migrate'
```

When run inside a Git worktree, an imperative definition is associated with
that worktree for display unless `--standalone` is supplied. It remains
imperatively owned and editable.

## Process lifecycle

Processes may be selected by stable ID, unambiguous name, or
`worktree/name`:

```sh
port-start process start my-worktree/web
port-start process stop web
port-start process restart proc_01...
port-start process status web --json
```

Start coalesces with an existing active run. Stop terminates the process group.
Restart replaces an active run with a new one. No lifecycle command is triggered
by traffic to a declared port.

Worktree-wide operations are:

```sh
port-start process start --worktree /path/to/worktree
port-start process stop --worktree /path/to/worktree
```

They operate concurrently and return a result for every process rather than
failing fast after the first error.

## Registered command execution

```sh
port-start command run my-worktree/test
port-start command run migrate --json
port-start command cancel run_01...
```

Each invocation receives its own run ID, exit result, and logs. A command run
can outlive the invoking CLI unless `--wait` is supplied. With `--wait`, stdout
and stderr stream to the terminal and the CLI exits with the registered
command's result mapped to the stable Port Start exit contract.

## Ports and links

```sh
port-start process status web
port-start open my-worktree/web:http
```

Process status prints every declared endpoint alongside process state. `open`
selects a named HTTP(S) declaration and launches the user's browser. It reports a
copyable address for TCP declarations.

Declared ports come from registration. CLI commands do not allocate, reserve, or
change them.

## Logs

```sh
port-start process logs web --run latest
port-start process logs web --follow
port-start command logs test --run latest
port-start run logs run_01... --grep 'ready|error' --regex --ignore-case
port-start run logs run_01... --stream stderr --since 15m
port-start run logs download run_01... --format ndjson --output run.ndjson
```

Without `--follow`, logs exit after the retained result. Follow mode resumes by
sequence number after transient API disconnects and reports retention gaps
explicitly.

## Authentication

`port-start auth set-password` reads and confirms a password from a TTY or reads
one value from `--password-file`. A plaintext `--password` argument is omitted
because process listings may expose it.

When authentication is active, ordinary CLI commands resolve credentials from:

1. `PORT_START_PASSWORD`;
2. `--password-file`;
3. an interactive prompt when allowed.

The CLI exchanges the password for a short-lived API session for the duration of
the command. Passwords and session tokens are never printed in JSON output.

## Machine output

Successful JSON responses use:

```json
{
  "ok": true,
  "data": {},
  "warnings": []
}
```

Errors use:

```json
{
  "ok": false,
  "error": {
    "code": "already_running",
    "message": "process web already has an active run",
    "details": {
      "run_id": "run_01..."
    }
  }
}
```

Stable exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Invalid invocation or validation failure |
| `3` | Resource not found or ambiguous selector |
| `4` | Lifecycle conflict |
| `5` | Authentication or authorization failure |
| `6` | Daemon unavailable |
| `7` | Operation attempted but failed |

## Help requirements

Every command's `--help` contains:

- a one-sentence purpose and lifecycle effect;
- complete argument and flag semantics, including defaults;
- at least one copyable example and one `--json` example;
- accepted enum values and selector forms;
- whether it prompts or mutates state;
- relevant environment variables;
- expected exit codes and common errors;
- a “next commands” section.

The root help includes a complete first-run path: install the daemon, register a
worktree, list its processes and commands, start a process, open a declared
endpoint, follow logs, and deregister the worktree. The embedded manifest JSON
Schema and OpenAPI document make the CLI self-describing to automated agents.
