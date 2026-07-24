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
│   ├── apply
│   ├── remove
│   ├── list
│   └── prune
├── register
├── update
├── deregister
├── list
├── status
├── start
├── stop
├── restart
├── enable
├── disable
├── logs
│   └── download
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

## Worktree commands

```sh
port-start worktree apply
port-start worktree apply --file ./config/dev-services.yaml
port-start worktree apply --port web=auto --dry-run --json
port-start worktree remove /path/to/worktree
port-start worktree list --json
port-start worktree prune --missing-for 24h
```

`apply` returns the repository/worktree identity, service IDs, effective public
ports, links, and created/updated/removed results. This output is sufficient for
a worktree-creation script to advertise or print links.

## Imperative registration

Argv command:

```sh
port-start register web \
  --port 3000 \
  --mode proxy \
  --protocol http \
  --cwd "$PWD" \
  -- npm run dev -- --host 127.0.0.1 --port '{port}'
```

Shell command:

```sh
port-start register api \
  --port auto \
  --mode proxy \
  --protocol http \
  --cwd "$PWD" \
  --shell 'exec ./scripts/dev-api --port "$PORT"'
```

When run inside a Git worktree, imperative registration associates the service
with that worktree for display unless `--standalone` is supplied. It remains
imperatively owned and editable.

`update` accepts the same configuration flags but rejects manifest-owned
services. `deregister` stops the process, releases the port, and retains runs
under their retention policy. `--purge-logs` removes retained logs as part of
deregistration.

## Lifecycle

Services may be selected by stable ID, unambiguous name, `worktree/name`, or
advertised port:

```sh
port-start start my-worktree/web
port-start stop 4310
port-start restart svc_01...
port-start disable web
port-start enable web
```

`stop` returns to armed `idle`. `disable` disarms. Explicit restart bypasses
failed-launch backoff.

Worktree-wide operations are:

```sh
port-start start --worktree /path/to/worktree
port-start stop --worktree /path/to/worktree
```

They execute services concurrently and return a result for every service rather
than failing fast after the first error.

## Logs

```sh
port-start logs web --run latest
port-start logs web --follow
port-start logs web --grep 'ready|error' --regex --ignore-case
port-start logs web --stream stderr --since 15m
port-start logs download web --run latest --format text --output web.log
port-start logs download web --all-runs --format ndjson --output web-logs.ndjson
```

Without `--follow`, `logs` exits after the retained result. Follow mode resumes
by sequence number after transient API disconnects and reports any retention gap
explicitly.

## Authentication

`port-start auth set-password` reads and confirms a password from a TTY or reads
one value from `--password-file`. A plaintext `--password` argument is not
provided because process listings may expose it.

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
    "code": "port_conflict",
    "message": "127.0.0.1:3000 is already in use",
    "details": {}
  }
}
```

Stable exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | Invalid invocation or validation failure |
| `3` | Resource not found or ambiguous selector |
| `4` | Port or lifecycle conflict |
| `5` | Authentication or authorization failure |
| `6` | Daemon unavailable |
| `7` | Operation attempted but failed |

## Help requirements

Every command's `--help` must contain:

- a one-sentence purpose and lifecycle effect;
- complete argument and flag semantics, including defaults;
- at least one copyable example and one `--json` example;
- accepted enum values and selector forms;
- whether it prompts or mutates state;
- relevant environment variables;
- expected exit codes and common errors;
- a “next commands” section.

The root help includes a complete first-run path: install daemon, apply a
manifest, list services, open the dashboard, follow logs, and remove a worktree.
The embedded manifest JSON Schema and OpenAPI document make the CLI
self-describing to automated agents.

