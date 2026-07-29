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
│   ├── list
│   ├── search
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
results. When re-registration changes an active process, the result distinguishes
the active run's current links from configuration pending its next start. A
worktree-creation hook can use the JSON form safely and repeatedly.

`deregister` stops active runs and removes current definitions. Historical runs
remain under their retention policies unless `--purge-logs` is supplied.

## Inventory and discovery

Agents and people can recover a worktree's registered names and endpoint keys
without repeating registration:

```sh
port-start process list --worktree "$PWD"
port-start process list --worktree "$PWD" --json
port-start command list --worktree "$PWD"
port-start command list --worktree "$PWD" --json
```

`--worktree` accepts a canonical path, stable worktree ID, or unambiguous
repository/worktree label. Omitting it lists definitions across every registered
worktree. Ambiguous selectors fail with matching worktree candidates.

Human `process list` output includes stable ID, worktree, name, source, state,
current run ID, and every declared endpoint. Each endpoint line includes its
selector key, protocol, copyable address, and lifecycle label: `active` for the
current run snapshot, `next_start` for changed configuration pending restart,
or `configured` when no run is active. Human `command list` output includes
stable ID, worktree, name, source, active invocation count, and latest run
result.

The JSON forms return the same inventory without display formatting.
`process list --json` returns `processes`; each process contains `id`, `name`,
`source`, `state`, `current_run_id`, an `endpoints` array with `key`,
`protocol`, `address`, and `lifecycle`, and a `worktree` object with the
worktree's stable ID, canonical path, repository ID, and observed branch.
`command list --json` returns `commands`; each command contains `id`, `name`,
`source`, `active_invocation_count`, `latest_run`, and the same `worktree`
object with its stable ID, canonical path, repository ID, and observed branch.
The value is `null` for standalone imperative definitions. Supplying
`--worktree` filters these arrays without changing their response shape.

The discovery results feed directly into status, endpoint, execution, and log
commands:

```sh
port-start process status my-worktree/web
port-start open my-worktree/web:http
port-start command run my-worktree/test
port-start process logs my-worktree/web --run latest
```

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

`command deregister` cancels every active invocation before removing the current
definition. Retained runs remain available according to their retention policy
unless `--purge-logs` is supplied.

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

Start creates a run from `stopped` or `failed`, returns the existing run from
`starting` or `running`, returns `invalid_state` from `stopping`, and returns
`worktree_stale` from `stale`. Stop is idempotent and joins an in-progress stop.
Restart waits for any active run to terminate and creates exactly one new run;
concurrent Restart requests join that operation. Restart returns
`worktree_stale` from `stale`. No lifecycle command is triggered by traffic to a
declared port.

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

A worktree-associated `command run` returns `worktree_stale` while its worktree
path is missing. Cancel remains available for an invocation that was already
active when the path disappeared. Standalone imperative commands are
unaffected.

## Ports and links

```sh
port-start process status web
port-start open my-worktree/web:http
```

Process status prints every declared endpoint alongside process state. While a
process is active, it prints and opens endpoints from the run's launch snapshot.
If the stored definition has changed, status also labels the next-run endpoints
as pending. When no run is active, it uses the stored definition.

`open` selects a named HTTP(S) declaration and launches the user's browser. It
reports a copyable address for TCP declarations.

Declared ports come from registration. CLI commands do not allocate, reserve, or
change them.

Standalone definitions omit `PORT_START_WORKTREE_ROOT`. Supplying
`{worktree_root}` for a standalone process or command is a validation error;
`--cwd` remains its explicit execution root.

## Logs

```sh
port-start run list --worktree "$PWD" --include-deregistered
port-start run list --kind process --name web --state failed --since 24h
port-start run list --worktree "$PWD" --include-deregistered --json
port-start run search 'ready|error' --worktree "$PWD" --regex --ignore-case
port-start process logs web --run latest
port-start process logs web --follow
port-start command logs test --run latest
port-start run logs run_01... --grep 'ready|error' --regex --ignore-case
port-start run logs run_01... --stream stderr --since 15m
port-start run logs download run_01... --format ndjson --output run.ndjson
```

`run list` is the discovery path for current and retained history. It supports
`--worktree`, `--kind process|command`, `--name`, `--state`, `--since`,
`--until`, and `--include-deregistered`. The last flag includes retained runs
whose process or command definition was removed by deregistration. Human output
includes run ID, worktree snapshot, definition kind and name, state, start and
end times, and retention deadline.

Both human and JSON listings are newest-first and cursor-paginated. `--limit`
defaults to 50 and is capped at 500; `--cursor` continues from the prior page.
JSON returns `runs` and `next_cursor`. Each run contains `id`,
`worktree_snapshot`, `definition_kind`, `definition_name`, `state`,
`started_at`, `ended_at`, `retained_until`, `worktree_registered`, and
`definition_present`. The snapshot preserves identity from run start; the two
booleans report query-time registration and definition presence. A missing
`next_cursor` means the result is complete.

`run search` searches retained stdout and stderr across the same filters. It
accepts literal text by default plus `--regex`, `--ignore-case`, and `--stream`.
Human matches include the run ID and a copyable follow-up command. JSON returns
`matches` and `next_cursor`; each match contains `run_id` plus the canonical
log-record fields `seq`, `time`, `stream`, `text`, and `partial`.

Discovery hands directly into status and logs:

```sh
port-start run status run_01...
port-start run logs run_01... --grep 'ready|error' --regex --ignore-case
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
    "code": "worktree_stale",
    "message": "process web cannot start because its worktree is missing",
    "details": {
      "worktree_id": "wt_01...",
      "missing_since": "2026-07-29T18:15:00Z"
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

The root help includes this complete, copyable first-run path:

```sh
port-start daemon install --now
port-start worktree register --json
port-start process list --worktree "$PWD"
port-start command list --worktree "$PWD"
port-start process start "$(basename "$PWD")/web"
port-start open "$(basename "$PWD")/web:http"
port-start process logs "$(basename "$PWD")/web" --follow
port-start worktree deregister "$PWD"
port-start run list --worktree "$PWD" --include-deregistered
```

The embedded manifest JSON Schema and OpenAPI document make the CLI
self-describing to automated agents.
