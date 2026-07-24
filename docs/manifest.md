# Worktree manifest

## File discovery

The canonical manifest name is `.port-start.yaml`.

`port-start worktree apply` searches from the current directory upward to the
Git worktree root and reads `<worktree-root>/.port-start.yaml`. `--file` may
select another file, but every relative path in that file still resolves from
the detected worktree root.

The manifest is declarative. A successful apply makes the manifest-owned service
set match the file. Imperatively registered services are not part of that
reconciliation.

## Version 1

```yaml
version: 1

defaults:
  listen_host: 127.0.0.1
  mode: proxy
  protocol: tcp
  startup_timeout: 60s
  stop_timeout: 10s
  retention:
    max_bytes_per_run: 50MiB
    max_runs: 20

services:
  - name: web
    port: auto
    protocol: http
    url_path: /
    cwd: .
    command:
      argv:
        - npm
        - run
        - dev
        - --
        - --host
        - 127.0.0.1
        - --port
        - "{port}"
    env:
      NODE_ENV: development

  - name: fixed-port-app
    port: 4100
    mode: handoff
    protocol: http
    cwd: apps/fixed-port-app
    command:
      shell: exec ./run-dev-server --port "$PORT"
    retention:
      max_age: 14d
```

Unknown fields are errors. This protects checked-in configuration from silent
misspellings.

## Top-level fields

| Field | Required | Meaning |
| --- | --- | --- |
| `version` | Yes | Schema version. V1 accepts only integer `1`. |
| `defaults` | No | Values inherited by each service. |
| `services` | Yes | List of service definitions. An empty list removes all manifest-owned services. |

Service names must be unique in one manifest.

## Service fields

| Field | Required | Default | Meaning |
| --- | --- | --- | --- |
| `name` | Yes | — | Stable service key matching `[a-zA-Z0-9][a-zA-Z0-9._-]{0,62}`. |
| `port` | Yes | — | Integer `1..65535` or string `auto`. |
| `listen_host` | No | `127.0.0.1` | Address on which the daemon advertises the service. |
| `mode` | No | `proxy` | `proxy` or `handoff`. |
| `protocol` | No | `tcp` | `tcp`, `http`, or `https`. |
| `url_path` | No | `/` | Dashboard link path for HTTP(S); must begin with `/`. |
| `cwd` | No | `.` | Worktree-relative command directory. It must resolve inside the worktree. |
| `command` | Yes | — | Exactly one of `argv` or `shell`. |
| `env` | No | `{}` | String-to-string environment overrides. |
| `startup_timeout` | No | `60s` | Positive duration allowed for readiness. |
| `stop_timeout` | No | `10s` | Duration between SIGTERM and SIGKILL. |
| `retention` | No | global/default | Log-retention constraints. |

`url_path` is invalid for `tcp`. HTTPS is raw TLS passthrough; it does not
receive the HTTP startup page.

### Command

Argv form:

```yaml
command:
  argv: ["npm", "run", "dev", "--", "--port", "{port}"]
```

Shell form:

```yaml
command:
  shell: exec npm run dev -- --port "$PORT"
```

Argv is preferred because argument boundaries remain explicit. Both forms use
the configured user login shell environment. Shell form opts into expansion,
pipes, redirection, and compound-command semantics.

### Substitutions and environment

The following placeholders are expanded in argv elements, shell strings, and
environment values:

| Placeholder | Meaning |
| --- | --- |
| `{port}` | Port the command must bind: backend in proxy mode, advertised in handoff mode. |
| `{public_port}` | Persisted advertised port. |
| `{worktree_root}` | Canonical worktree root. |
| `{service_id}` | Stable service identifier. |

The daemon also sets:

- `PORT` and `PORT_START_PORT`;
- `PORT_START_PUBLIC_PORT`;
- `PORT_START_MODE`;
- `PORT_START_SERVICE_ID`;
- `PORT_START_WORKTREE_ROOT`.

Port Start's values win over conflicting manifest environment values for these
reserved names.

### Retention

Retention constraints may be combined:

```yaml
retention:
  max_bytes_per_run: 50MiB
  max_runs: 20
  max_age: 30d
```

Omitted constraints are unbounded. The explicit form below disables all
automatic deletion for the service:

```yaml
retention:
  unlimited: true
```

`unlimited: true` cannot be combined with another retention field.

## Port allocation

An exact numeric port is a requirement. Apply fails with a conflict if another
enabled registration or operating-system process owns the address. Port Start
never silently remaps it.

For `auto`, the daemon binds an operating-system-selected available public port
as part of the apply operation, then persists it. Reapplying the same service
retains that port. A restart also attempts to reuse it; a collision becomes a
visible `conflict` state rather than causing another allocation.

Apply-time overrides support worktree creation scripts:

```sh
port-start worktree apply --port web=4310 --port api=auto --json
```

Overrides affect that applied manifest snapshot. A later apply without the
override returns to the manifest value. There is no hidden persistent override
layer.

## Reconciliation and ownership

Manifest ownership is recorded on every created service.

- Reapply updates matching services by worktree identity and service name.
- Services removed from the manifest are deregistered.
- Existing run history remains subject to retention.
- Imperative services are not modified.
- The SPA and direct service update commands reject configuration edits to a
  manifest-owned service and point to the manifest path.
- Start, stop, restart, enable, disable, logs, and deregistration remain
  available as operational actions.

The CLI exposes the embedded schema through:

```sh
port-start schema manifest
port-start schema manifest --format json
```

`worktree apply --dry-run` performs discovery, parsing, validation, port
conflict checks, and reconciliation planning without writing state.
