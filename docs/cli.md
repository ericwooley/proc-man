# CLI contract

## Principles

`port-start` supports people and automation.

- Every command uses the daemon API.
- Human output goes to stdout.
- Diagnostics go to stderr.
- `--json` returns stable machine data.
- Useful mutations support `--dry-run`.
- Automation never waits for input.
- Ambiguous labels return candidates.
- Opaque selectors remain unchanged between commands.

The administration endpoint resolves in this order:

1. `--admin-url`.
2. `PORT_START_ADMIN_URL`.
3. Saved CLI configuration.
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
├── register
├── deregister
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
├── run
│   ├── list
│   ├── search
│   ├── status
│   └── logs
│       └── download
├── tag
│   └── list
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

`port-start serve` runs the daemon in the foreground. Important flags include
`--host`, `--port`, `--data-dir`, `--config`, and `--login-shell`.

`port-start daemon install --now` installs and starts the user service.
Uninstall keeps application data unless `--purge` is present.

## Manifest registration

```sh
port-start register
port-start register --file ./config/dev-processes.yaml
port-start register --dry-run --json
port-start deregister --source "$PWD/.port-start.yaml"
```

`register` returns the canonical manifest source and the complete process
inventory. Each process and endpoint includes an opaque selector.

Registration reconciles entries by manifest source and process key. It reports
created, updated, removed, and unchanged processes. An active run keeps its
launch snapshot when its definition changes.

`deregister --source` stops or cancels active runs and removes current
definitions from that source. Retained runs remain unless `--purge-logs` is
present.

## Process inventory

```sh
port-start process list
port-start process list --tag project:storefront --tag frontend
port-start process list --kind service --state running
port-start process list --query 4310 --json
port-start tag list
```

Human output includes:

- Process selector.
- Label and tags.
- Kind and state.
- Current run ID.
- Declared endpoints.
- Source ownership.
- latest run result.

The JSON form returns `processes` and `next_cursor`. Each process contains:

- `id` and `selector`.
- `label`, `tags`, and `kind`.
- `source`.
- `state` for services.
- `active_runs`.
- `latest_run`.
- `endpoints`.

Repeated `--tag` flags use AND semantics. `--query` searches labels, tags,
launch metadata, and declared ports.

Labels can repeat. A label selects a process only when it matches one process.
An ambiguous label returns matching selectors.

The inventory feeds later commands:

```sh
port-start process status proc_01...
port-start process start proc_01...
port-start process logs proc_01... --run latest
port-start open endpoint_01...
```

## Imperative registration

Long-running service:

```sh
port-start process register \
  --label "Storefront web" \
  --kind service \
  --tag project:storefront \
  --tag frontend \
  --port http=http://127.0.0.1:4310/ \
  --cwd "$PWD" \
  -- npm run dev -- --port 4310
```

One-shot task:

```sh
port-start process register \
  --label "Storefront test suite" \
  --kind task \
  --tag project:storefront \
  --tag test \
  --cwd "$PWD" \
  -- npm test
```

Shell strings require `--shell`:

```sh
port-start process register \
  --label "Database migration" \
  --kind task \
  --tag migration \
  --cwd "$PWD/apps/api" \
  --shell 'exec ./scripts/migrate'
```

Imperative definitions support `process update`. Manifest-owned definitions
return `manifest_owned` and show their source path.

## Labels and tags

```sh
port-start process update proc_01... --label "Storefront preview"
port-start process update proc_01... --add-tag preview
port-start process update proc_01... --remove-tag deprecated
```

The server normalizes tags. The CLI prints the normalized result. `tag list`
returns existing tags and unique process counts for autocomplete and filters.

## Service lifecycle

```sh
port-start process start proc_01...
port-start process stop proc_01...
port-start process restart proc_01...
port-start process status proc_01... --json
```

Start returns the active run while the service is starting or running. Stop is
idempotent. Restart creates one replacement run after termination.

These actions return `invalid_kind` for tasks. Traffic to a declared port never
starts a process.

## Task execution

```sh
port-start process run proc_02...
port-start process run proc_02... --wait
port-start process cancel proc_02... --run run_01...
```

Each invocation receives a run ID, terminal result, and logs. Separate task
runs can overlap. `--wait` streams output and maps the child result to the CLI
exit contract.

Run returns `invalid_kind` for services.

## Ports and links

```sh
port-start process status proc_01...
port-start open endpoint_01...
```

Status shows every declared endpoint. Active runs use their launch snapshot.
Stopped processes use configured values. Changed next-run values receive a
`next_start` label.

`open` starts the user browser for HTTP or HTTPS. It prints a copyable address
for TCP.

Port Start does not allocate, reserve, own, forward, or proxy ports.

## Runs and logs

```sh
port-start run list --tag project:storefront --include-deregistered
port-start run list --kind service --state failed --since 24h
port-start run search 'ready|error' --tag frontend --regex --ignore-case
port-start process logs proc_01... --run latest
port-start process logs proc_01... --follow
port-start run logs run_01... --stream stderr --since 15m
port-start run logs download run_01... --format ndjson --output run.ndjson
```

Run listings are newest-first and cursor-paginated. JSON returns `runs` and
`next_cursor`.

Each run contains:

- Run ID.
- Process snapshot with label, tags, kind, and source.
- State and timestamps.
- Retention deadline.
- current definition presence.

Search uses literal text by default. `--regex` uses RE2. Follow mode resumes by
sequence after a connection failure and reports retention gaps.

## Worktree hook example

A worktree can register normal processes without becoming a Port Start
resource:

```sh
cd /path/to/new-worktree
port-start register --json
```

Before removal:

```sh
port-start deregister --source "$PWD/.port-start.yaml"
git worktree remove "$PWD"
```

The manifest can add branch or project tags when those values help discovery.

## Authentication

`port-start auth set-password` reads a password from a TTY or
`--password-file`. Commands resolve credentials from:

1. `PORT_START_PASSWORD`.
2. `--password-file`.
3. an interactive prompt when permitted.

Passwords and session tokens never appear in JSON output.

## Machine output

Success:

```json
{
  "ok": true,
  "data": {},
  "warnings": []
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "cwd_unavailable",
    "message": "the process working directory is not available",
    "details": {
      "process_id": "proc_01..."
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
| `5` | Authentication failure |
| `6` | Daemon unavailable |
| `7` | Attempted operation failed |

## First-run path

The root help includes this automation-safe path:

```sh
set -u

port-start daemon install --now || exit $?
registration_json="$(port-start register --json)" || exit $?

process_selector="$(
  printf '%s\n' "$registration_json" |
    jq -r '(.data.processes | sort_by(.selector) | .[0].selector) // empty'
)"

port-start process list

if [ -n "$process_selector" ]
then
  process_kind="$(
    printf '%s\n' "$registration_json" |
      jq -r --arg selector "$process_selector" \
        '.data.processes[] | select(.selector == $selector) | .kind'
  )"
  if [ "$process_kind" = "service" ]
  then
    port-start process start "$process_selector" || :
  else
    port-start process run "$process_selector" || :
  fi
  port-start process logs "$process_selector" --run latest || :
fi

endpoint_selector="$(
  printf '%s\n' "$registration_json" |
    jq -r '[.data.processes[].endpoints[] |
      select(.protocol == "http" or .protocol == "https")] |
      sort_by(.selector) | (.[0].selector // empty)'
)"

if [ -n "$endpoint_selector" ]
then
  port-start open "$endpoint_selector" || :
fi
```

Bootstrap, registration, and selector extraction failures stop the path. Later
diagnostics remain visible.

## Help requirements

Every command help page includes:

- Purpose and lifecycle effect.
- Arguments and flags with defaults.
- One human example and one JSON example.
- Selector forms.
- Mutation and prompt behavior.
- Environment variables.
- Exit codes and common errors.
- next commands.
